#!/usr/bin/env sh
set -e

IMAGE_NAME="${IMAGE_NAME:-pr-review-dashboard}"

echo "Building Docker image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" .
echo "Build complete: $IMAGE_NAME"
