# What the backend is allowed to do in AWS. Attach this to whatever runs it (your dev
# user/role now, an ECS task role later). No access keys are created here.

resource "aws_iam_policy" "backend" {
  name = "brewfleet-backend"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # send desired state and OTA jobs to devices
        Effect = "Allow"
        Action = ["iot:Publish", "iot:RetainPublish"]
        Resource = [
          "arn:aws:iot:${var.region}:${data.aws_caller_identity.me.account_id}:topic/devices/*/shadow/desired",
          "arn:aws:iot:${var.region}:${data.aws_caller_identity.me.account_id}:topic/devices/*/ota",
        ]
      },
      {
        # read device messages off the ingest queue
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = aws_sqs_queue.ingest.arn
      },
    ]
  })
}
