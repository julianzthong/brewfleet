# Device -> backend path:  IoT topic rules  ->  SQS queue  ->  backend (transport/aws.ts)

# Messages that fail 5 times (e.g. a bug on our side) land here instead of looping forever.
resource "aws_sqs_queue" "ingest_dlq" {
  name                      = "brewfleet-ingest-dlq"
  message_retention_seconds = 1209600 # 14 days
}

# Standard queue: at-least-once and unordered, which the backend's handlers are built for.
resource "aws_sqs_queue" "ingest" {
  name                       = "brewfleet-ingest"
  visibility_timeout_seconds = 30
  receive_wait_time_seconds  = 20 # long polling
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ingest_dlq.arn
    maxReceiveCount     = 5
  })
}

# The role IoT assumes when a rule sends to SQS.
resource "aws_iam_role" "iot_rule" {
  name = "brewfleet-iot-rule"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "iot.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "iot_rule_sqs" {
  role = aws_iam_role.iot_rule.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sqs:SendMessage", Resource = aws_sqs_queue.ingest.arn }]
  })
}

# One rule per topic the backend consumes. (Not `devices/#`: that would also forward the
# backend's own desired/ota publishes straight back into the queue.)
locals {
  inbound_topics = {
    telemetry  = "telemetry"
    status     = "status"
    reported   = "shadow/reported"
    ota_status = "ota/status"
  }
}

# Each rule forwards the device's JSON payload unchanged, plus two fields the backend needs:
#   _topic        the topic it was published on (carries the device id)
#   _receivedAt   epoch ms when IoT received it, used to order status messages
resource "aws_iot_topic_rule" "ingest" {
  for_each    = local.inbound_topics
  name        = "brewfleet_${each.key}"
  enabled     = true
  sql_version = "2016-03-23"
  sql         = "SELECT *, topic() AS _topic, timestamp() AS _receivedAt FROM 'devices/+/${each.value}'"

  sqs {
    queue_url  = aws_sqs_queue.ingest.url
    role_arn   = aws_iam_role.iot_rule.arn
    use_base64 = false
  }
}
