# Onboarding Extension

Creates the first-run welcome conversation for new Personal Agent profiles.

The extension mounts a tiny top-bar bootstrap component and also declares an `onEnableAction`. When enabled, it creates the onboarding conversation, opens it, and then disables itself.

The onboarding conversation explains the first useful steps: configure a provider in Settings, understand that PA is extension-based, manage extensions from Settings → Extensions, then start a real task conversation.
