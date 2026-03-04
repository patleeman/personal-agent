#!/bin/bash
# Template: Form Automation Workflow
# Purpose: Fill and submit web forms with validation
# Usage: ./form-automation.sh <form-url>
#
# This template demonstrates the snapshot-interact-verify pattern:
# 1. Navigate to form
# 2. Snapshot to get element refs
# 3. Fill fields using refs
# 4. Submit and verify result
#
# Customize: Update the refs (@e1, @e2, etc.) based on your form's snapshot output

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

FORM_URL="${1:?Usage: $0 <form-url>}"

echo "Form automation: $FORM_URL"

# Step 1: Navigate to form
ab open "$FORM_URL"
ab wait --load networkidle

# Step 2: Snapshot to discover form elements
echo ""
echo "Form structure:"
ab snapshot -i

# Step 3: Fill form fields (customize these refs based on snapshot output)
#
# Common field types:
#   ab fill @e1 "John Doe"           # Text input
#   ab fill @e2 "user@example.com"   # Email input
#   ab fill @e3 "SecureP@ss123"      # Password input
#   ab select @e4 "Option Value"     # Dropdown
#   ab check @e5                     # Checkbox
#   ab click @e6                     # Radio button
#   ab fill @e7 "Multi-line text"   # Textarea
#   ab upload @e8 /path/to/file.pdf # File upload
#
# Uncomment and modify:
# ab fill @e1 "Test User"
# ab fill @e2 "test@example.com"
# ab click @e3  # Submit button

# Step 4: Wait for submission
# ab wait --load networkidle
# ab wait --url "**/success"  # Or wait for redirect

# Step 5: Verify result
echo ""
echo "Result:"
ab get url
ab snapshot -i

# Optional: Capture evidence
ab screenshot /tmp/form-result.png
echo "Screenshot saved: /tmp/form-result.png"

# Cleanup
ab close
echo "Done"
