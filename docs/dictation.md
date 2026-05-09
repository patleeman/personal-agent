# Dictation

Dictation is implemented by the bundled `system-dictation` extension.

The extension contributes the composer mic button through `contributes.composerButtons`, owns the `/settings/dictation` settings page, and exposes backend actions for reading/updating settings, installing local Whisper models, checking model status, and transcribing captured PCM audio.

The composer button keeps microphone capture in the extension frontend while recording, then sends one full PCM buffer to the extension backend on stop. Avoid periodic partial transcription for now; repeatedly running local Whisper on growing snapshots can saturate the app and beachball the desktop UI.
