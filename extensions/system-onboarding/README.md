# Onboarding Extension

Creates the first-run welcome conversation for new Personal Agent profiles.

The extension mounts a tiny top-bar bootstrap component, calls its backend once, and creates a local conversation only when the profile has no existing conversations. Existing users are marked as already onboarded so they do not get surprise clutter. After the first check completes, the extension disables itself.

The onboarding conversation explains the first useful steps: configure a provider in Settings, understand that PA is extension-based, manage extensions from Settings → Extensions, then start a real task conversation.
