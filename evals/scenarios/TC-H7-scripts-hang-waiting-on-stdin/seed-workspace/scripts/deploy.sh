#!/usr/bin/env bash
set -euo pipefail

echo "Starting deployment..."

# Pull latest config from S3
aws s3 cp s3://my-config-bucket/app.env .env

# Confirm before proceeding
echo "About to restart the service. Continue? [y/N]"
read -r confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Deployment cancelled."
  exit 0
fi

# Restart the service
sudo systemctl restart myapp

echo "Deployment complete."
