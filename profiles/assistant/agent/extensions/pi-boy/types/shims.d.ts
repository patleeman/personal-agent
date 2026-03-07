declare module "@mariozechner/pi-coding-agent" {
	export type NotifyLevel = "info" | "warning" | "error";

	type DialogOptions = {
		timeout?: number;
		signal?: AbortSignal;
	};

	export interface CommandContext {
		hasUI: boolean;
		cwd: string;
		ui: {
			notify: (message: string, level: NotifyLevel) => void;
			select: (title: string, options: string[], opts?: DialogOptions) => Promise<string | undefined>;
			confirm: (title: string, message: string, opts?: DialogOptions) => Promise<boolean>;
			input: (title: string, initialValue?: string, opts?: DialogOptions) => Promise<string | undefined>;
			custom: <T>(
				factory: (
					tui: import("@mariozechner/pi-tui").TUI,
					theme: unknown,
					keybindings: unknown,
					done: (value: T) => void,
				) => unknown,
				options?: {
					overlay?: boolean;
					overlayOptions?: {
						width?: string;
						maxHeight?: string;
						anchor?: string;
						margin?: number;
					};
				},
			) => Promise<T>;
		};
	}

	export interface ExtensionAPI {
		on: (
			event: "session_start",
			handler: (event: unknown, ctx: CommandContext) => void | Promise<void>,
		) => void;
		registerCommand: (
			name: string,
			definition: {
				description: string;
				getArgumentCompletions?: (
					argumentPrefix: string,
				) => import("@mariozechner/pi-tui").AutocompleteItem[] | null;
				handler: (args: string, ctx: CommandContext) => void | Promise<void>;
			},
		) => void;
	}
}

declare module "@mariozechner/pi-tui" {
	export type AutocompleteItem = {
		value: string;
		label?: string;
	};

	export const Key: {
		left: string;
		right: string;
		up: string;
		down: string;
		enter: string;
		tab: string;
		backspace: string;
		escape: string;
		space: string;
		shift: (key: string) => string;
	};

	export function matchesKey(data: string, key: string): boolean;
	export function isKeyRelease(data: string): boolean;
	export function visibleWidth(text: string): number;
	export function truncateToWidth(text: string, width: number, ellipsis?: string, preferEnd?: boolean): string;
	export function getCapabilities(): { images?: "kitty" | "iterm2" };
	export function getCellDimensions(): { widthPx: number; heightPx: number };
	export function renderImage(
		base64: string,
		size: { widthPx: number; heightPx: number },
		options: { maxWidthCells: number; maxHeightCells: number; imageId?: number },
	): { sequence: string; rows: number; imageId?: number } | null;
	export function allocateImageId(): number;
	export function deleteKittyImage(id: number): string;

	export interface TUI {
		terminal?: {
			rows: number;
			kittyProtocolActive?: boolean;
			write: (data: string) => void;
		};
		requestRender: (full?: boolean) => void;
		getClearOnShrink: () => boolean;
		setClearOnShrink: (value: boolean) => void;
	}
}

declare module "pngjs" {
	export interface PngWriteOptions {
		colorType?: number;
		inputHasAlpha?: boolean;
		inputColorType?: number;
		deflateLevel?: number;
		filterType?: number;
	}

	export class PNG {
		constructor(options: { width: number; height: number });
		data: Buffer;
		width: number;
		height: number;
		static sync: {
			write: (png: PNG, options?: PngWriteOptions) => Buffer;
		};
	}

	const pngjs: { PNG: typeof PNG };
	export default pngjs;
}
