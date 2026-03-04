#!/bin/bash
# Template: Content Capture Workflow
# Purpose: Extract content from web pages (text, screenshots, PDF)
# Usage: ./capture-workflow.sh <url> [output-dir]
#
# Outputs:
#   - page-full.png: Full page screenshot
#   - page-structure.txt: Page element structure with refs
#   - page-text.txt: All text content
#   - page.pdf: PDF version
#
# Optional: Load auth state for protected pages

set -euo pipefail

AB_NATIVE_STARTED=0
ab() {
  if [[ "$AB_NATIVE_STARTED" -eq 0 ]]; then
    AB_NATIVE_STARTED=1
    agent-browser --native "$@"
    return
  fi

  agent-browser "$@"
}

TARGET_URL="${1:?Usage: $0 <url> [output-dir]}"
OUTPUT_DIR="${2:-.}"

echo "Capturing: $TARGET_URL"
mkdir -p "$OUTPUT_DIR"

# Optional: Load authentication state
# if [[ -f "./auth-state.json" ]]; then
#     echo "Loading authentication state..."
#     ab state load "./auth-state.json"
# fi

# Navigate to target
ab open "$TARGET_URL"
ab wait --load networkidle

# Get metadata
TITLE=$(ab get title)
URL=$(ab get url)
echo "Title: $TITLE"
echo "URL: $URL"

# Capture full page screenshot
ab screenshot --full "$OUTPUT_DIR/page-full.png"
echo "Saved: $OUTPUT_DIR/page-full.png"

# Get page structure with refs
ab snapshot -i > "$OUTPUT_DIR/page-structure.txt"
echo "Saved: $OUTPUT_DIR/page-structure.txt"

# Extract all text content
ab get text body > "$OUTPUT_DIR/page-text.txt"
echo "Saved: $OUTPUT_DIR/page-text.txt"

# Save as PDF
ab pdf "$OUTPUT_DIR/page.pdf"
echo "Saved: $OUTPUT_DIR/page.pdf"

# Optional: Extract specific elements using refs from structure
# ab get text @e5 > "$OUTPUT_DIR/main-content.txt"

# Optional: Handle infinite scroll pages
# for i in {1..5}; do
#     ab scroll down 1000
#     ab wait 1000
# done
# ab screenshot --full "$OUTPUT_DIR/page-scrolled.png"

# Cleanup
ab close

echo ""
echo "Capture complete:"
ls -la "$OUTPUT_DIR"
