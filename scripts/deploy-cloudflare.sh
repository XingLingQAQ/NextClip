#!/usr/bin/env bash
set -euo pipefail

echo "==> Building project..."
npm run build

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required"
  exit 1
fi

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "CLOUDFLARE_ACCOUNT_ID is required"
  exit 1
fi

echo "==> Deploying Cloudflare Worker..."
npx wrangler deploy

echo "✅ Cloudflare deploy completed."
