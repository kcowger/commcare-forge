#!/bin/bash
# Builds commcare-cli.jar from the commcare-core source
# Requires: Java 17+, Git
set -e

OUTPUT_DIR="lib"
OUTPUT_FILE="$OUTPUT_DIR/commcare-cli.jar"
CLONE_DIR=$(mktemp -d)

mkdir -p "$OUTPUT_DIR"

# Check prerequisites
if ! command -v java &> /dev/null; then
  echo "ERROR: Java is not installed. Install Java 17+ first."
  echo "  macOS:   brew install openjdk@17"
  echo "  Windows: winget install EclipseAdoptium.Temurin.17.JDK"
  echo "  Linux:   sudo apt install openjdk-17-jdk"
  exit 1
fi

if ! command -v git &> /dev/null; then
  echo "ERROR: Git is not installed."
  exit 1
fi

echo "Cloning commcare-core (this may take a few minutes)..."
git clone --depth 1 https://github.com/dimagi/commcare-core.git "$CLONE_DIR/commcare-core"

echo "Building commcare-cli.jar..."
cd "$CLONE_DIR/commcare-core"

if [ -f "gradlew" ]; then
  chmod +x gradlew
  ./gradlew cliJar
else
  gradle cliJar
fi

# Find the built JAR
BUILT_JAR=$(find "$CLONE_DIR/commcare-core" -name "commcare-cli*.jar" -path "*/build/libs/*" | head -1)

if [ -z "$BUILT_JAR" ]; then
  echo "ERROR: Build succeeded but commcare-cli.jar not found in build output."
  echo "Check $CLONE_DIR/commcare-core/build/libs/ manually."
  exit 1
fi

cd - > /dev/null
cp "$BUILT_JAR" "$OUTPUT_FILE"
rm -rf "$CLONE_DIR"

echo "Built and copied to: $OUTPUT_FILE"
echo "Done!"
