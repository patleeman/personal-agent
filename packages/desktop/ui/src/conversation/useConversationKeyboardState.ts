import { useEffect, useState } from 'react';

function resolveVisualViewportKeyboardInset(input: { innerHeight: number; viewportHeight: number; viewportOffsetTop: number }): number {
  const { innerHeight, viewportHeight, viewportOffsetTop } = input;
  if (![innerHeight, viewportHeight, viewportOffsetTop].every(Number.isSafeInteger)) {
    return 0;
  }

  return Math.max(0, innerHeight - (viewportHeight + viewportOffsetTop));
}

export function useVisualViewportKeyboardInset(): number {
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    const syncKeyboardInset = () => {
      const visualViewport = window.visualViewport;
      if (!visualViewport) {
        setKeyboardInset(0);
        return;
      }

      const nextInset = resolveVisualViewportKeyboardInset({
        innerHeight: window.innerHeight,
        viewportHeight: visualViewport.height,
        viewportOffsetTop: visualViewport.offsetTop,
      });
      setKeyboardInset((current) => (current === nextInset ? current : nextInset));
    };

    syncKeyboardInset();
    window.addEventListener('resize', syncKeyboardInset);
    window.visualViewport?.addEventListener('resize', syncKeyboardInset);
    window.visualViewport?.addEventListener('scroll', syncKeyboardInset);

    return () => {
      window.removeEventListener('resize', syncKeyboardInset);
      window.visualViewport?.removeEventListener('resize', syncKeyboardInset);
      window.visualViewport?.removeEventListener('scroll', syncKeyboardInset);
    };
  }, []);

  return keyboardInset;
}

export function resolveComposerModifierKeyState(event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'key' | 'type'>): {
  altHeld: boolean;
  parallelHeld: boolean;
} {
  const key = event.key;
  const isKeyDown = event.type === 'keydown';
  const isKeyUp = event.type === 'keyup';

  return {
    altHeld: key === 'Alt' ? isKeyDown || (!isKeyUp && event.altKey) : event.altKey,
    parallelHeld:
      key === 'Control' || key === 'Meta' ? isKeyDown || (!isKeyUp && (event.ctrlKey || event.metaKey)) : event.ctrlKey || event.metaKey,
  };
}

export function useComposerModifierKeys(): { composerAltHeld: boolean; composerParallelHeld: boolean } {
  const [composerAltHeld, setComposerAltHeld] = useState(false);
  const [composerParallelHeld, setComposerParallelHeld] = useState(false);

  useEffect(() => {
    function handleModifierChange(event: KeyboardEvent) {
      const nextState = resolveComposerModifierKeyState(event);
      setComposerAltHeld(nextState.altHeld);
      setComposerParallelHeld(nextState.parallelHeld);
    }

    function resetModifierState() {
      setComposerAltHeld(false);
      setComposerParallelHeld(false);
    }

    window.addEventListener('keydown', handleModifierChange);
    window.addEventListener('keyup', handleModifierChange);
    window.addEventListener('blur', resetModifierState);

    return () => {
      window.removeEventListener('keydown', handleModifierChange);
      window.removeEventListener('keyup', handleModifierChange);
      window.removeEventListener('blur', resetModifierState);
    };
  }, []);

  return { composerAltHeld, composerParallelHeld };
}
