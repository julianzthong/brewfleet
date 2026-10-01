# One IoT "thing" per brewer, each with its own X.509 certificate, all sharing one policy.

resource "aws_iot_thing" "brewer" {
  for_each = toset(local.device_ids)
  name     = each.key
}

# No CSR given, so AWS generates the key pair. The private key is only ever available here,
# at creation time, and therefore ends up in terraform state (fine for a dev setup).
resource "aws_iot_certificate" "brewer" {
  for_each = toset(local.device_ids)
  active   = true
}

resource "aws_iot_thing_principal_attachment" "brewer" {
  for_each  = toset(local.device_ids)
  thing     = aws_iot_thing.brewer[each.key].name
  principal = aws_iot_certificate.brewer[each.key].arn
}

# A device may only connect as itself and only touch its own topics. $${...} is a literal
# IoT policy variable (the doubled $ escapes terraform's own interpolation); it resolves to
# the name of the thing whose certificate is connecting.
resource "aws_iot_policy" "device" {
  name = "brewfleet-device"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "iot:Connect"
        Resource = "arn:aws:iot:${var.region}:${data.aws_caller_identity.me.account_id}:client/$${iot:Connection.Thing.ThingName}"
      },
      {
        # status is published retained and is also the Last Will topic
        Effect = "Allow"
        Action = ["iot:Publish", "iot:RetainPublish"]
        Resource = [
          for suffix in ["telemetry", "status", "shadow/reported", "ota/status"] :
          "arn:aws:iot:${var.region}:${data.aws_caller_identity.me.account_id}:topic/devices/$${iot:Connection.Thing.ThingName}/${suffix}"
        ]
      },
      {
        Effect = "Allow"
        Action = "iot:Subscribe"
        Resource = [
          for suffix in ["shadow/desired", "ota"] :
          "arn:aws:iot:${var.region}:${data.aws_caller_identity.me.account_id}:topicfilter/devices/$${iot:Connection.Thing.ThingName}/${suffix}"
        ]
      },
      {
        Effect = "Allow"
        Action = "iot:Receive"
        Resource = [
          for suffix in ["shadow/desired", "ota"] :
          "arn:aws:iot:${var.region}:${data.aws_caller_identity.me.account_id}:topic/devices/$${iot:Connection.Thing.ThingName}/${suffix}"
        ]
      },
    ]
  })
}

resource "aws_iot_policy_attachment" "brewer" {
  for_each = toset(local.device_ids)
  policy   = aws_iot_policy.device.name
  target   = aws_iot_certificate.brewer[each.key].arn
}

# --- credentials written to infra/certs/ (git-ignored) for the simulator to use ---

data "http" "amazon_root_ca" {
  url = "https://www.amazontrust.com/repository/AmazonRootCA1.pem"
}

resource "local_file" "root_ca" {
  filename = "${path.module}/certs/AmazonRootCA1.pem"
  content  = data.http.amazon_root_ca.response_body
}

resource "local_file" "cert" {
  for_each = toset(local.device_ids)
  filename = "${path.module}/certs/${each.key}/cert.pem"
  content  = aws_iot_certificate.brewer[each.key].certificate_pem
}

resource "local_sensitive_file" "private_key" {
  for_each        = toset(local.device_ids)
  filename        = "${path.module}/certs/${each.key}/private.key"
  content         = aws_iot_certificate.brewer[each.key].private_key
  file_permission = "0600"
}
