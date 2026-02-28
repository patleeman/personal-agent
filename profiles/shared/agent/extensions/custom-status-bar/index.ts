/**
 * Custom Status Bar Extension
 *
 * Displays:
 * - Current working directory
 * - Git branch
 * - Model name
 * - Thinking level
 * - Context usage bar (grey to red gradient)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          // Get current working directory (shortened)
          const cwd = ctx.cwd;
          const cwdShort = cwd.replace(/^\/Users\/[^/]+/, "~");
          const cwdDisplay = cwdShort.length > 25 
            ? "…" + cwdShort.slice(-24) 
            : cwdShort;

          // Get git branch
          const branch = footerData.getGitBranch();

          // Get model
          const model = ctx.model?.id || "no-model";

          // Get thinking level
          const thinkingLevel = pi.getThinkingLevel();
          const thinkingColors: Record<string, string> = {
            off: "thinkingOff",
            minimal: "thinkingMinimal",
            low: "thinkingLow",
            medium: "thinkingMedium",
            high: "thinkingHigh",
            xhigh: "thinkingXhigh",
          };
          const thinkingColor = thinkingColors[thinkingLevel] || "dim";

          // Get context usage
          const usage = ctx.getContextUsage();
          let contextPercent = 0;
          let contextTokens = 0;
          let contextMax = 0;
          if (usage) {
            contextTokens = usage.tokens;
            contextMax = ctx.model?.contextWindow || 200000;
            contextPercent = Math.min(100, (contextTokens / contextMax) * 100);
          }

          // Create context bar (10 chars wide)
          const barWidth = 10;
          const filledCount = Math.round((contextPercent / 100) * barWidth);
          
          // Color gradient: grey -> yellow -> red based on percentage
          const getBarColor = (percent: number): string => {
            if (percent < 50) return "dim";
            if (percent < 75) return "warning";
            return "error";
          };
          
          const barColor = getBarColor(contextPercent);
          const filled = "█".repeat(filledCount);
          const empty = "░".repeat(barWidth - filledCount);
          const bar = theme.fg(barColor, filled) + theme.fg("dim", empty);
          const percentStr = `${Math.round(contextPercent)}%`;

          // Build the status line
          const parts: string[] = [];

          // Directory
          parts.push(theme.fg("muted", "📁 ") + theme.fg("dim", cwdDisplay));

          // Git branch
          if (branch) {
            parts.push(theme.fg("muted", "⎇ ") + theme.fg("accent", branch));
          }

          // Model
          parts.push(theme.fg("muted", "🤖 ") + theme.fg("text", model));

          // Thinking level
          if (thinkingLevel !== "off") {
            parts.push(theme.fg("muted", "💭 ") + theme.fg(thinkingColor, thinkingLevel));
          }

          // Context bar
          parts.push(theme.fg("muted", "ctx: ") + bar + " " + theme.fg("dim", percentStr));

          // Join with separators
          const separator = theme.fg("borderMuted", " │ ");
          const line = parts.join(separator);

          return [truncateToWidth(line, width)];
        },
      };
    });
  });

  // Re-render on model changes to update thinking level display
  pi.on("model_select", (_event, ctx) => {
    if (ctx.hasUI) {
      // Footer will re-render on next frame
    }
  });
}
