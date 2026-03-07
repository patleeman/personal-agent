#include <dlfcn.h>
#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "libretro.h"

#define CMD_LOAD_ROM 1
#define CMD_SET_KEYS 2
#define CMD_DO_FRAME 3
#define CMD_SHUTDOWN 4
#define CMD_GET_AUDIO 5
#define CMD_SAVE_STATE 6
#define CMD_LOAD_STATE 7

#define STATUS_OK 0
#define STATUS_ERR 1

#define REQUEST_HEADER_BYTES 5
#define RESPONSE_HEADER_BYTES 5
#define MAX_PAYLOAD_BYTES (16 * 1024 * 1024)
#define FRAME_WIDTH 160
#define FRAME_HEIGHT 144
#define FRAMEBUFFER_BYTES (FRAME_WIDTH * FRAME_HEIGHT * 4)
#define AUDIO_CHANNELS 2
#define DEFAULT_AUDIO_QUEUE_CAP 4096
#define MAX_AUDIO_QUEUE_SAMPLES (44100 * AUDIO_CHANNELS * 3)

#define KEY_RIGHT (1 << 0)
#define KEY_LEFT (1 << 1)
#define KEY_UP (1 << 2)
#define KEY_DOWN (1 << 3)
#define KEY_A (1 << 4)
#define KEY_B (1 << 5)
#define KEY_SELECT (1 << 6)
#define KEY_START (1 << 7)

typedef void (*retro_set_environment_fn)(retro_environment_t);
typedef void (*retro_set_video_refresh_fn)(retro_video_refresh_t);
typedef void (*retro_set_audio_sample_fn)(retro_audio_sample_t);
typedef void (*retro_set_audio_sample_batch_fn)(retro_audio_sample_batch_t);
typedef void (*retro_set_input_poll_fn)(retro_input_poll_t);
typedef void (*retro_set_input_state_fn)(retro_input_state_t);
typedef void (*retro_init_fn)(void);
typedef void (*retro_deinit_fn)(void);
typedef bool (*retro_load_game_fn)(const struct retro_game_info*);
typedef void (*retro_unload_game_fn)(void);
typedef void (*retro_run_fn)(void);
typedef void (*retro_set_controller_port_device_fn)(unsigned, unsigned);
typedef size_t (*retro_serialize_size_fn)(void);
typedef bool (*retro_serialize_fn)(void*, size_t);
typedef bool (*retro_unserialize_fn)(const void*, size_t);

typedef struct CoreApi {
    void* handle;
    retro_set_environment_fn retro_set_environment;
    retro_set_video_refresh_fn retro_set_video_refresh;
    retro_set_audio_sample_fn retro_set_audio_sample;
    retro_set_audio_sample_batch_fn retro_set_audio_sample_batch;
    retro_set_input_poll_fn retro_set_input_poll;
    retro_set_input_state_fn retro_set_input_state;
    retro_init_fn retro_init;
    retro_deinit_fn retro_deinit;
    retro_load_game_fn retro_load_game;
    retro_unload_game_fn retro_unload_game;
    retro_run_fn retro_run;
    retro_set_controller_port_device_fn retro_set_controller_port_device;
    retro_serialize_size_fn retro_serialize_size;
    retro_serialize_fn retro_serialize;
    retro_unserialize_fn retro_unserialize;
} CoreApi;

typedef struct Request {
    uint8_t command;
    uint8_t* payload;
    size_t payload_len;
} Request;

typedef struct CommandResult {
    uint8_t status;
    const void* payload;
    size_t payload_len;
    const char* error_msg;
    bool free_payload;
} CommandResult;

static CoreApi g_core = {0};
static bool g_core_initialized = false;
static bool g_game_loaded = false;
static enum retro_pixel_format g_pixel_format = RETRO_PIXEL_FORMAT_RGB565;
static uint8_t g_framebuffer[FRAMEBUFFER_BYTES] = {0};
static float* g_audio_queue = NULL;
static size_t g_audio_len = 0;
static size_t g_audio_cap = 0;
static uint8_t* g_rom_data = NULL;
static size_t g_rom_size = 0;
static uint16_t g_input_mask = 0;

static const char* option_value_for_key(const char* key) {
    if (!key) return NULL;
    if (strcmp(key, "mgba_frameskip") == 0) return "disabled";
    if (strcmp(key, "mgba_frameskip_threshold") == 0) return "33";
    if (strcmp(key, "mgba_frameskip_interval") == 0) return "0";
    if (strcmp(key, "mgba_use_bios") == 0) return "OFF";
    if (strcmp(key, "mgba_skip_bios") == 0) return "ON";
    if (strcmp(key, "mgba_sgb_borders") == 0) return "OFF";
    if (strcmp(key, "mgba_allow_opposing_directions") == 0) return "no";
    if (strcmp(key, "mgba_audio_low_pass_filter") == 0) return "disabled";
    if (strcmp(key, "mgba_audio_low_pass_range") == 0) return "60";
    if (strcmp(key, "mgba_gb_model") == 0) return "Autodetect";
    return NULL;
}

static bool env_cb(unsigned cmd, void* data) {
    switch (cmd) {
        case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
            if (!data) return false;
            g_pixel_format = *(enum retro_pixel_format*) data;
            return true;
        case RETRO_ENVIRONMENT_GET_VARIABLE: {
            struct retro_variable* var = (struct retro_variable*) data;
            const char* value = option_value_for_key(var ? var->key : NULL);
            if (!var || !value) return false;
            var->value = value;
            return true;
        }
        case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
            if (data) *(bool*) data = false;
            return true;
        case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
        case RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME:
        case RETRO_ENVIRONMENT_SET_MEMORY_MAPS:
        case RETRO_ENVIRONMENT_SET_GEOMETRY:
        case RETRO_ENVIRONMENT_SET_MINIMUM_AUDIO_LATENCY:
        case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO:
            return true;
        case RETRO_ENVIRONMENT_SET_AUDIO_BUFFER_STATUS_CALLBACK:
        case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
        case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS:
        default:
            return false;
    }
}

static void input_poll_cb(void) {}

static int16_t input_state_cb(unsigned port, unsigned device, unsigned index, unsigned id) {
    (void) index;
    if (port != 0 || device != RETRO_DEVICE_JOYPAD) return 0;

    switch (id) {
        case RETRO_DEVICE_ID_JOYPAD_A:
            return (g_input_mask & KEY_A) ? 1 : 0;
        case RETRO_DEVICE_ID_JOYPAD_B:
            return (g_input_mask & KEY_B) ? 1 : 0;
        case RETRO_DEVICE_ID_JOYPAD_SELECT:
            return (g_input_mask & KEY_SELECT) ? 1 : 0;
        case RETRO_DEVICE_ID_JOYPAD_START:
            return (g_input_mask & KEY_START) ? 1 : 0;
        case RETRO_DEVICE_ID_JOYPAD_RIGHT:
            return (g_input_mask & KEY_RIGHT) ? 1 : 0;
        case RETRO_DEVICE_ID_JOYPAD_LEFT:
            return (g_input_mask & KEY_LEFT) ? 1 : 0;
        case RETRO_DEVICE_ID_JOYPAD_UP:
            return (g_input_mask & KEY_UP) ? 1 : 0;
        case RETRO_DEVICE_ID_JOYPAD_DOWN:
            return (g_input_mask & KEY_DOWN) ? 1 : 0;
        default:
            return 0;
    }
}

static void audio_sample_cb(int16_t left, int16_t right) {
    (void) left;
    (void) right;
}

static bool reserve_audio_samples(size_t required) {
    if (required <= g_audio_cap) return true;

    size_t next_cap = g_audio_cap == 0 ? DEFAULT_AUDIO_QUEUE_CAP : g_audio_cap;
    while (next_cap < required) next_cap *= 2;

    float* next = (float*) realloc(g_audio_queue, next_cap * sizeof(float));
    if (!next) return false;

    g_audio_queue = next;
    g_audio_cap = next_cap;
    return true;
}

static size_t audio_batch_cb(const int16_t* data, size_t frames) {
    size_t samples = frames * AUDIO_CHANNELS;
    if (!data || samples == 0) return frames;

    size_t required = g_audio_len + samples;
    if (!reserve_audio_samples(required)) {
        g_audio_len = 0;
        return frames;
    }

    for (size_t i = 0; i < samples; i++) {
        g_audio_queue[g_audio_len++] = (float) data[i] / 32768.0f;
    }

    if (g_audio_len > MAX_AUDIO_QUEUE_SAMPLES) {
        size_t keep = MAX_AUDIO_QUEUE_SAMPLES;
        size_t drop = g_audio_len - keep;
        memmove(g_audio_queue, g_audio_queue + drop, keep * sizeof(float));
        g_audio_len = keep;
    }

    return frames;
}

static uint8_t expand_5bit(uint16_t value) {
    return (uint8_t) (((value & 0x1F) * 255) / 31);
}

static uint8_t expand_6bit(uint16_t value) {
    return (uint8_t) (((value & 0x3F) * 255) / 63);
}

static void write_rgba_pixel(size_t x, size_t y, uint8_t r, uint8_t g, uint8_t b) {
    size_t idx = (y * FRAME_WIDTH + x) * 4;
    g_framebuffer[idx] = r;
    g_framebuffer[idx + 1] = g;
    g_framebuffer[idx + 2] = b;
    g_framebuffer[idx + 3] = 0xFF;
}

static void write_converted_pixel(size_t x, size_t y, const uint8_t* row, unsigned src_x) {
    switch (g_pixel_format) {
        case RETRO_PIXEL_FORMAT_RGB565: {
            const uint16_t* pixels = (const uint16_t*) row;
            uint16_t px = pixels[src_x];
            write_rgba_pixel(x, y, expand_5bit(px >> 11), expand_6bit(px >> 5), expand_5bit(px));
            return;
        }
        case RETRO_PIXEL_FORMAT_0RGB1555: {
            const uint16_t* pixels = (const uint16_t*) row;
            uint16_t px = pixels[src_x];
            write_rgba_pixel(x, y, expand_5bit(px >> 10), expand_5bit(px >> 5), expand_5bit(px));
            return;
        }
        case RETRO_PIXEL_FORMAT_XRGB8888:
        default: {
            const uint32_t* pixels = (const uint32_t*) row;
            uint32_t px = pixels[src_x];
            write_rgba_pixel(x, y, (uint8_t) ((px >> 16) & 0xFF), (uint8_t) ((px >> 8) & 0xFF), (uint8_t) (px & 0xFF));
            return;
        }
    }
}

static void video_refresh_cb(const void* data, unsigned width, unsigned height, size_t pitch) {
    if (!data || width == 0 || height == 0) return;

    bool crop_x = width >= FRAME_WIDTH;
    bool crop_y = height >= FRAME_HEIGHT;
    unsigned offset_x = crop_x ? (width - FRAME_WIDTH) / 2 : 0;
    unsigned offset_y = crop_y ? (height - FRAME_HEIGHT) / 2 : 0;

    for (size_t y = 0; y < FRAME_HEIGHT; y++) {
        unsigned src_y = crop_y ? (offset_y + (unsigned) y) : (unsigned) ((y * height) / FRAME_HEIGHT);
        if (src_y >= height) src_y = height - 1;
        const uint8_t* row = (const uint8_t*) data + (src_y * pitch);

        for (size_t x = 0; x < FRAME_WIDTH; x++) {
            unsigned src_x = crop_x ? (offset_x + (unsigned) x) : (unsigned) ((x * width) / FRAME_WIDTH);
            if (src_x >= width) src_x = width - 1;
            write_converted_pixel(x, y, row, src_x);
        }
    }
}

static int read_exact(FILE* file, void* buffer, size_t length) {
    uint8_t* out = (uint8_t*) buffer;
    size_t offset = 0;
    while (offset < length) {
        size_t n = fread(out + offset, 1, length - offset, file);
        if (n == 0) {
            if (feof(file)) return 0;
            return -1;
        }
        offset += n;
    }
    return 1;
}

static int write_exact(FILE* file, const void* buffer, size_t length) {
    const uint8_t* in = (const uint8_t*) buffer;
    size_t offset = 0;
    while (offset < length) {
        size_t n = fwrite(in + offset, 1, length - offset, file);
        if (n == 0) return -1;
        offset += n;
    }
    return 0;
}

static int write_response(uint8_t status, const void* payload, size_t length) {
    uint8_t header[RESPONSE_HEADER_BYTES];
    uint32_t len32 = (uint32_t) length;
    header[0] = status;
    memcpy(header + 1, &len32, sizeof(len32));

    if (write_exact(stdout, header, sizeof(header)) != 0) return -1;
    if (length > 0 && write_exact(stdout, payload, length) != 0) return -1;
    fflush(stdout);
    return 0;
}

static int write_error_response(const char* error_msg) {
    size_t length = error_msg ? strlen(error_msg) : 0;
    return write_response(STATUS_ERR, error_msg, length);
}

static char* dirname_of_executable(const char* argv0) {
    char resolved[PATH_MAX];
    const char* path = argv0;
    if (realpath(argv0, resolved)) {
        path = resolved;
    }

    const char* slash = strrchr(path, '/');
    if (!slash) return strdup(".");

    size_t len = (size_t) (slash - path);
    char* out = (char*) malloc(len + 1);
    if (!out) return NULL;
    memcpy(out, path, len);
    out[len] = '\0';
    return out;
}

static void* load_symbol(void* handle, const char* name) {
    void* symbol = dlsym(handle, name);
    if (!symbol) {
        fprintf(stderr, "missing libretro symbol: %s\n", name);
    }
    return symbol;
}

static bool core_has_required_symbols(void) {
    return g_core.retro_set_environment && g_core.retro_set_video_refresh && g_core.retro_set_audio_sample &&
           g_core.retro_set_audio_sample_batch && g_core.retro_set_input_poll && g_core.retro_set_input_state &&
           g_core.retro_init && g_core.retro_deinit && g_core.retro_load_game && g_core.retro_unload_game &&
           g_core.retro_run && g_core.retro_serialize_size && g_core.retro_serialize && g_core.retro_unserialize;
}

static void core_register_callbacks(void) {
    g_core.retro_set_environment(env_cb);
    g_core.retro_set_video_refresh(video_refresh_cb);
    g_core.retro_set_audio_sample(audio_sample_cb);
    g_core.retro_set_audio_sample_batch(audio_batch_cb);
    g_core.retro_set_input_poll(input_poll_cb);
    g_core.retro_set_input_state(input_state_cb);
}

static int core_open(const char* argv0) {
    if (g_core.handle) return 0;

    char* dir = dirname_of_executable(argv0);
    if (!dir) return -1;

    char core_path[PATH_MAX];
    snprintf(core_path, sizeof(core_path), "%s/mgba_libretro.dylib", dir);
    free(dir);

    void* handle = dlopen(core_path, RTLD_NOW | RTLD_LOCAL);
    if (!handle) {
        fprintf(stderr, "failed to open mGBA core: %s\n", dlerror());
        return -1;
    }

    g_core.handle = handle;
    g_core.retro_set_environment = (retro_set_environment_fn) load_symbol(handle, "retro_set_environment");
    g_core.retro_set_video_refresh = (retro_set_video_refresh_fn) load_symbol(handle, "retro_set_video_refresh");
    g_core.retro_set_audio_sample = (retro_set_audio_sample_fn) load_symbol(handle, "retro_set_audio_sample");
    g_core.retro_set_audio_sample_batch = (retro_set_audio_sample_batch_fn) load_symbol(handle, "retro_set_audio_sample_batch");
    g_core.retro_set_input_poll = (retro_set_input_poll_fn) load_symbol(handle, "retro_set_input_poll");
    g_core.retro_set_input_state = (retro_set_input_state_fn) load_symbol(handle, "retro_set_input_state");
    g_core.retro_init = (retro_init_fn) load_symbol(handle, "retro_init");
    g_core.retro_deinit = (retro_deinit_fn) load_symbol(handle, "retro_deinit");
    g_core.retro_load_game = (retro_load_game_fn) load_symbol(handle, "retro_load_game");
    g_core.retro_unload_game = (retro_unload_game_fn) load_symbol(handle, "retro_unload_game");
    g_core.retro_run = (retro_run_fn) load_symbol(handle, "retro_run");
    g_core.retro_serialize_size = (retro_serialize_size_fn) load_symbol(handle, "retro_serialize_size");
    g_core.retro_serialize = (retro_serialize_fn) load_symbol(handle, "retro_serialize");
    g_core.retro_unserialize = (retro_unserialize_fn) load_symbol(handle, "retro_unserialize");
    g_core.retro_set_controller_port_device =
        (retro_set_controller_port_device_fn) dlsym(handle, "retro_set_controller_port_device");

    if (!core_has_required_symbols()) {
        dlclose(handle);
        memset(&g_core, 0, sizeof(g_core));
        return -1;
    }

    core_register_callbacks();
    g_core.retro_init();
    g_core_initialized = true;
    return 0;
}

static void clear_audio_queue(void) {
    g_audio_len = 0;
}

static void core_unload_game(void) {
    if (g_game_loaded && g_core.retro_unload_game) {
        g_core.retro_unload_game();
    }

    g_game_loaded = false;
    g_input_mask = 0;
    clear_audio_queue();
    memset(g_framebuffer, 0, sizeof(g_framebuffer));
}

static void core_close(void) {
    core_unload_game();

    if (g_core_initialized && g_core.retro_deinit) {
        g_core.retro_deinit();
    }
    g_core_initialized = false;

    if (g_core.handle) {
        dlclose(g_core.handle);
    }
    memset(&g_core, 0, sizeof(g_core));

    free(g_rom_data);
    g_rom_data = NULL;
    g_rom_size = 0;

    free(g_audio_queue);
    g_audio_queue = NULL;
    g_audio_len = 0;
    g_audio_cap = 0;

    g_pixel_format = RETRO_PIXEL_FORMAT_RGB565;
}

static int load_rom_payload(const uint8_t* payload, size_t length) {
    if (!payload || length == 0) return -1;

    uint8_t* rom = (uint8_t*) realloc(g_rom_data, length);
    if (!rom) return -1;

    g_rom_data = rom;
    memcpy(g_rom_data, payload, length);
    g_rom_size = length;

    core_unload_game();
    clear_audio_queue();
    g_pixel_format = RETRO_PIXEL_FORMAT_RGB565;

    struct retro_game_info info;
    memset(&info, 0, sizeof(info));
    info.path = "game.gb";
    info.data = g_rom_data;
    info.size = g_rom_size;

    if (!g_core.retro_load_game(&info)) {
        return -1;
    }

    g_game_loaded = true;
    if (g_core.retro_set_controller_port_device) {
        g_core.retro_set_controller_port_device(0, RETRO_DEVICE_JOYPAD);
    }
    return 0;
}

static uint16_t key_mask_for_code(uint8_t code) {
    switch (code) {
        case 0: return KEY_RIGHT;
        case 1: return KEY_LEFT;
        case 2: return KEY_UP;
        case 3: return KEY_DOWN;
        case 4: return KEY_A;
        case 5: return KEY_B;
        case 6: return KEY_SELECT;
        case 7: return KEY_START;
        default: return 0;
    }
}

static void set_keys_from_payload(const uint8_t* payload, size_t length) {
    uint16_t mask = 0;
    for (size_t i = 0; i < length; i++) {
        mask |= key_mask_for_code(payload[i]);
    }
    g_input_mask = mask;
}

static int take_audio_bytes(uint8_t** out_bytes, size_t* out_len) {
    *out_bytes = NULL;
    *out_len = 0;
    if (g_audio_len == 0) return 0;

    size_t bytes_len = g_audio_len * sizeof(float);
    uint8_t* bytes = (uint8_t*) malloc(bytes_len);
    if (!bytes) return -1;

    memcpy(bytes, g_audio_queue, bytes_len);
    g_audio_len = 0;
    *out_bytes = bytes;
    *out_len = bytes_len;
    return 0;
}

static int take_save_state_bytes(uint8_t** out_bytes, size_t* out_len) {
    *out_bytes = NULL;
    *out_len = 0;

    size_t state_len = g_core.retro_serialize_size();
    if (state_len == 0 || state_len > MAX_PAYLOAD_BYTES) return -1;

    uint8_t* state_bytes = (uint8_t*) malloc(state_len);
    if (!state_bytes) return -1;

    if (!g_core.retro_serialize(state_bytes, state_len)) {
        free(state_bytes);
        return -1;
    }

    *out_bytes = state_bytes;
    *out_len = state_len;
    return 0;
}

static int load_state_bytes(const uint8_t* payload, size_t payload_len) {
    if (!payload || payload_len == 0) return -1;
    if (!g_core.retro_unserialize(payload, payload_len)) return -1;

    g_input_mask = 0;
    clear_audio_queue();
    return 0;
}

static void free_request(Request* request) {
    free(request->payload);
    request->command = 0;
    request->payload = NULL;
    request->payload_len = 0;
}

static int read_request(Request* request, const char** error_msg) {
    uint8_t header[REQUEST_HEADER_BYTES];
    uint32_t payload_len = 0;

    *error_msg = NULL;
    memset(request, 0, sizeof(*request));

    int read_status = read_exact(stdin, header, sizeof(header));
    if (read_status <= 0) {
        if (read_status < 0) {
            *error_msg = "failed to read request";
        }
        return read_status;
    }

    memcpy(&payload_len, header + 1, sizeof(payload_len));
    if (payload_len > MAX_PAYLOAD_BYTES) {
        *error_msg = "payload too large";
        return -1;
    }

    request->command = header[0];
    request->payload_len = payload_len;
    if (payload_len == 0) {
        return 1;
    }

    request->payload = (uint8_t*) malloc(payload_len);
    if (!request->payload) {
        *error_msg = "failed to allocate request payload";
        return -1;
    }

    int payload_status = read_exact(stdin, request->payload, payload_len);
    if (payload_status <= 0) {
        free_request(request);
        *error_msg = "failed to read request payload";
        return -1;
    }

    return 1;
}

static CommandResult command_ok(const void* payload, size_t payload_len) {
    CommandResult result;
    result.status = STATUS_OK;
    result.payload = payload;
    result.payload_len = payload_len;
    result.error_msg = NULL;
    result.free_payload = false;
    return result;
}

static CommandResult command_ok_owned(void* payload, size_t payload_len) {
    CommandResult result = command_ok(payload, payload_len);
    result.free_payload = true;
    return result;
}

static CommandResult command_error(const char* error_msg) {
    CommandResult result;
    result.status = STATUS_ERR;
    result.payload = NULL;
    result.payload_len = 0;
    result.error_msg = error_msg;
    result.free_payload = false;
    return result;
}

static void free_command_result(CommandResult* result) {
    if (result->free_payload && result->payload) {
        free((void*) result->payload);
    }
    result->payload = NULL;
    result->payload_len = 0;
    result->error_msg = NULL;
    result->free_payload = false;
}

static bool command_requires_loaded_rom(uint8_t command) {
    switch (command) {
        case CMD_SET_KEYS:
        case CMD_DO_FRAME:
        case CMD_GET_AUDIO:
        case CMD_SAVE_STATE:
        case CMD_LOAD_STATE:
            return true;
        default:
            return false;
    }
}

static CommandResult handle_command(const Request* request, bool* should_exit) {
    *should_exit = false;

    if (command_requires_loaded_rom(request->command) && !g_game_loaded) {
        return command_error("ROM not loaded");
    }

    switch (request->command) {
        case CMD_LOAD_ROM:
            if (load_rom_payload(request->payload, request->payload_len) != 0) {
                return command_error("failed to load ROM into mGBA");
            }
            return command_ok(NULL, 0);
        case CMD_SET_KEYS:
            set_keys_from_payload(request->payload, request->payload_len);
            return command_ok(NULL, 0);
        case CMD_DO_FRAME:
            g_core.retro_run();
            return command_ok(g_framebuffer, sizeof(g_framebuffer));
        case CMD_GET_AUDIO: {
            uint8_t* audio_bytes = NULL;
            size_t audio_len = 0;
            if (take_audio_bytes(&audio_bytes, &audio_len) != 0) {
                return command_error("failed to read audio queue");
            }
            return command_ok_owned(audio_bytes, audio_len);
        }
        case CMD_SAVE_STATE: {
            uint8_t* state_bytes = NULL;
            size_t state_len = 0;
            if (take_save_state_bytes(&state_bytes, &state_len) != 0) {
                return command_error("failed to save emulator state");
            }
            return command_ok_owned(state_bytes, state_len);
        }
        case CMD_LOAD_STATE:
            if (load_state_bytes(request->payload, request->payload_len) != 0) {
                return command_error("failed to load emulator state");
            }
            return command_ok(NULL, 0);
        case CMD_SHUTDOWN:
            *should_exit = true;
            core_close();
            return command_ok(NULL, 0);
        default:
            return command_error("unknown command");
    }
}

static int write_command_result(const CommandResult* result) {
    if (result->status == STATUS_OK) {
        return write_response(STATUS_OK, result->payload, result->payload_len);
    }
    return write_error_response(result->error_msg);
}

int main(int argc, char** argv) {
    const char* argv0 = (argc > 0 && argv[0]) ? argv[0] : "./pi-boy-mgba-bridge";

    if (core_open(argv0) != 0) {
        write_error_response("failed to initialize mGBA core");
        return 1;
    }

    for (;;) {
        Request request;
        const char* read_error = NULL;
        int read_status = read_request(&request, &read_error);
        if (read_status == 0) break;
        if (read_status < 0) {
            write_error_response(read_error);
            break;
        }

        bool should_exit = false;
        CommandResult result = handle_command(&request, &should_exit);
        free_request(&request);

        if (write_command_result(&result) != 0) {
            free_command_result(&result);
            break;
        }

        free_command_result(&result);

        if (should_exit) {
            return 0;
        }
    }

    core_close();
    return 0;
}
