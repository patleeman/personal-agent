export const MANAGED_SYNC_REPO_CONVERSATION_ATTENTION_MERGE_DRIVER = 'personal-agent-conversation-attention';

export function managedSyncRepoGitignore(): string {
  return `# personal-agent sync repo (managed by pa sync setup)\n\n# Sync everything under this repo by default.\n# Machine-local runtime state should live outside the sync root.\n\n# Never sync macOS Finder cruft\n.DS_Store\n**/.DS_Store\n`;
}

export function managedSyncRepoGitattributes(
  conversationAttentionMergeDriver: string = MANAGED_SYNC_REPO_CONVERSATION_ATTENTION_MERGE_DRIVER,
): string {
  return `* text=auto\n\n# Append-only session JSONL transcripts merge best with union\npi-agent/sessions/**/*.jsonl text eol=lf merge=union\n\n# Conversation attention read-state merges semantically across machines\npi-agent/state/conversation-attention/*.json text eol=lf merge=${conversationAttentionMergeDriver}\n`;
}

export function managedSyncRepoReadme(): string {
  return `# personal-agent sync repo\n\nManaged by \`pa sync setup\`.\n\nThis repo tracks everything under this directory.\n\nPut portable durable state inside the sync root and it will sync across machines.\nMachine-local runtime state should stay outside this repo.\n\nTypical durable paths here include:\n\n- \`_tasks/**\`\n- \`tasks/**\`\n- \`pi-agent/sessions/**\`\n- \`pi-agent/state/conversation-attention/**\`\n\nIf you use an external knowledge vault, notes, skills, projects, and profile files may live outside this sync repo and sync through that vault instead.\n\nBuilt-in merge handling is configured for:\n\n- append-only session transcripts under \`pi-agent/sessions/**/*.jsonl\`\n- semantic conversation attention merges under \`pi-agent/state/conversation-attention/*.json\`\n\nMachine-local runtime state such as inbox/read state, deferred resumes, checkpoints, auth, generated prompt materialization, daemon state, and package bins stays outside the synced surface. Machine-local config (including \`config/config.json\` default profile selection) is intentionally not synced.\n`;
}
