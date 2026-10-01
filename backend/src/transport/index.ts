import { AwsIotTransport } from './aws'
import { MosquittoTransport } from './mosquitto'
import { Transport } from './types'

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be set when TRANSPORT=aws`)
  return value
}

function create(): Transport {
  switch (process.env.TRANSPORT ?? 'mosquitto') {
    case 'mosquitto':
      return new MosquittoTransport(process.env.MQTT_URL ?? 'mqtt://localhost:1883')
    case 'aws':
      return new AwsIotTransport({
        region: required('AWS_REGION'),
        iotEndpoint: required('IOT_ENDPOINT'),
        queueUrl: required('SQS_QUEUE_URL'),
      })
    default:
      throw new Error(`unknown TRANSPORT ${process.env.TRANSPORT}`)
  }
}

export const transport = create()
