# MLX Local Models

Run local Hugging Face MLX models from Personal Agent.

The extension manages a private `mlx-lm` virtualenv, downloads models with the Hugging Face CLI, starts `mlx_lm.server` on `http://127.0.0.1:8011/v1`, and registers the selected model as an OpenAI-compatible provider in the model picker.

Default model: `unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit`.

The page includes the loaded-model indicator, enable/disable toggle, setup/download controls, logs, and Hugging Face MLX model search.
