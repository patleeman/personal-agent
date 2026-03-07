export const KEYMAP = {
	RIGHT: 0,
	LEFT: 1,
	UP: 2,
	DOWN: 3,
	A: 4,
	B: 5,
	SELECT: 6,
	START: 7,
} as const;

export type GameboyKey = (typeof KEYMAP)[keyof typeof KEYMAP];

export interface GameboyInstance {
	loadRom: (romData: Buffer) => void;
	doFrame: () => ArrayLike<number>;
	getScreen: () => ArrayLike<number>;
	getAudio: () => ArrayLike<number> | null | undefined;
	getAudioSampleRate: () => number;
	pressKeys: (keys: GameboyKey[]) => void;
	saveState: () => Buffer;
	loadState: (state: Buffer) => void;
	dispose?: () => void;
}
