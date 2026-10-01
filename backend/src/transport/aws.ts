import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane'
import { DeleteMessageCommand, Message, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import { routeInbound, topics } from './topics'
import { DeviceEvents, Fields, Transport } from './types'

export interface AwsConfig {
  region: string
  iotEndpoint: string // host from `terraform output iot_endpoint`
  queueUrl: string // ingest queue fed by the IoT topic rules (infra/ingest.tf)
}

// Outbound: IoT Core's Publish API. Inbound: IoT topic rules drop every device message
// into one SQS queue, which we long-poll. Same topics as the Mosquitto transport.
export class AwsIotTransport implements Transport {
  private iot: IoTDataPlaneClient
  private sqs: SQSClient

  constructor(private cfg: AwsConfig) {
    this.iot = new IoTDataPlaneClient({ region: cfg.region, endpoint: `https://${cfg.iotEndpoint}` })
    this.sqs = new SQSClient({ region: cfg.region })
  }

  async start(events: DeviceEvents) {
    void this.poll(events) // runs for the life of the process
    console.log('aws transport polling', this.cfg.queueUrl)
  }

  setDesired(id: string, version: number, state: Fields) {
    return this.publish(topics.desired(id), { version, state }, true)
  }

  dispatchOta(id: string, job: { jobId: string; version: string }) {
    return this.publish(topics.ota(id), job)
  }

  private async publish(topic: string, body: object, retain = false) {
    await this.iot.send(
      new PublishCommand({ topic, payload: Buffer.from(JSON.stringify(body)), qos: 1, retain }),
    )
  }

  private async poll(events: DeviceEvents) {
    for (;;) {
      try {
        const { Messages = [] } = await this.sqs.send(
          new ReceiveMessageCommand({ QueueUrl: this.cfg.queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20 }),
        )
        for (const message of Messages) await this.handle(message, events)
      } catch (err) {
        console.error('sqs poll failed', err)
        await new Promise((resolve) => setTimeout(resolve, 5000))
      }
    }
  }

  // SQS standard queues deliver at-least-once and unordered: the handlers' idempotency
  // (see README) is what makes that safe. The rule SQL adds `_topic` and `_receivedAt`
  // to the device's own JSON payload.
  private async handle(message: Message, events: DeviceEvents) {
    try {
      const { _topic, _receivedAt, ...payload } = JSON.parse(message.Body!)
      await routeInbound(_topic, payload, new Date(_receivedAt), events)
      await this.sqs.send(new DeleteMessageCommand({ QueueUrl: this.cfg.queueUrl, ReceiptHandle: message.ReceiptHandle }))
    } catch (err) {
      // Not deleted: SQS redelivers after the visibility timeout, then moves it to the DLQ.
      console.error('failed handling sqs message:', err)
    }
  }
}
