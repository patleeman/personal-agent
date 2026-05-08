# Dictation

Dictation captures browser PCM audio in the composer and transcribes it with the configured local Whisper provider.

The composer shows simulated streaming by periodically transcribing the current recording snapshot while the microphone is active. Those partial transcripts replace the live dictation span in-place, then the final full recording transcription replaces the partial text when recording stops. This keeps the UX responsive without depending on a true incremental Whisper decoder.
