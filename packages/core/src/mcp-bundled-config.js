import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { resolveMcpConfig } from './mcp.js';
function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function readRawMcpServersRecord(path) {
  if (!existsSync(path)) {
    return {};
  }
  const parsed = JSON.parse(readFileSync(path, 'utf-8'));
  if (!isRecord(parsed)) {
    return {};
  }
  const servers = isRecord(parsed.mcpServers) ? parsed.mcpServers : isRecord(parsed.servers) ? parsed.servers : {};
  return { ...servers };
}
export function readBundledSkillMcpManifests(skillDirs) {
  const manifests = [];
  for (const skillDir of skillDirs) {
    const resolvedSkillDir = resolve(skillDir);
    const manifestPath = join(resolvedSkillDir, 'mcp.json');
    if (!existsSync(manifestPath)) {
      continue;
    }
    const entries = readRawMcpServersRecord(manifestPath);
    manifests.push({
      skillName: basename(resolvedSkillDir),
      skillDir: resolvedSkillDir,
      manifestPath,
      serverNames: Object.keys(entries).sort((left, right) => left.localeCompare(right)),
    });
  }
  return manifests;
}
export function readBundledSkillMcpServers(skillDirs) {
  const servers = {};
  const manifests = readBundledSkillMcpManifests(skillDirs);
  for (const manifest of manifests) {
    const entries = readRawMcpServersRecord(manifest.manifestPath);
    for (const [serverName, serverConfig] of Object.entries(entries)) {
      servers[serverName] = serverConfig;
    }
  }
  return {
    servers,
    manifestPaths: manifests.map((manifest) => manifest.manifestPath),
  };
}
export function buildMergedMcpConfigDocument(options) {
  const resolved = resolveMcpConfig({ cwd: options.cwd, configPath: options.configPath, env: options.env });
  const baseServers = resolved.exists ? readRawMcpServersRecord(resolved.path) : {};
  const bundled = readBundledSkillMcpServers(options.skillDirs ?? []);
  return {
    baseConfigPath: resolved.path,
    baseConfigExists: resolved.exists,
    baseServerNames: Object.keys(baseServers).sort((left, right) => left.localeCompare(right)),
    searchedPaths: resolved.searchedPaths,
    bundledServerCount: Object.keys(bundled.servers).length,
    manifestPaths: bundled.manifestPaths,
    document: {
      mcpServers: {
        ...bundled.servers,
        ...baseServers,
      },
    },
  };
}
export function writeMergedMcpConfigFile(options) {
  const result = buildMergedMcpConfigDocument(options);
  const outputPath = resolve(options.outputPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result.document, null, 2)}\n`);
  return result;
}
