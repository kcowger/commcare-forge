#!/bin/bash
# Downloads the latest commcare-cli.jar from CommCare Core releases
set -e

OUTPUT_DIR="backend/lib"
OUTPUT_FILE="$OUTPUT_DIR/commcare-cli.jar"

mkdir -p "$OUTPUT_DIR"

# Get the latest release info from GitHub API
echo "Fetching latest CommCare Core release..."
RELEASE_URL=$(curl -s https://api.github.com/repos/dimagi/commcare-core/releases/latest \
  | grep -o '"browser_download_url": "[^"]*commcare-cli[^"]*\.jar"' \
  | head -1 \
  | cut -d'"' -f4)

if [ -z "$RELEASE_URL" ]; then
  echo "Could not find commcare-cli.jar in latest release."
  echo "Trying to find any JAR asset..."
  RELEASE_URL=$(curl -s https://api.github.com/repos/dimagi/commcare-core/releases/latest \
    | grep -o '"browser_download_url": "[^"]*\.jar"' \
    | head -1 \
    | cut -d'"' -f4)
fi

if [ -z "$RELEASE_URL" ]; then
  echo "ERROR: Could not find a CLI JAR in the latest release."
  echo "Please download commcare-cli.jar manually from:"
  echo "  https://github.com/dimagi/commcare-core/releases"
  echo "And place it at: $OUTPUT_FILE"
  exit 1
fi

echo "Downloading from: $RELEASE_URL"
curl -L -o "$OUTPUT_FILE" "$RELEASE_URL"
echo "Downloaded to: $OUTPUT_FILE"
echo "Done!"
