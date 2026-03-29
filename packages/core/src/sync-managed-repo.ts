export const MANAGED_SYNC_REPO_CONVERSATION_ATTENTION_MERGE_DRIVER = 'personal-agent-conversation-attention';

export function managedSyncRepoGitignore(): string {
  return `# personal-agent sync repo (managed by pa sync setup)\n\n*\n!.gitignore\n!.gitattributes\n!README.md\n\n# Durable profile definitions\n!profiles/\nprofiles/*\n!profiles/*.json\n!profiles/*/\n!profiles/*/agent/\n!profiles/*/agent/AGENTS.md\n\n# Durable kind-based resources\n!agents/\n!agents/**\n!settings/\n!settings/**\n!models/\n!models/**\n!skills/\n!skills/**\n!notes/\n!notes/**\n!tasks/\n!tasks/**\n!projects/\n!projects/**\n\n# Portable conversation state\n!pi-agent/\npi-agent/*\n!pi-agent/sessions/\n!pi-agent/sessions/**\n!pi-agent/state/\n!pi-agent/state/conversation-attention/\n!pi-agent/state/conversation-attention/**\n\n# Never sync machine-local runtime leftovers\n.DS_Store\n**/.DS_Store\n`;
}

export function managedSyncRepoGitattributes(
  conversationAttentionMergeDriver: string = MANAGED_SYNC_REPO_CONVERSATION_ATTENTION_MERGE_DRIVER,
): string {
  return `* text=auto\n\n# Append-only session JSONL transcripts merge best with union\npi-agent/sessions/**/*.jsonl text eol=lf merge=union\n\n# Conversation attention read-state merges semantically across machines\npi-agent/state/conversation-attention/*.json text eol=lf merge=${conversationAttentionMergeDriver}\n`;
}

export function managedSyncRepoReadme(): string {
  return `# personal-agent sync repo\n\nManaged by \`pa sync setup\`.\n\nThis repo tracks portable cross-machine state from sync roots:\n\n- \`profiles/*.json\`\n- \`profiles/<profile>/agent/AGENTS.md\`\n- \`agents/**\`\n- \`settings/**\`\n- \`models/**\`\n- \`skills/**\`\n- \`notes/**\`\n- \`tasks/**\`\n- \`projects/**\`\n- \`pi-agent/sessions/**\`\n- \`pi-agent/state/conversation-attention/**\`\n\nBuilt-in merge handling is configured for:\n\n- append-only session transcripts under \`pi-agent/sessions/**/*.jsonl\`\n- semantic conversation attention merges under \`pi-agent/state/conversation-attention/*.json\`\n\nMachine-local runtime state such as inbox/read state, deferred resumes, checkpoints, auth, generated prompt materialization, daemon state, and package bins stays outside the synced surface. Machine-local config (including \`config/config.json\` default profile selection) is intentionally not synced.\n`;
}
