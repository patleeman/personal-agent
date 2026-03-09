#!/usr/bin/env bash
# Datadog Claude Marketplace skill manager
# Usage: marketplace.sh <command> [args]
#   list              - List all available skills (name + description)
#   search <query>    - Search skills by name or description
#   show <plugin/skill> - Show full SKILL.md content
#   install <plugin/skill> [--dest <dir>] - Copy skill to dest (default: current profile skills dir)
#   plugins           - List top-level plugins
#   sync              - Force re-clone/update the repo cache

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_DIR="${HOME}/.cache/dd-marketplace"
REPO_DIR="${CACHE_DIR}/claude-marketplace"
REPO_URL="git@github.com:DataDog/claude-marketplace.git"
DEFAULT_DEST="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Ensure repo is cloned and reasonably fresh (auto-update daily)
ensure_repo() {
  if [ ! -d "${REPO_DIR}/.git" ]; then
    echo "Cloning claude-marketplace..." >&2
    mkdir -p "${CACHE_DIR}"
    git clone --depth 1 "${REPO_URL}" "${REPO_DIR}" 2>&1 >&2
  else
    # Update if older than 24 hours
    local last_fetch="${REPO_DIR}/.git/FETCH_HEAD"
    if [ ! -f "$last_fetch" ] || [ "$(find "$last_fetch" -mmin +1440 2>/dev/null)" ]; then
      echo "Updating claude-marketplace cache..." >&2
      git -C "${REPO_DIR}" pull --ff-only 2>&1 >&2 || true
    fi
  fi
}

# List all skills: plugin/skill-name | description
cmd_list() {
  ensure_repo
  find "${REPO_DIR}" -name "SKILL.md" -not -path "*/.claude/*" | sort | while read -r f; do
    local rel="${f#${REPO_DIR}/}"
    local plugin=$(echo "$rel" | cut -d/ -f1)
    local skill_name=$(echo "$rel" | sed 's|/SKILL.md||' | sed 's|.*/skills/||')
    local desc=$(awk '/^---$/{n++; next} n==1{print}' "$f" | grep -E '^description:' | sed 's/^description: *//' | sed 's/^"//' | sed 's/"$//' | head -c 120)
    printf "%-50s %s\n" "${plugin}/${skill_name}" "${desc}"
  done
}

# Search skills by keyword
cmd_search() {
  local query="${1:?Usage: marketplace.sh search <query>}"
  ensure_repo
  find "${REPO_DIR}" -name "SKILL.md" -not -path "*/.claude/*" | sort | while read -r f; do
    local rel="${f#${REPO_DIR}/}"
    local plugin=$(echo "$rel" | cut -d/ -f1)
    local skill_name=$(echo "$rel" | sed 's|/SKILL.md||' | sed 's|.*/skills/||')
    local frontmatter=$(awk '/^---$/{n++; next} n==1{print}' "$f")
    local desc=$(echo "$frontmatter" | grep -E '^description:' | sed 's/^description: *//' | sed 's/^"//' | sed 's/"$//')
    if echo "${plugin}/${skill_name} ${desc}" | grep -qi "${query}"; then
      printf "%-50s %s\n" "${plugin}/${skill_name}" "$(echo "$desc" | head -c 120)"
    fi
  done
}

# Show full SKILL.md content
cmd_show() {
  local target="${1:?Usage: marketplace.sh show <plugin/skill>}"
  ensure_repo
  # Try exact path: plugin/skills/skill-name/SKILL.md
  local plugin=$(echo "$target" | cut -d/ -f1)
  local skill=$(echo "$target" | cut -d/ -f2-)
  local skill_file="${REPO_DIR}/${plugin}/skills/${skill}/SKILL.md"
  if [ -f "$skill_file" ]; then
    cat "$skill_file"
    return
  fi
  # Fallback: search for it
  local found=$(find "${REPO_DIR}" -path "*/${plugin}/skills/${skill}/SKILL.md" 2>/dev/null | head -1)
  if [ -n "$found" ]; then
    cat "$found"
  else
    echo "Skill not found: ${target}" >&2
    echo "Try: marketplace.sh search ${skill}" >&2
    exit 1
  fi
}

# Install a skill to destination
cmd_install() {
  local target="${1:?Usage: marketplace.sh install <plugin/skill> [--dest <dir>]}"
  shift
  local dest="${DEFAULT_DEST}"
  while [ $# -gt 0 ]; do
    case "$1" in
      --dest) dest="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done
  ensure_repo
  local plugin=$(echo "$target" | cut -d/ -f1)
  local skill=$(echo "$target" | cut -d/ -f2-)
  local skill_dir="${REPO_DIR}/${plugin}/skills/${skill}"
  if [ ! -d "$skill_dir" ]; then
    skill_dir=$(find "${REPO_DIR}" -path "*/${plugin}/skills/${skill}" -type d 2>/dev/null | head -1)
  fi
  if [ ! -d "$skill_dir" ]; then
    echo "Skill not found: ${target}" >&2
    exit 1
  fi
  local dest_dir="${dest}/${skill}"
  if [ -d "$dest_dir" ]; then
    echo "Skill already installed at ${dest_dir}, updating..." >&2
    rm -rf "$dest_dir"
  fi
  mkdir -p "$dest_dir"
  cp -r "${skill_dir}/"* "$dest_dir/"
  echo "Installed ${target} → ${dest_dir}"

  # List what was installed
  find "$dest_dir" -type f | while read -r f; do
    echo "  $(basename "$f")"
  done
}

# List top-level plugins
cmd_plugins() {
  ensure_repo
  find "${REPO_DIR}" -name "plugin.json" -path "*/.claude-plugin/*" | sort | while read -r f; do
    local rel="${f#${REPO_DIR}/}"
    local plugin=$(echo "$rel" | cut -d/ -f1)
    local desc=$(jq -r '.description // empty' "$f" 2>/dev/null | head -c 120)
    local skill_count=$(find "${REPO_DIR}/${plugin}/skills" -name "SKILL.md" 2>/dev/null | wc -l | tr -d ' ')
    printf "%-40s (%s skills) %s\n" "${plugin}" "${skill_count}" "${desc}"
  done
}

# Force sync
cmd_sync() {
  if [ -d "${REPO_DIR}" ]; then
    echo "Updating claude-marketplace..." >&2
    git -C "${REPO_DIR}" pull --ff-only 2>&1
  else
    ensure_repo
  fi
  echo "Cache updated: ${REPO_DIR}"
}

# Main dispatch
case "${1:-help}" in
  list)     cmd_list ;;
  search)   shift; cmd_search "$@" ;;
  show)     shift; cmd_show "$@" ;;
  install)  shift; cmd_install "$@" ;;
  plugins)  cmd_plugins ;;
  sync)     cmd_sync ;;
  help|*)
    echo "Usage: marketplace.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  list              List all skills (name + description)"
    echo "  search <query>    Search skills by name or description"
    echo "  show <plugin/skill>  Show full SKILL.md content"
    echo "  install <plugin/skill>  Install skill to the current profile skills dir"
    echo "  plugins           List top-level plugins"
    echo "  sync              Force update the repo cache"
    ;;
esac
