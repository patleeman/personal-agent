# Onboarding Extension

Creates the first-run welcome conversation for new Personal Agent profiles.

The extension mounts a tiny top-bar bootstrap component and also declares an `onEnableAction`. The backend `ensure` action is idempotent, de-duplicates concurrent calls, and tracks whether the UI already consumed the onboarding redirect, so the frontend bootstrap and enable hook can safely race during React Strict Mode or hot reload without hijacking later `/conversations/new` navigation. When enabled, it creates the onboarding conversation, routes to it client-side once, and then disables itself.

The onboarding conversation explains the first useful steps: configure a provider in Settings, understand that PA is extension-based, manage extensions from Settings → Extensions, then start a real task conversation.
