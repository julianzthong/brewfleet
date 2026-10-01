terraform {
  required_version = ">= 1.5"
  required_providers {
    aws   = { source = "hashicorp/aws", version = "~> 5.0" }
    http  = { source = "hashicorp/http", version = "~> 3.4" }
    local = { source = "hashicorp/local", version = "~> 2.5" }
  }
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "device_count" {
  type    = number
  default = 10
}

provider "aws" {
  region = var.region
}

data "aws_caller_identity" "me" {}

locals {
  # Same ids the simulator generates: brewer-001 ... brewer-010
  device_ids = [for i in range(var.device_count) : format("brewer-%03d", i + 1)]
}

# The account-specific hostname devices and the backend talk to.
data "aws_iot_endpoint" "data" {
  endpoint_type = "iot:Data-ATS"
}
