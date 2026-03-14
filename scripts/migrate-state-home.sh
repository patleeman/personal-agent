#!/usr/bin/env bash
set -euo pipefail

PA_HOME="${PA_HOME:-$HOME/.local/state/personal-agent}"
STATE_ROOT="$PA_HOME"
CONFIG_ROOT="$PA_HOME/config"
SYNC_ROOT="$PA_HOME/sync"
SYNC_CONFIG_ROOT="$SYNC_ROOT/config"
SYNC_PROFILES_ROOT="$SYNC_ROOT/profiles"
SYNC_PI_AGENT_ROOT="$SYNC_ROOT/pi-agent"
LOG_ROOT="$PA_HOME/logs"

OLD_CONFIG_ROOT="$HOME/.config/personal-agent"
OLD_PI_AGENT_ROOT="$HOME/.pi/agent"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="$PA_HOME/backups/state-home-migration-$STAMP"

REPO_ROOT="${PERSONAL_AGENT_REPO_ROOT:-}"
if [[ -z "$REPO_ROOT" ]]; then
  if git_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
    REPO_ROOT="$git_root"
  else
    REPO_ROOT="$PWD"
  fi
fi

mkdir -p "$CONFIG_ROOT" "$SYNC_ROOT" "$SYNC_CONFIG_ROOT" "$SYNC_PROFILES_ROOT" "$SYNC_PI_AGENT_ROOT" "$LOG_ROOT" "$BACKUP_ROOT"

backup_path() {
  local source="$1"
  local name="$2"
  if [[ -e "$source" || -L "$source" ]]; then
    mkdir -p "$BACKUP_ROOT"
    cp -R "$source" "$BACKUP_ROOT/$name"
  fi
}

copy_file_if_exists() {
  local source="$1"
  local dest="$2"
  if [[ -f "$source" ]]; then
    mkdir -p "$(dirname "$dest")"
    cp -p "$source" "$dest"
  fi
}

copy_dir_if_exists() {
  local source="$1"
  local dest="$2"
  if [[ -d "$source" ]]; then
    mkdir -p "$dest"
    cp -R "$source/." "$dest/"
  fi
}

link_dir() {
  local link_path="$1"
  local target_path="$2"

  if [[ -L "$link_path" ]]; then
    rm -f "$link_path"
  elif [[ -e "$link_path" ]]; then
    backup_path "$link_path" "$(basename "$link_path")-pre-link"
    rm -rf "$link_path"
  fi

  mkdir -p "$(dirname "$link_path")"
  ln -s "$target_path" "$link_path"
}

link_file() {
  local link_path="$1"
  local target_path="$2"

  if [[ -L "$link_path" ]]; then
    rm -f "$link_path"
  elif [[ -e "$link_path" ]]; then
    backup_path "$link_path" "$(basename "$link_path")-pre-link"
    rm -f "$link_path"
  fi

  mkdir -p "$(dirname "$link_path")"
  ln -s "$target_path" "$link_path"
}

echo "==> Backing up existing config + pi paths"
backup_path "$OLD_CONFIG_ROOT" "old-config"
backup_path "$OLD_PI_AGENT_ROOT" "old-pi-agent"

echo "==> Migrating config files"
copy_file_if_exists "$OLD_CONFIG_ROOT/config.json" "$SYNC_CONFIG_ROOT/config.json"
copy_file_if_exists "$OLD_CONFIG_ROOT/daemon.json" "$CONFIG_ROOT/daemon.json"
copy_file_if_exists "$OLD_CONFIG_ROOT/gateway.json" "$CONFIG_ROOT/gateway.json"
copy_file_if_exists "$OLD_CONFIG_ROOT/web.json" "$CONFIG_ROOT/web.json"
copy_dir_if_exists "$OLD_CONFIG_ROOT/local" "$CONFIG_ROOT/local"

echo "==> Migrating legacy ~/.pi/agent files into $SYNC_PI_AGENT_ROOT"
copy_file_if_exists "$OLD_PI_AGENT_ROOT/auth.json" "$SYNC_PI_AGENT_ROOT/auth.json"
copy_file_if_exists "$OLD_PI_AGENT_ROOT/settings.json" "$SYNC_PI_AGENT_ROOT/settings.json"
copy_file_if_exists "$OLD_PI_AGENT_ROOT/models.json" "$SYNC_PI_AGENT_ROOT/models.json"
copy_dir_if_exists "$OLD_PI_AGENT_ROOT/sessions" "$SYNC_PI_AGENT_ROOT/sessions"
copy_dir_if_exists "$OLD_PI_AGENT_ROOT/state" "$SYNC_PI_AGENT_ROOT/state"

echo "==> Creating profile roots under $SYNC_PROFILES_ROOT"
mkdir -p "$SYNC_PROFILES_ROOT"

if [[ -d "$REPO_ROOT/profiles" ]]; then
  while IFS= read -r profile_dir; do
    profile_name="$(basename "$profile_dir")"
    src_agent="$profile_dir/agent"
    if [[ ! -d "$src_agent" ]]; then
      continue
    fi

    dest_agent="$SYNC_PROFILES_ROOT/$profile_name/agent"
    mkdir -p "$dest_agent"

    for entry in AGENTS.md settings.json models.json memory tasks projects activity skills extensions prompts themes; do
      if [[ -e "$src_agent/$entry" ]]; then
        if [[ -d "$src_agent/$entry" ]]; then
          copy_dir_if_exists "$src_agent/$entry" "$dest_agent/$entry"
        else
          copy_file_if_exists "$src_agent/$entry" "$dest_agent/$entry"
        fi
      fi
    done

    if [[ "$profile_name" != "shared" ]]; then
      mkdir -p "$dest_agent/projects"
    fi
  done < <(find "$REPO_ROOT/profiles" -mindepth 1 -maxdepth 1 -type d)
fi

echo "==> Dropping top-level tmux state from managed layout"
if [[ -d "$PA_HOME/tmux" ]]; then
  mkdir -p "$LOG_ROOT"
  mv "$PA_HOME/tmux" "$LOG_ROOT/tmux-legacy-$STAMP"
fi
if [[ -d "$PA_HOME/tmux-logs" ]]; then
  mkdir -p "$LOG_ROOT"
  mv "$PA_HOME/tmux-logs" "$LOG_ROOT/tmux-logs-legacy-$STAMP"
fi

echo "==> Linking compatibility paths"
link_dir "$PA_HOME/profiles" "$SYNC_PROFILES_ROOT"
link_dir "$PA_HOME/pi-agent" "$SYNC_PI_AGENT_ROOT"
link_file "$CONFIG_ROOT/config.json" "../sync/config/config.json"
link_dir "$HOME/.config/personal-agent" "$CONFIG_ROOT"
link_dir "$HOME/.pi/agent" "$PA_HOME/pi-agent"

echo ""
echo "State-home migration complete."
echo "  PA_HOME:           $PA_HOME"
echo "  Sync root:         $SYNC_ROOT"
echo "  Sync profiles:     $SYNC_PROFILES_ROOT"
echo "  Sync pi-agent:     $SYNC_PI_AGENT_ROOT"
echo "  Runtime config:    $CONFIG_ROOT"
echo "  Backup:            $BACKUP_ROOT"
echo ""
echo "Next steps:"
echo "  1) pa doctor"
echo "  2) pa sync setup --repo <git-url> --fresh"
echo "  3) pa sync status"
