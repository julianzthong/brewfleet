# Backend env for TRANSPORT=aws:  AWS_REGION, IOT_ENDPOINT, SQS_QUEUE_URL
output "region" {
  value = var.region
}

output "iot_endpoint" {
  value = data.aws_iot_endpoint.data.endpoint_address
}

output "sqs_queue_url" {
  value = aws_sqs_queue.ingest.url
}

output "backend_policy_arn" {
  value = aws_iam_policy.backend.arn
}

output "dlq_url" {
  value = aws_sqs_queue.ingest_dlq.url
}
