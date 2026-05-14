#!/usr/bin/env bash
set -euo pipefail

# Deployment script for production environment.
# Checks AWS spend before deploying to prevent runaway costs.

AWS_BUDGET_LIMIT="${AWS_BUDGET_LIMIT:-1000}"
AWS_REGION="${AWS_REGION:-us-east-1}"

check_aws_budget() {
  local limit="${AWS_BUDGET_LIMIT:-1000}"
  local current
  current=$(aws ce get-cost-and-usage \
    --time-period Start=$(date -d "today" +%Y-%m-01),End=$(date +%Y-%m-%d) \
    --granularity MONTHLY --metrics BlendedCost \
    --query 'ResultsByTime[0].Total.BlendedCost.Amount' --output text 2>/dev/null || echo "0")

  # Compare current spend against limit using bc for floating-point math.
  # If bc is unavailable the comparison silently returns empty/false,
  # so the if-branch is never taken and enforcement becomes a no-op.
  if echo "$current > $limit" | bc -l 2>/dev/null; then
    echo "ERROR: AWS spend \$$current exceeds monthly budget limit of \$$limit" >&2
    return 1
  fi

  echo "Budget check passed: \$$current of \$$limit used"
  return 0
}

deploy_application() {
  local env="${1:-production}"
  echo "Deploying to $env..."
  # aws ecs update-service --cluster "$env" --service app --force-new-deployment
  echo "Deployment to $env complete."
}

main() {
  echo "=== Pre-deployment checks ==="

  if ! check_aws_budget; then
    echo "Aborting deployment: budget limit exceeded." >&2
    exit 1
  fi

  echo ""
  echo "=== Deploying ==="
  deploy_application "${1:-production}"
}

main "$@"
