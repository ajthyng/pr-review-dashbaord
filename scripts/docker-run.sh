#!/usr/bin/env sh
set -e

IMAGE_NAME="${IMAGE_NAME:-pr-review-dashboard}"
ENV_FILE="${ENV_FILE:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found. Copy .env.example to .env and fill in values."
  exit 1
fi

echo "Starting container from image: $IMAGE_NAME"
echo "Using env file: $ENV_FILE"
docker run --rm -p 3000:3000 --env-file "$ENV_FILE" "$IMAGE_NAME"
