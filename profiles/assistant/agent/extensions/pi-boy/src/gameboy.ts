import { GB_HEIGHT, GB_WIDTH } from "./constants.js";
import { createMgbaGameboy } from "./gameboy-mgba.js";
import { KEYMAP, type GameboyInstance } from "./gameboy-types.js";

export { KEYMAP };
export type { GameboyInstance, GameboyKey } from "./gameboy-types.js";

export function createGameboy(): GameboyInstance {
	return createMgbaGameboy();
}

export function runSelfTest(rom: Buffer): string | null {
	const gb = createGameboy();
	try {
		gb.loadRom(rom);

		for (let i = 0; i < 90; i++) {
			if (i === 20) gb.pressKeys([KEYMAP.START]);
			gb.doFrame();
		}

		const screen = gb.getScreen();
		if (!screen || screen.length !== GB_WIDTH * GB_HEIGHT * 4) {
			return `unexpected framebuffer size (${screen?.length ?? "none"})`;
		}

		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	} finally {
		gb.dispose?.();
	}
}
