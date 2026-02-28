/**
 * Jobs Extension - Full job workflow compatible with pi-deck
 *
 * Commands:
 * - /job [title]              - Create a new job in backlog
 * - /job:plan [title]         - Create a job and start planning (backlog → planning)
 * - /job:plan [path]          - Start planning on existing job
 * - /job:exec [path]          - Start executing a job (ready → executing)
 * - /job:review [path]        - Start reviewing a job (executing → review)
 * - /job:promote [path]       - Promote job to next phase
 * - /job:demote [path]        - Demote job to previous phase
 * - /job:list                 - List all jobs with phase filtering
 * - /jobs                     - Alias for /job:list
 * - /job:archive [path]       - Archive a completed job
 * - /job:unarchive [path]     - Restore an archived job
 * - /job:locations            - Manage job storage locations
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey } from "@mariozechner/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";

type JobPhase = "backlog" | "planning" | "ready" | "executing" | "review" | "complete";

interface JobFile {
  filename: string;
  filepath: string;
  date: string;
  title: string;
  phase: JobPhase;
  tags: string[];
  description: string;
  taskCount: number;
  doneCount: number;
  updated?: string;
  created?: string;
  mtime: Date;
}

interface JobConfig {
  locations: string[];
  defaultLocation?: string;
}

const PHASE_ORDER: JobPhase[] = ["backlog", "planning", "ready", "executing", "review", "complete"];

const PHASE_ICONS: Record<JobPhase, string> = {
  backlog: "📦",
  planning: "📝",
  ready: "✅",
  executing: "⚡",
  review: "👀",
  complete: "✓",
};

function yamlValue(value: string): string {
  const safeScalar = /^[a-zA-Z0-9._\/-]+$/;
  return safeScalar.test(value) ? value : JSON.stringify(value);
}

function yamlArray(values: string[]): string {
  if (values.length === 0) return "[]";
  return values.map((v) => yamlValue(v)).join(", ");
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "job";
}

function parseFrontmatter(content: string): {
  title?: string;
  phase?: JobPhase;
  tags?: string[];
  updated?: string;
  created?: string;
} {
  if (!content.startsWith("---")) return {};
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) return {};

  const block = content.slice(4, endIndex);
  const lines = block.split("\n");
  const result: { title?: string; phase?: JobPhase; tags?: string[]; updated?: string; created?: string } = {};

  for (const line of lines) {
    const match = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    const value = raw.trim();

    if (key === "title") result.title = value.replace(/^['"]|['"]$/g, "");
    if (key === "phase" && PHASE_ORDER.includes(value as JobPhase)) {
      result.phase = value as JobPhase;
    }
    if (key === "updated") result.updated = value;
    if (key === "created") result.created = value;
    if (key === "tags") {
      // Parse array format: [tag1, tag2] or single value
      if (value.startsWith("[") && value.endsWith("]")) {
        result.tags = value
          .slice(1, -1)
          .split(",")
          .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      } else {
        result.tags = [value.replace(/^['"]|['"]$/g, "")];
      }
    }
  }

  return result;
}

function parseTasks(content: string): { done: boolean; text: string }[] {
  const tasks: { done: boolean; text: string }[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(/^(\s*)- \[([ xX])\]\s*(.+)$/);
    if (match) {
      tasks.push({
        done: match[2].toLowerCase() === "x",
        text: match[3].trim(),
      });
    }
  }

  return tasks;
}

function extractDescription(content: string): string {
  const descMatch = content.match(/## Description\s*\n([^#]+)/);
  return descMatch ? descMatch[1].trim().split("\n")[0] : "";
}

function buildInitialJobMarkdown(title: string, description: string, phase: JobPhase = "backlog", tags: string[] = []): string {
  const now = new Date().toISOString();
  const normalizedTitle = title.replace(/[\r\n]+/g, " ").trim();

  return [
    "---",
    `title: ${yamlValue(normalizedTitle)}`,
    `phase: ${phase}`,
    `tags: [${yamlArray(tags)}]`,
    `created: ${now}`,
    `updated: ${now}`,
    "---",
    "",
    `# ${normalizedTitle}`,
    "",
    "## Description",
    description || "_Add a description of what needs to be done._",
    "",
    "## Plan",
    "_Add actionable tasks here. Use - [ ] for unchecked, - [x] for checked._",
    "",
    "## Review",
    "_Add review criteria or notes here._",
    "",
  ].join("\n");
}

function updateJobPhase(content: string, newPhase: JobPhase): string {
  const now = new Date().toISOString();

  // Update phase field
  let updated = content.replace(/^phase:\s*\w+$/m, `phase: ${newPhase}`);

  // Update updated timestamp
  if (/^updated:/m.test(updated)) {
    updated = updated.replace(/^updated:\s*.+$/m, `updated: ${now}`);
  } else {
    // Add updated field after created
    updated = updated.replace(/^(created:\s*.+)$/m, `$1\nupdated: ${now}`);
  }

  // If completing, add completedAt
  if (newPhase === "complete" && !/^completedAt:/m.test(updated)) {
    updated = updated.replace(/^(updated:\s*.+)$/m, `$1\ncompletedAt: ${now}`);
  }

  return updated;
}

export default function jobsExtension(pi: ExtensionAPI) {
  // ============================================================================
  // Configuration & Paths
  // ============================================================================

  function getWorkspaceConfigPath(cwd: string): string {
    return path.join(cwd, ".pi", "jobs.json");
  }

  function loadJobConfig(cwd: string): JobConfig | null {
    const configPath = getWorkspaceConfigPath(cwd);
    if (!fs.existsSync(configPath)) return null;

    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed.locations) && parsed.locations.length > 0) {
        return {
          locations: parsed.locations,
          defaultLocation: parsed.defaultLocation,
        };
      }
    } catch {
      // Invalid config, ignore
    }
    return null;
  }

  function saveJobConfig(cwd: string, config: JobConfig): void {
    const configPath = getWorkspaceConfigPath(cwd);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  function resolveLocationPath(location: string, cwd: string): string {
    if (location.startsWith("~/")) {
      return path.join(homedir(), location.slice(2));
    }
    if (location.startsWith("./")) {
      return path.resolve(cwd, location);
    }
    return location;
  }

  function getDefaultJobDirs(cwd: string): string[] {
    const repoName = path.basename(cwd);
    return [
      path.join(homedir(), ".pi", "agent", "jobs", repoName),
      path.join(cwd, ".pi", "jobs"),
    ];
  }

  function getJobDirectories(cwd: string): string[] {
    const config = loadJobConfig(cwd);
    if (config) {
      return config.locations.map((loc) => resolveLocationPath(loc, cwd));
    }
    return getDefaultJobDirs(cwd);
  }

  function getDefaultJobDir(cwd: string): string {
    const config = loadJobConfig(cwd);
    if (config?.defaultLocation) {
      return resolveLocationPath(config.defaultLocation, cwd);
    }
    const dirs = getJobDirectories(cwd);
    return dirs[0];
  }

  // ============================================================================
  // Job CRUD Operations
  // ============================================================================

  function generateJobFilename(title: string): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, "");
    return `${date}-${slugify(title)}.md`;
  }

  function allocateJobPath(jobsDir: string, title: string): string {
    const baseName = generateJobFilename(title).replace(/\.md$/, "");
    let filePath = path.join(jobsDir, `${baseName}.md`);
    let i = 1;
    while (fs.existsSync(filePath)) {
      filePath = path.join(jobsDir, `${baseName}-${i}.md`);
      i += 1;
    }
    return filePath;
  }

  function createJob(cwd: string, title: string, description: string, phase: JobPhase = "backlog", tags: string[] = []): string {
    const jobsDir = getDefaultJobDir(cwd);
    fs.mkdirSync(jobsDir, { recursive: true });

    const filePath = allocateJobPath(jobsDir, title);
    const content = buildInitialJobMarkdown(title, description, phase, tags);
    fs.writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  function readJob(filepath: string): JobFile | null {
    if (!fs.existsSync(filepath)) return null;

    try {
      const stat = fs.statSync(filepath);
      const content = fs.readFileSync(filepath, "utf-8");
      const fm = parseFrontmatter(content);
      const tasks = parseTasks(content);

      const filename = path.basename(filepath);
      const match = filename.match(/^(\d{8})-(.+)\.md$/);
      const date = match ? match[1] : "unknown";

      return {
        filename,
        filepath,
        date,
        title: fm.title || filename.replace(/\.md$/, ""),
        phase: fm.phase || "backlog",
        tags: fm.tags || [],
        description: extractDescription(content),
        taskCount: tasks.length,
        doneCount: tasks.filter((t) => t.done).length,
        updated: fm.updated,
        created: fm.created,
        mtime: stat.mtime,
      };
    } catch {
      return null;
    }
  }

  function listJobs(cwd: string, includeArchived = false): JobFile[] {
    const dirs = getJobDirectories(cwd);
    const jobs: JobFile[] = [];
    const seen = new Set<string>();

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;

      // List active jobs
      try {
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const file of files) {
          if (!file.isFile() || !file.name.endsWith(".md")) continue;

          const filepath = path.join(dir, file.name);
          if (seen.has(filepath)) continue;
          seen.add(filepath);

          const job = readJob(filepath);
          if (job) jobs.push(job);
        }
      } catch {
        // Ignore errors reading directory
      }

      // List archived jobs if requested
      if (includeArchived) {
        const archivedDir = path.join(dir, "archived");
        if (fs.existsSync(archivedDir)) {
          try {
            const files = fs.readdirSync(archivedDir, { withFileTypes: true });
            for (const file of files) {
              if (!file.isFile() || !file.name.endsWith(".md")) continue;

              const filepath = path.join(archivedDir, file.name);
              if (seen.has(filepath)) continue;
              seen.add(filepath);

              const job = readJob(filepath);
              if (job) {
                job.phase = "complete"; // Archived jobs are complete
                jobs.push(job);
              }
            }
          } catch {
            // Ignore errors
          }
        }
      }
    }

    // Sort: active phases first, then by updated date
    const phaseWeight: Record<JobPhase, number> = {
      executing: 0,
      planning: 1,
      review: 2,
      ready: 3,
      backlog: 4,
      complete: 5,
    };

    jobs.sort((a, b) => {
      const pw = phaseWeight[a.phase] - phaseWeight[b.phase];
      if (pw !== 0) return pw;
      return (b.updated || b.created || "").localeCompare(a.updated || a.created || "");
    });

    return jobs;
  }

  function getNextPhase(current: JobPhase): JobPhase | null {
    const idx = PHASE_ORDER.indexOf(current);
    if (idx < 0 || idx >= PHASE_ORDER.length - 1) return null;
    return PHASE_ORDER[idx + 1];
  }

  function getPreviousPhase(current: JobPhase): JobPhase | null {
    const idx = PHASE_ORDER.indexOf(current);
    if (idx <= 0) return null;
    return PHASE_ORDER[idx - 1];
  }

  function promoteJob(filepath: string, toPhase?: JobPhase): JobFile | null {
    const job = readJob(filepath);
    if (!job) return null;

    const targetPhase = toPhase || getNextPhase(job.phase);
    if (!targetPhase) return job;

    const content = fs.readFileSync(filepath, "utf-8");
    const updated = updateJobPhase(content, targetPhase);
    fs.writeFileSync(filepath, updated, "utf-8");

    return readJob(filepath);
  }

  function demoteJob(filepath: string, toPhase?: JobPhase): JobFile | null {
    const job = readJob(filepath);
    if (!job) return null;

    const targetPhase = toPhase || getPreviousPhase(job.phase);
    if (!targetPhase) return job;

    const content = fs.readFileSync(filepath, "utf-8");
    const updated = updateJobPhase(content, targetPhase);
    fs.writeFileSync(filepath, updated, "utf-8");

    return readJob(filepath);
  }

  function archiveJob(filepath: string): boolean {
    try {
      const dir = path.dirname(filepath);
      const archivedDir = path.join(dir, "archived");
      fs.mkdirSync(archivedDir, { recursive: true });

      const filename = path.basename(filepath);
      const newPath = path.join(archivedDir, filename);
      fs.renameSync(filepath, newPath);
      return true;
    } catch {
      return false;
    }
  }

  function unarchiveJob(filepath: string): boolean {
    try {
      const archivedDir = path.dirname(filepath);
      const parentDir = path.dirname(archivedDir);
      const filename = path.basename(filepath);
      const newPath = path.join(parentDir, filename);
      fs.renameSync(filepath, newPath);
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Prompt Builders (mirroring pi-deck)
  // ============================================================================

  function buildPlanningPrompt(jobPath: string): string {
    return `<active_job phase="planning">
You have a job to plan at: ${jobPath}
Read the job file. It contains a title and description.

Before creating the plan, you MUST:
1. Explore the codebase to understand the current implementation
2. Search for relevant files, functions, and existing patterns
3. Read documentation and configuration files as needed
4. Gather context about the architecture and conventions used

Do this research yourself — DO NOT include research or exploration tasks in the plan. The plan should only contain concrete implementation steps that will be performed after planning is complete.

Your goal is to create a detailed implementation plan. Ask the user clarifying questions if needed, then write a concrete plan with \`- [ ]\` checkbox tasks back into the job file under a "## Plan" section.

Plan tasks should be actionable implementation steps only (e.g., "Add function X", "Update file Y"). Do not include research tasks like "review current implementation" — you should do that during planning, not put it in the plan.

Group tasks under \`### Phase\` headings. Keep tasks concise and actionable (start with a verb).
When you're done writing the plan, let the user know so they can review and iterate or mark it as ready.
</active_job>`;
  }

  function buildExecutionPrompt(jobPath: string): string {
    return `<active_job phase="executing">
You have a job to execute at: ${jobPath}
Read the job file. It contains a plan with \`- [ ]\` checkbox tasks.
Work through each task systematically. As you complete each one, update the job file by checking off the corresponding checkbox (change \`- [ ]\` to \`- [x]\`).
When all tasks are complete, let the user know the job is ready for review.
</active_job>`;
  }

  function buildReviewPrompt(jobPath: string): string {
    const content = fs.existsSync(jobPath) ? fs.readFileSync(jobPath, "utf-8") : "";
    const reviewMatch = content.match(/## Review\s*\n([^#]+)/);
    const reviewSection = reviewMatch ? reviewMatch[1].trim() : null;

    if (!reviewSection) {
      return `<active_job phase="review">
You have a job to review at: ${jobPath}
Read the job file and perform a general review of the completed work.
When the review is complete, let the user know.
</active_job>`;
    }

    return `<active_job phase="review">
You have a job to review at: ${jobPath}
Read the job file first to understand the full context.

Then execute the following review steps:

${reviewSection}

Work through each review step. When all review steps are complete, let the user know the review is done.
</active_job>`;
  }

  function buildFinalizePrompt(jobPath: string): string {
    return `<active_job phase="finalize">
The review for this job is complete. Now finalize the job at: ${jobPath}

Please update the job file with a ## Summary section at the end containing:
- A brief summary of what was accomplished
- Links to any pull requests created
- Links to any other important artifacts (docs, configs, etc.)
- Any notes for future reference

Then mark all remaining tasks as done if they aren't already.
Update the \`updated\` timestamp in the frontmatter.
</active_job>`;
  }

  // ============================================================================
  // UI Helpers
  // ============================================================================

  async function selectJob(ctx: any, cwd: string, filterPhase?: JobPhase): Promise<JobFile | null> {
    const jobs = listJobs(cwd).filter((j) => !filterPhase || j.phase === filterPhase);

    if (jobs.length === 0) {
      ctx.ui.notify(filterPhase ? `No jobs in ${filterPhase} phase.` : "No jobs found.", "info");
      return null;
    }

    const result = await ctx.ui.custom<{ job?: JobFile; cancelled: boolean } | null>(
      (tui: any, theme: any, _kb: any, done: any) => {
        let selectedIndex = 0;
        let filter = "";
        let showHelp = false;

        function getFilteredJobs() {
          if (!filter) return jobs;
          const lower = filter.toLowerCase();
          return jobs.filter((j) => j.title.toLowerCase().includes(lower) || j.tags.some((t) => t.toLowerCase().includes(lower)));
        }

        function refresh() {
          tui.requestRender();
        }

        function handleInput(data: string) {
          if (showHelp) {
            if (matchesKey(data, Key.escape) || matchesKey(data, "q")) {
              showHelp = false;
              refresh();
            }
            return;
          }

          // Filter input
          if (data.length === 1 && data >= " " && data <= "~") {
            filter += data;
            selectedIndex = 0;
            refresh();
            return;
          }

          if (matchesKey(data, Key.backspace) || data === "\x7f") {
            filter = filter.slice(0, -1);
            selectedIndex = 0;
            refresh();
            return;
          }

          if (matchesKey(data, Key.escape)) {
            if (filter) {
              filter = "";
              selectedIndex = 0;
              refresh();
              return;
            }
            done({ cancelled: true });
            return;
          }

          const filtered = getFilteredJobs();

          if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
            selectedIndex = Math.max(0, selectedIndex - 1);
            refresh();
            return;
          }
          if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
            selectedIndex = Math.min(filtered.length - 1, selectedIndex + 1);
            refresh();
            return;
          }
          if (matchesKey(data, Key.enter)) {
            if (filtered[selectedIndex]) {
              done({ job: filtered[selectedIndex], cancelled: false });
            }
            return;
          }
          if (matchesKey(data, "?")) {
            showHelp = true;
            refresh();
            return;
          }
        }

        function render(width: number): string[] {
          const lines: string[] = [];
          const filtered = getFilteredJobs();

          if (showHelp) {
            lines.push(theme.fg("accent", "─".repeat(width)));
            lines.push(theme.fg("accent", theme.bold(" Keyboard Shortcuts ")));
            lines.push("");
            lines.push("  ↑/k     Move up");
            lines.push("  ↓/j     Move down");
            lines.push("  enter   Select job");
            lines.push("  /       Filter jobs");
            lines.push("  esc     Clear filter / Cancel");
            lines.push("  ?       Show this help");
            lines.push("");
            lines.push(theme.fg("dim", "Press any key to close help"));
            lines.push(theme.fg("accent", "─".repeat(width)));
            return lines;
          }

          lines.push(theme.fg("accent", "─".repeat(width)));
          lines.push(theme.fg("accent", theme.bold(" 🎯 Select Job")) + theme.fg("dim", ` (${filtered.length}/${jobs.length})`));

          // Filter display
          if (filter) {
            lines.push(theme.fg("dim", ` Filter: "${filter}" (esc to clear)`));
          } else {
            lines.push(theme.fg("dim", " Type to filter • ? for help"));
          }
          lines.push("");

          // Job list
          const maxVisible = Math.min(15, filtered.length);
          const startIdx = Math.max(0, Math.min(selectedIndex, filtered.length - maxVisible));
          const endIdx = Math.min(startIdx + maxVisible, filtered.length);

          for (let i = startIdx; i < endIdx; i++) {
            const job = filtered[i];
            const isSelected = i === selectedIndex;
            const icon = PHASE_ICONS[job.phase];
            const dateFormatted = job.date.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
            const progress = job.taskCount > 0 ? ` [${job.doneCount}/${job.taskCount}]` : "";

            const prefix = isSelected ? theme.fg("accent", "❯ ") : "  ";
            const titleStyle = isSelected ? theme.fg("accent", job.title) : theme.fg("text", job.title);
            const meta = theme.fg("dim", ` ${icon} ${job.phase}${progress} (${dateFormatted})`);

            lines.push(prefix + titleStyle + meta);

            if (isSelected && job.description) {
              const desc = job.description.length > width - 6 ? job.description.slice(0, width - 9) + "..." : job.description;
              lines.push(theme.fg("muted", `    ${desc}`));
            }
          }

          if (filtered.length === 0) {
            lines.push(theme.fg("dim", "  No jobs match the filter."));
          }

          lines.push("");
          lines.push(theme.fg("dim", "  ↑↓ navigate • enter select • / filter • esc cancel"));
          lines.push(theme.fg("accent", "─".repeat(width)));

          return lines;
        }

        return { render, invalidate() {}, handleInput };
      }
    );

    return result?.cancelled ? null : result?.job || null;
  }

  // ============================================================================
  // Command Handlers
  // ============================================================================

  // /job - Create a new job in backlog
  pi.registerCommand("job", {
    description: "Create a new job in backlog phase",
    handler: async (args, ctx) => {
      let title = args?.trim();

      if (!title) {
        title = await ctx.ui.input("Job title:", "e.g., Add user authentication");
        if (!title?.trim()) {
          ctx.ui.notify("Cancelled", "info");
          return;
        }
        title = title.trim();
      }

      const description = await ctx.ui.input("Description (optional):", "");
      const jobPath = createJob(ctx.cwd, title, description || "", "backlog");

      ctx.ui.notify(`Created job: ${path.basename(jobPath)}`, "info");

      // Ask if they want to start planning
      const startPlanning = await ctx.ui.confirm("Start planning now?", false);
      if (startPlanning) {
        const job = promoteJob(jobPath, "planning");
        if (job) {
          pi.sendUserMessage(buildPlanningPrompt(jobPath));
        }
      }
    },
  });

  // /job:plan - Create or start planning
  pi.registerCommand("job:plan", {
    description: "Create a job and start planning, or plan an existing job",
    handler: async (args, ctx) => {
      const arg = args?.trim();

      // If arg is a path to existing job, use it
      if (arg && (arg.endsWith(".md") || fs.existsSync(arg))) {
        const jobPath = path.resolve(ctx.cwd, arg);
        if (!fs.existsSync(jobPath)) {
          ctx.ui.notify(`Job not found: ${arg}`, "error");
          return;
        }

        const job = readJob(jobPath);
        if (!job) {
          ctx.ui.notify(`Invalid job file: ${arg}`, "error");
          return;
        }

        // Promote to planning if needed
        if (job.phase !== "planning") {
          promoteJob(jobPath, "planning");
        }

        pi.sendUserMessage(buildPlanningPrompt(jobPath));
        return;
      }

      // If arg looks like a title, create new job
      if (arg) {
        const jobPath = createJob(ctx.cwd, arg, `Planning request: ${arg}`, "planning");
        ctx.ui.notify(`Created planning job: ${path.basename(jobPath)}`, "info");
        pi.sendUserMessage(buildPlanningPrompt(jobPath));
        return;
      }

      // No args - show job selector for backlog jobs
      const job = await selectJob(ctx, ctx.cwd, "backlog");
      if (!job) return;

      promoteJob(job.filepath, "planning");
      pi.sendUserMessage(buildPlanningPrompt(job.filepath));
    },
  });

  // /job:exec - Start executing a ready job
  pi.registerCommand("job:exec", {
    description: "Start executing a job (ready → executing)",
    handler: async (args, ctx) => {
      let jobPath: string;

      if (args?.trim()) {
        jobPath = path.resolve(ctx.cwd, args.trim());
        if (!fs.existsSync(jobPath)) {
          ctx.ui.notify(`Job not found: ${args}`, "error");
          return;
        }
      } else {
        const job = await selectJob(ctx, ctx.cwd, "ready");
        if (!job) return;
        jobPath = job.filepath;
      }

      const job = readJob(jobPath);
      if (!job) {
        ctx.ui.notify(`Invalid job file`, "error");
        return;
      }

      if (job.phase !== "ready" && job.phase !== "executing") {
        // Auto-promote through phases to executing
        if (job.phase === "backlog" || job.phase === "planning") {
          promoteJob(jobPath, "ready");
        }
      }

      promoteJob(jobPath, "executing");
      pi.sendUserMessage(buildExecutionPrompt(jobPath));
    },
  });

  // /job:review - Start reviewing an executing job
  pi.registerCommand("job:review", {
    description: "Start reviewing a completed job (executing → review)",
    handler: async (args, ctx) => {
      let jobPath: string;

      if (args?.trim()) {
        jobPath = path.resolve(ctx.cwd, args.trim());
        if (!fs.existsSync(jobPath)) {
          ctx.ui.notify(`Job not found: ${args}`, "error");
          return;
        }
      } else {
        // Show executing or ready jobs
        const jobs = listJobs(ctx.cwd).filter((j) => j.phase === "executing" || (j.phase === "ready" && j.taskCount > 0 && j.doneCount === j.taskCount));

        if (jobs.length === 0) {
          ctx.ui.notify("No jobs ready for review. Jobs must have all tasks completed.", "info");
          return;
        }

        const result = await ctx.ui.custom<{ job?: JobFile; cancelled: boolean } | null>(
          (tui: any, theme: any, _kb: any, done: any) => {
            let selectedIndex = 0;

            function refresh() {
              tui.requestRender();
            }

            function handleInput(data: string) {
              if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
                selectedIndex = Math.max(0, selectedIndex - 1);
                refresh();
                return;
              }
              if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
                selectedIndex = Math.min(jobs.length - 1, selectedIndex + 1);
                refresh();
                return;
              }
              if (matchesKey(data, Key.enter)) {
                done({ job: jobs[selectedIndex], cancelled: false });
                return;
              }
              if (matchesKey(data, Key.escape)) {
                done({ cancelled: true });
              }
            }

            function render(width: number): string[] {
              const lines: string[] = [];
              lines.push(theme.fg("accent", "─".repeat(width)));
              lines.push(theme.fg("accent", theme.bold(" 👀 Select Job to Review")) + theme.fg("dim", ` (${jobs.length})`));
              lines.push("");

              for (let i = 0; i < jobs.length; i++) {
                const job = jobs[i];
                const isSelected = i === selectedIndex;
                const progress = job.taskCount > 0 ? ` [${job.doneCount}/${job.taskCount}]` : "";

                const prefix = isSelected ? theme.fg("accent", "❯ ") : "  ";
                const titleStyle = isSelected ? theme.fg("accent", job.title) : theme.fg("text", job.title);
                const meta = theme.fg("dim", `${progress}`);

                lines.push(prefix + titleStyle + meta);
              }

              lines.push("");
              lines.push(theme.fg("dim", "  ↑↓ navigate • enter select • esc cancel"));
              lines.push(theme.fg("accent", "─".repeat(width)));
              return lines;
            }

            return { render, invalidate() {}, handleInput };
          }
        );

        if (!result || result.cancelled) return;
        jobPath = result.job!.filepath;
      }

      promoteJob(jobPath, "review");
      pi.sendUserMessage(buildReviewPrompt(jobPath));
    },
  });

  // /job:promote - Promote job to next phase
  pi.registerCommand("job:promote", {
    description: "Promote a job to the next phase",
    handler: async (args, ctx) => {
      let jobPath: string;

      if (args?.trim()) {
        jobPath = path.resolve(ctx.cwd, args.trim());
      } else {
        const job = await selectJob(ctx, ctx.cwd);
        if (!job) return;
        jobPath = job.filepath;
      }

      const job = readJob(jobPath);
      if (!job) {
        ctx.ui.notify(`Invalid job file`, "error");
        return;
      }

      const nextPhase = getNextPhase(job.phase);
      if (!nextPhase) {
        ctx.ui.notify(`Job is already at final phase (${job.phase})`, "warning");
        return;
      }

      promoteJob(jobPath);
      ctx.ui.notify(`Promoted to ${nextPhase}`, "info");

      // Auto-start appropriate workflow
      if (nextPhase === "planning") {
        pi.sendUserMessage(buildPlanningPrompt(jobPath));
      } else if (nextPhase === "executing") {
        pi.sendUserMessage(buildExecutionPrompt(jobPath));
      } else if (nextPhase === "review") {
        pi.sendUserMessage(buildReviewPrompt(jobPath));
      }
    },
  });

  // /job:demote - Demote job to previous phase
  pi.registerCommand("job:demote", {
    description: "Demote a job to the previous phase",
    handler: async (args, ctx) => {
      let jobPath: string;

      if (args?.trim()) {
        jobPath = path.resolve(ctx.cwd, args.trim());
      } else {
        const job = await selectJob(ctx, ctx.cwd);
        if (!job) return;
        jobPath = job.filepath;
      }

      const job = readJob(jobPath);
      if (!job) {
        ctx.ui.notify(`Invalid job file`, "error");
        return;
      }

      const prevPhase = getPreviousPhase(job.phase);
      if (!prevPhase) {
        ctx.ui.notify(`Job is already at first phase (${job.phase})`, "warning");
        return;
      }

      demoteJob(jobPath);
      ctx.ui.notify(`Demoted to ${prevPhase}`, "info");
    },
  });

  // /job:list - List all jobs
  pi.registerCommand("job:list", {
    description: "List all jobs with phase filtering and management",
    handler: async (_args, ctx) => {
      await showJobList(ctx, ctx.cwd);
    },
  });

  // /jobs - Alias for /job:list
  pi.registerCommand("jobs", {
    description: "List all jobs (alias for /job:list)",
    handler: async (_args, ctx) => {
      await showJobList(ctx, ctx.cwd);
    },
  });

  // /job:archive - Archive a completed job
  pi.registerCommand("job:archive", {
    description: "Archive a completed job to the archived/ subdirectory",
    handler: async (args, ctx) => {
      let jobPath: string;

      if (args?.trim()) {
        jobPath = path.resolve(ctx.cwd, args.trim());
      } else {
        const job = await selectJob(ctx, ctx.cwd, "complete");
        if (!job) return;
        jobPath = job.filepath;
      }

      if (archiveJob(jobPath)) {
        ctx.ui.notify("Job archived", "info");
      } else {
        ctx.ui.notify("Failed to archive job", "error");
      }
    },
  });

  // /job:unarchive - Restore an archived job
  pi.registerCommand("job:unarchive", {
    description: "Restore an archived job to active jobs",
    handler: async (args, ctx) => {
      const dirs = getJobDirectories(ctx.cwd);
      const archivedJobs: JobFile[] = [];

      for (const dir of dirs) {
        const archivedDir = path.join(dir, "archived");
        if (!fs.existsSync(archivedDir)) continue;

        try {
          const files = fs.readdirSync(archivedDir, { withFileTypes: true });
          for (const file of files) {
            if (!file.isFile() || !file.name.endsWith(".md")) continue;
            const job = readJob(path.join(archivedDir, file.name));
            if (job) archivedJobs.push(job);
          }
        } catch {
          // Ignore
        }
      }

      if (archivedJobs.length === 0) {
        ctx.ui.notify("No archived jobs found", "info");
        return;
      }

      let jobPath: string;

      if (args?.trim()) {
        jobPath = path.resolve(ctx.cwd, args.trim());
      } else {
        const result = await ctx.ui.custom<{ job?: JobFile; cancelled: boolean } | null>(
          (tui: any, theme: any, _kb: any, done: any) => {
            let selectedIndex = 0;

            function refresh() {
              tui.requestRender();
            }

            function handleInput(data: string) {
              if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
                selectedIndex = Math.max(0, selectedIndex - 1);
                refresh();
                return;
              }
              if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
                selectedIndex = Math.min(archivedJobs.length - 1, selectedIndex + 1);
                refresh();
                return;
              }
              if (matchesKey(data, Key.enter)) {
                done({ job: archivedJobs[selectedIndex], cancelled: false });
                return;
              }
              if (matchesKey(data, Key.escape)) {
                done({ cancelled: true });
              }
            }

            function render(width: number): string[] {
              const lines: string[] = [];
              lines.push(theme.fg("accent", "─".repeat(width)));
              lines.push(theme.fg("accent", theme.bold(" 📦 Archived Jobs")) + theme.fg("dim", ` (${archivedJobs.length})`));
              lines.push("");

              for (let i = 0; i < archivedJobs.length; i++) {
                const job = archivedJobs[i];
                const isSelected = i === selectedIndex;
                const prefix = isSelected ? theme.fg("accent", "❯ ") : "  ";
                const titleStyle = isSelected ? theme.fg("accent", job.title) : theme.fg("text", job.title);
                lines.push(prefix + titleStyle);
              }

              lines.push("");
              lines.push(theme.fg("dim", "  ↑↓ navigate • enter select • esc cancel"));
              lines.push(theme.fg("accent", "─".repeat(width)));
              return lines;
            }

            return { render, invalidate() {}, handleInput };
          }
        );

        if (!result || result.cancelled) return;
        jobPath = result.job!.filepath;
      }

      if (unarchiveJob(jobPath)) {
        ctx.ui.notify("Job restored", "info");
      } else {
        ctx.ui.notify("Failed to restore job", "error");
      }
    },
  });

  // /job:locations - Manage job storage locations
  pi.registerCommand("job:locations", {
    description: "Manage job storage locations",
    handler: async (_args, ctx) => {
      const config = loadJobConfig(ctx.cwd);
      const defaultLocs = getDefaultJobDirs(ctx.cwd);
      const currentLocs = config?.locations || defaultLocs;

      const result = await ctx.ui.custom<{ action: string; location?: string } | null>(
        (tui: any, theme: any, _kb: any, done: any) => {
          let selectedIndex = 0;
          const options = [
            { label: "View current locations", action: "view" },
            { label: "Add location", action: "add" },
            { label: "Remove location", action: "remove" },
            { label: "Reset to defaults", action: "reset" },
          ];

          function refresh() {
            tui.requestRender();
          }

          function handleInput(data: string) {
            if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
              selectedIndex = Math.max(0, selectedIndex - 1);
              refresh();
              return;
            }
            if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
              selectedIndex = Math.min(options.length - 1, selectedIndex + 1);
              refresh();
              return;
            }
            if (matchesKey(data, Key.enter)) {
              done({ action: options[selectedIndex].action });
              return;
            }
            if (matchesKey(data, Key.escape)) {
              done({ action: "cancel" });
            }
          }

          function render(width: number): string[] {
            const lines: string[] = [];
            lines.push(theme.fg("accent", "─".repeat(width)));
            lines.push(theme.fg("accent", theme.bold(" 📁 Job Locations")));
            lines.push("");

            lines.push(theme.fg("dim", "Current locations:"));
            for (const loc of currentLocs) {
              const isDefault = loc === (config?.defaultLocation || currentLocs[0]);
              lines.push(`  ${isDefault ? "★" : " "} ${loc}`);
            }
            lines.push("");

            for (let i = 0; i < options.length; i++) {
              const isSelected = i === selectedIndex;
              const prefix = isSelected ? theme.fg("accent", "❯ ") : "  ";
              const label = isSelected ? theme.fg("accent", options[i].label) : theme.fg("text", options[i].label);
              lines.push(prefix + label);
            }

            lines.push("");
            lines.push(theme.fg("dim", "  ↑↓ navigate • enter select • esc cancel"));
            lines.push(theme.fg("accent", "─".repeat(width)));
            return lines;
          }

          return { render, invalidate() {}, handleInput };
        }
      );

      if (!result || result.action === "cancel") return;

      switch (result.action) {
        case "view": {
          let msg = "Current job locations:\n\n";
          for (let i = 0; i < currentLocs.length; i++) {
            const isDefault = i === 0 && !config?.defaultLocation;
            msg += `${isDefault ? "★" : " "} ${currentLocs[i]}\n`;
          }
          msg += "\n★ = default location for new jobs";
          ctx.ui.notify(msg, "info");
          break;
        }

        case "add": {
          const newLoc = await ctx.ui.input("New location path:", "~/.pi/jobs or ./jobs");
          if (!newLoc) return;

          const resolvedLoc = resolveLocationPath(newLoc, ctx.cwd);
          const newConfig: JobConfig = {
            locations: [...currentLocs, resolvedLoc],
            defaultLocation: config?.defaultLocation || currentLocs[0],
          };
          saveJobConfig(ctx.cwd, newConfig);
          ctx.ui.notify(`Added location: ${resolvedLoc}`, "info");
          break;
        }

        case "remove": {
          if (currentLocs.length <= 1) {
            ctx.ui.notify("Cannot remove the last location", "error");
            return;
          }
          // Show selector for removal
          const toRemove = await ctx.ui.custom<{ index?: number; cancelled: boolean } | null>(
            (tui: any, theme: any, _kb: any, done: any) => {
              let selectedIndex = 0;

              function refresh() {
                tui.requestRender();
              }

              function handleInput(data: string) {
                if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
                  selectedIndex = Math.max(0, selectedIndex - 1);
                  refresh();
                  return;
                }
                if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
                  selectedIndex = Math.min(currentLocs.length - 1, selectedIndex + 1);
                  refresh();
                  return;
                }
                if (matchesKey(data, Key.enter)) {
                  done({ index: selectedIndex, cancelled: false });
                  return;
                }
                if (matchesKey(data, Key.escape)) {
                  done({ cancelled: true });
                }
              }

              function render(width: number): string[] {
                const lines: string[] = [];
                lines.push(theme.fg("accent", "─".repeat(width)));
                lines.push(theme.fg("accent", theme.bold(" Select location to remove")));
                lines.push("");

                for (let i = 0; i < currentLocs.length; i++) {
                  const isSelected = i === selectedIndex;
                  const prefix = isSelected ? theme.fg("accent", "❯ ") : "  ";
                  lines.push(prefix + currentLocs[i]);
                }

                lines.push("");
                lines.push(theme.fg("dim", "  ↑↓ navigate • enter select • esc cancel"));
                lines.push(theme.fg("accent", "─".repeat(width)));
                return lines;
              }

              return { render, invalidate() {}, handleInput };
            }
          );

          if (!toRemove || toRemove.cancelled || toRemove.index === undefined) return;

          const newLocs = [...currentLocs];
          newLocs.splice(toRemove.index, 1);
          const newConfig: JobConfig = {
            locations: newLocs,
            defaultLocation: config?.defaultLocation,
          };
          saveJobConfig(ctx.cwd, newConfig);
          ctx.ui.notify("Location removed", "info");
          break;
        }

        case "reset": {
          const configPath = getWorkspaceConfigPath(ctx.cwd);
          if (fs.existsSync(configPath)) {
            fs.unlinkSync(configPath);
          }
          ctx.ui.notify("Reset to default locations", "info");
          break;
        }
      }
    },
  });

  // Job list UI (shared by /job:list and /jobs)
  async function showJobList(ctx: any, cwd: string) {
    const jobs = listJobs(cwd);

    if (jobs.length === 0) {
      ctx.ui.notify("No jobs found. Use /job to create one.", "info");
      return;
    }

    const result = await ctx.ui.custom<
      | { action: "view" | "plan" | "exec" | "review" | "promote" | "demote" | "archive" | "delete"; job: JobFile }
      | { action: "cancel" }
      | null
    >((tui: any, theme: any, _kb: any, done: any) => {
      let selectedIndex = 0;
      let filterPhase: JobPhase | null = null;
      let filterText = "";
      let confirmDelete: JobFile | null = null;
      let showHelp = false;

      function getFilteredJobs() {
        let filtered = jobs;
        if (filterPhase) {
          filtered = filtered.filter((j) => j.phase === filterPhase);
        }
        if (filterText) {
          const lower = filterText.toLowerCase();
          filtered = filtered.filter((j) => j.title.toLowerCase().includes(lower) || j.tags.some((t) => t.toLowerCase().includes(lower)));
        }
        return filtered;
      }

      function refresh() {
        tui.requestRender();
      }

      function handleInput(data: string) {
        if (showHelp) {
          if (matchesKey(data, Key.escape) || matchesKey(data, "q")) {
            showHelp = false;
            refresh();
          }
          return;
        }

        if (confirmDelete) {
          if (matchesKey(data, "y") || matchesKey(data, "Y")) {
            done({ action: "delete", job: confirmDelete });
            return;
          }
          if (matchesKey(data, "n") || matchesKey(data, "N") || matchesKey(data, Key.escape)) {
            confirmDelete = null;
            refresh();
            return;
          }
          return;
        }

        // Text filter
        if (data.length === 1 && data >= " " && data <= "~" && data !== "/") {
          filterText += data;
          selectedIndex = 0;
          refresh();
          return;
        }
        if (matchesKey(data, Key.backspace) || data === "\x7f") {
          filterText = filterText.slice(0, -1);
          selectedIndex = 0;
          refresh();
          return;
        }

        const filtered = getFilteredJobs();

        if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
          selectedIndex = Math.max(0, selectedIndex - 1);
          refresh();
          return;
        }
        if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
          selectedIndex = Math.min(filtered.length - 1, selectedIndex + 1);
          refresh();
          return;
        }

        // Phase filter shortcuts
        if (data === "1") {
          filterPhase = filterPhase === "backlog" ? null : "backlog";
          selectedIndex = 0;
          refresh();
          return;
        }
        if (data === "2") {
          filterPhase = filterPhase === "planning" ? null : "planning";
          selectedIndex = 0;
          refresh();
          return;
        }
        if (data === "3") {
          filterPhase = filterPhase === "ready" ? null : "ready";
          selectedIndex = 0;
          refresh();
          return;
        }
        if (data === "4") {
          filterPhase = filterPhase === "executing" ? null : "executing";
          selectedIndex = 0;
          refresh();
          return;
        }
        if (data === "5") {
          filterPhase = filterPhase === "review" ? null : "review";
          selectedIndex = 0;
          refresh();
          return;
        }
        if (data === "6") {
          filterPhase = filterPhase === "complete" ? null : "complete";
          selectedIndex = 0;
          refresh();
          return;
        }

        const currentJob = filtered[selectedIndex];
        if (!currentJob) return;

        if (matchesKey(data, Key.enter) || data === "v") {
          done({ action: "view", job: currentJob });
          return;
        }
        if (data === "p") {
          done({ action: "plan", job: currentJob });
          return;
        }
        if (data === "e") {
          done({ action: "exec", job: currentJob });
          return;
        }
        if (data === "r") {
          done({ action: "review", job: currentJob });
          return;
        }
        if (data === ">") {
          done({ action: "promote", job: currentJob });
          return;
        }
        if (data === "<") {
          done({ action: "demote", job: currentJob });
          return;
        }
        if (data === "a") {
          done({ action: "archive", job: currentJob });
          return;
        }
        if (data === "d" || data === "D") {
          confirmDelete = currentJob;
          refresh();
          return;
        }
        if (data === "?") {
          showHelp = true;
          refresh();
          return;
        }
        if (matchesKey(data, Key.escape) || data === "q") {
          done({ action: "cancel" });
        }
      }

      function render(width: number): string[] {
        const lines: string[] = [];
        const filtered = getFilteredJobs();

        if (showHelp) {
          lines.push(theme.fg("accent", "─".repeat(width)));
          lines.push(theme.fg("accent", theme.bold(" Keyboard Shortcuts ")));
          lines.push("");
          lines.push("  ↑/k     Move up");
          lines.push("  ↓/j     Move down");
          lines.push("  enter/v View job");
          lines.push("  p       Start planning");
          lines.push("  e       Start executing");
          lines.push("  r       Start review");
          lines.push("  >       Promote phase");
          lines.push("  <       Demote phase");
          lines.push("  a       Archive job");
          lines.push("  d       Delete job");
          lines.push("  1-6     Filter by phase");
          lines.push("  /       Clear filters");
          lines.push("  ?       Show this help");
          lines.push("  q/esc   Cancel");
          lines.push("");
          lines.push(theme.fg("dim", "Press any key to close help"));
          lines.push(theme.fg("accent", "─".repeat(width)));
          return lines;
        }

        lines.push(theme.fg("accent", "─".repeat(width)));

        // Header with filters
        let header = theme.fg("accent", theme.bold(" 🎯 Jobs")) + theme.fg("dim", ` (${filtered.length}/${jobs.length})`);
        if (filterPhase) {
          header += theme.fg("accent", ` [${filterPhase}]`);
        }
        lines.push(header);

        if (filterText) {
          lines.push(theme.fg("dim", ` Filter: "${filterText}" (backspace to clear)`));
        } else {
          lines.push(theme.fg("dim", " Type to filter • 1-6 phase filter • ? for help"));
        }
        lines.push("");

        // Phase legend
        lines.push(
          theme.fg("dim", `${PHASE_ICONS.backlog}1 ${PHASE_ICONS.planning}2 ${PHASE_ICONS.ready}3 ${PHASE_ICONS.executing}4 ${PHASE_ICONS.review}5 ${PHASE_ICONS.complete}6`)
        );
        lines.push("");

        // Job list
        const maxVisible = 12;
        const startIdx = Math.max(0, Math.min(selectedIndex, filtered.length - maxVisible));
        const endIdx = Math.min(startIdx + maxVisible, filtered.length);

        for (let i = startIdx; i < endIdx; i++) {
          const job = filtered[i];
          const isSelected = i === selectedIndex;
          const icon = PHASE_ICONS[job.phase];
          const dateFormatted = job.date.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
          const progress = job.taskCount > 0 ? ` [${job.doneCount}/${job.taskCount}]` : "";

          const prefix = isSelected ? theme.fg("accent", "❯ ") : "  ";
          const titleStyle = isSelected ? theme.fg("accent", job.title) : theme.fg("text", job.title);
          const meta = theme.fg("dim", `${icon} ${job.phase}${progress} (${dateFormatted})`);

          lines.push(prefix + titleStyle + meta);

          if (isSelected && job.tags.length > 0) {
            lines.push(theme.fg("muted", `    #${job.tags.join(" #")}`));
          }
        }

        if (filtered.length === 0) {
          lines.push(theme.fg("dim", "  No jobs match the current filters."));
        }

        lines.push("");

        if (confirmDelete) {
          lines.push(theme.fg("warning", `  Delete "${confirmDelete.title}"? `) + theme.fg("dim", "(y/n)"));
        } else {
          lines.push(theme.fg("dim", "  v view • p plan • e exec • r review • > promote • < demote • d delete"));
        }
        lines.push(theme.fg("accent", "─".repeat(width)));

        return lines;
      }

      return { render, invalidate() {}, handleInput };
    });

    if (!result || result.action === "cancel") return;

    switch (result.action) {
      case "view":
        pi.sendUserMessage(`Read this job file and summarize its current state: ${result.job.filepath}`);
        break;

      case "plan": {
        const job = promoteJob(result.job.filepath, "planning");
        if (job) {
          pi.sendUserMessage(buildPlanningPrompt(result.job.filepath));
        }
        break;
      }

      case "exec": {
        const job = readJob(result.job.filepath);
        if (job && job.phase !== "ready" && job.phase !== "executing") {
          promoteJob(result.job.filepath, "ready");
        }
        promoteJob(result.job.filepath, "executing");
        pi.sendUserMessage(buildExecutionPrompt(result.job.filepath));
        break;
      }

      case "review": {
        const job = promoteJob(result.job.filepath, "review");
        if (job) {
          pi.sendUserMessage(buildReviewPrompt(result.job.filepath));
        }
        break;
      }

      case "promote": {
        const job = promoteJob(result.job.filepath);
        if (job) {
          ctx.ui.notify(`Promoted to ${job.phase}`, "info");
          // Auto-start workflow
          if (job.phase === "planning") {
            pi.sendUserMessage(buildPlanningPrompt(result.job.filepath));
          } else if (job.phase === "executing") {
            pi.sendUserMessage(buildExecutionPrompt(result.job.filepath));
          } else if (job.phase === "review") {
            pi.sendUserMessage(buildReviewPrompt(result.job.filepath));
          }
        }
        break;
      }

      case "demote": {
        const job = demoteJob(result.job.filepath);
        if (job) {
          ctx.ui.notify(`Demoted to ${job.phase}`, "info");
        }
        break;
      }

      case "archive": {
        if (archiveJob(result.job.filepath)) {
          ctx.ui.notify("Job archived", "info");
        }
        break;
      }

      case "delete": {
        try {
          fs.unlinkSync(result.job.filepath);
          ctx.ui.notify("Job deleted", "info");
        } catch {
          ctx.ui.notify("Failed to delete job", "error");
        }
        break;
      }
    }
  }
}
