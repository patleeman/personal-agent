import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PI_BOY_ENTRY = "./src/extension.ts";

type PiBoyExtension = (pi: ExtensionAPI) => void | Promise<void>;

let initialized = false;
let initializationError: string | null = null;
let initializationPromise: Promise<void> | null = null;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function initializePiBoy(pi: ExtensionAPI): Promise<void> {
  if (initialized || initializationError) {
    return;
  }

  if (!initializationPromise) {
    initializationPromise = (async () => {
      try {
        const module = (await import(PI_BOY_ENTRY)) as { default?: unknown };
        const extension = module.default;

        if (typeof extension !== "function") {
          throw new Error("Extension module does not export a default function");
        }

        await (extension as PiBoyExtension)(pi);
        initialized = true;
      } catch (error) {
        initializationError = toErrorMessage(error);
      } finally {
        initializationPromise = null;
      }
    })();
  }

  await initializationPromise;
}

export default function registerPiBoyProxy(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) {
      // Do not load pi-boy for daemon/print runs.
      return;
    }

    await initializePiBoy(pi);

    if (initializationError) {
      ctx.ui.notify(
        `pi-boy unavailable: ${initializationError}. Install dependencies with: npm install (in profiles/assistant/agent/extensions/pi-boy)`,
        "warning",
      );
    }
  });
}
