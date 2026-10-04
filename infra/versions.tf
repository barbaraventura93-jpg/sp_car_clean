terraform {
  required_version = ">= 1.10.0"

  # Estado no S3 (versionado, com trava nativa). O nome do bucket fica em
  # backend.hcl, gerado por scripts/aws-bootstrap-tfstate.sh:
  #   terraform init -backend-config=backend.hcl
  backend "s3" {
    key          = "sp-car-clean/terraform.tfstate"
    region       = "sa-east-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "sp-car-clean"
      ManagedBy = "terraform"
    }
  }
}

# O CloudFront só aceita certificados emitidos em us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = "sp-car-clean"
      ManagedBy = "terraform"
    }
  }
}
