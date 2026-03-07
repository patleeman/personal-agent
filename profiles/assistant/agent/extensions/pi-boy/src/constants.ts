import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_PATH = join(homedir(), ".config", "pi-boy", "config.json");
export const SAVE_STATE_DIR = join(homedir(), ".config", "pi-boy", "states");

export const GB_WIDTH = 160;
export const GB_HEIGHT = 144;

export const EMULATOR_FRAME_MS = 1000 / 60;
export const MAX_CATCHUP_STEPS = 64;

export const IMAGE_RENDER_FPS = 30;
export const ANSI_RENDER_FPS = 30;
export const ANSI_MAX_COLUMNS = 96;
export const ANSI_MAX_ROWS = 40;
export const VIEWPORT_SAFETY_ROWS = 12;
export const MIN_IMAGE_COLUMNS = 10;
export const MAX_INTEGER_UPSCALE = 5;

export const MGBA_AUDIO_INPUT_SAMPLE_RATE = 131_072;
export const AUDIO_OUTPUT_SAMPLE_RATE = 44_100;
export const AUDIO_SPEAKER_SAMPLES_PER_FRAME = 512;
export const AUDIO_SPEAKER_HIGH_WATER_MARK = 32_768;
export const AUDIO_PRIME_FRAMES = 512;
export const AUDIO_PRIME_CHUNKS = 1;
export const AUDIO_MAX_QUEUE_BYTES = 24_576;
export const AUDIO_DC_ALPHA = 0.004;
export const AUDIO_LOW_PASS_ALPHA = 0.28;
export const AUDIO_GAIN = 1.5;
export const FFPLAY_CANDIDATES = ["ffplay", "/opt/homebrew/bin/ffplay", "/usr/local/bin/ffplay", "/usr/bin/ffplay"];

export const TAP_FRAMES_ACTION = 6;
export const TAP_FRAMES_DIRECTION = 4;

export const PNG_DEFLATE_LEVEL = 1;
export const PNG_FILTER_TYPE = 4;
