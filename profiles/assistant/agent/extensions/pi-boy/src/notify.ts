export type NotifyLevel = "info" | "warning" | "error";

export interface NotifyContextLike {
	hasUI: boolean;
	ui: { notify: (message: string, level: NotifyLevel) => void };
}

export function notify(ctx: NotifyContextLike, message: string, level: NotifyLevel): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
	}
}
