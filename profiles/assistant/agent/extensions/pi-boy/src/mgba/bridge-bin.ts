import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let cachedBridgeBinaryPath: string | null = null;

function isTruthy(value: string | undefined): boolean {
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
}

function resolveBridgeProjectDir(): string {
	const fileDir = dirname(fileURLToPath(import.meta.url));
	return resolve(fileDir, "..", "..", "mgba-bridge");
}

function resolveDefaultBridgeBinaryPath(projectDir: string): string {
	const executable = process.platform === "win32" ? "pi-boy-mgba-bridge.exe" : "pi-boy-mgba-bridge";
	return join(projectDir, "build", executable);
}

export function resolveMgbaBridgeBinaryPath(): string {
	const envPath = process.env.PI_BOY_MGBA_BRIDGE_BIN?.trim();
	if (envPath) {
		if (!existsSync(envPath)) {
			throw new Error(`PI_BOY_MGBA_BRIDGE_BIN points to a missing file: ${envPath}`);
		}
		return envPath;
	}

	if (cachedBridgeBinaryPath && existsSync(cachedBridgeBinaryPath) && !isTruthy(process.env.PI_BOY_MGBA_BRIDGE_REBUILD)) {
		return cachedBridgeBinaryPath;
	}

	const projectDir = resolveBridgeProjectDir();
	const buildScript = join(projectDir, "build.sh");
	const binaryPath = resolveDefaultBridgeBinaryPath(projectDir);
	const shouldBuild = !existsSync(binaryPath) || isTruthy(process.env.PI_BOY_MGBA_BRIDGE_REBUILD);

	if (shouldBuild) {
		const result = spawnSync(buildScript, [], {
			cwd: projectDir,
			encoding: "utf8",
		});

		if (result.error) {
			throw new Error(`Failed to build mGBA bridge: ${result.error.message}`);
		}

		if (result.status !== 0) {
			const stderr = result.stderr?.trim();
			const stdout = result.stdout?.trim();
			const detail = [stderr, stdout].filter(Boolean).join("\n");
			throw new Error(`Failed to build mGBA bridge. ${detail || "build.sh exited with a non-zero status"}`);
		}
	}

	if (!existsSync(binaryPath)) {
		throw new Error(`mGBA bridge binary not found after build: ${binaryPath}`);
	}

	cachedBridgeBinaryPath = binaryPath;
	return binaryPath;
}
