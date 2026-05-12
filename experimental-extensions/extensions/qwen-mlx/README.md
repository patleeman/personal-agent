# Qwen MLX

Set up, run, stop, and register a local MLX Qwen model as a Personal Agent model provider.

Model: `unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit`

The extension runs `python3 -m mlx_lm.server` on `http://127.0.0.1:8011/v1` and adds an OpenAI-compatible provider/model entry to PA's model picker.
