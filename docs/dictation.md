# Dictation

Dictation captures browser PCM audio in the composer and transcribes it with the configured local Whisper provider after recording stops.

The composer keeps microphone capture local while recording, then sends one full PCM buffer to the transcription API on stop and inserts the final transcript at the current composer selection. Avoid periodic partial transcription for now; repeatedly running local Whisper on growing snapshots can saturate the app and beachball the desktop UI.
