#!/bin/bash
# Downloads commcare-cli.jar from the official commcare-core GitHub releases
set -e

OUTPUT_DIR="lib"
OUTPUT_FILE="$OUTPUT_DIR/commcare-cli.jar"
REPO="dimagi/commcare-core"

mkdir -p "$OUTPUT_DIR"

# Get the latest release tag
echo "Fetching latest commcare-core release..."
TAG=$(gh release list --repo "$REPO" --limit 1 --json tagName --jq '.[0].tagName' 2>/dev/null)

if [ -z "$TAG" ]; then
  echo "ERROR: Could not determine latest release. Make sure 'gh' CLI is installed and authenticated."
  exit 1
fi

echo "Latest release: $TAG"
DOWNLOAD_URL="https://github.com/$REPO/releases/download/$TAG/commcare-cli.jar"

echo "Downloading commcare-cli.jar..."
if command -v curl &> /dev/null; then
  curl -L -o "$OUTPUT_FILE" "$DOWNLOAD_URL"
elif command -v wget &> /dev/null; then
  wget -O "$OUTPUT_FILE" "$DOWNLOAD_URL"
else
  echo "ERROR: Neither curl nor wget found."
  exit 1
fi

if [ ! -f "$OUTPUT_FILE" ] || [ ! -s "$OUTPUT_FILE" ]; then
  echo "ERROR: Download failed or file is empty."
  rm -f "$OUTPUT_FILE"
  exit 1
fi

echo "Downloaded to: $OUTPUT_FILE"
echo "Done!"
