import type { ExtensionSurfaceProps } from '@personal-agent/extensions';
import { AppPageIntro, AppPageLayout, ToolbarButton } from '@personal-agent/extensions/ui';

const DOOM_URL = 'https://js-dos.com/games/doom.exe.html';

export function DoomPage(_props: ExtensionSurfaceProps) {
  return (
    <div className="h-full min-h-0 overflow-hidden bg-base">
      <AppPageLayout shellClassName="h-full max-w-none px-6 py-5" contentClassName="flex h-full min-h-0 flex-col gap-4">
        <AppPageIntro
          title="Doom"
          summary="The important productivity integration nobody asked for. Click the game first, then use the keyboard."
          actions={<ToolbarButton onClick={() => window.open(DOOM_URL, '_blank', 'noopener,noreferrer')}>Open in browser</ToolbarButton>}
        />
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border-subtle bg-black">
          <iframe
            title="Doom"
            src={DOOM_URL}
            className="h-full w-full border-0 bg-black"
            allow="autoplay; fullscreen; gamepad"
            allowFullScreen
            referrerPolicy="no-referrer"
          />
        </div>
      </AppPageLayout>
    </div>
  );
}
