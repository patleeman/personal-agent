import { useEffect, useState } from 'react';

type ComposerModifierEvent = Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'type'> & Partial<Pick<KeyboardEvent, 'key'>>;

function readModifierState(event: ComposerModifierEvent): { altHeld: boolean; parallelHeld: boolean } {
  return {
    altHeld: event.altKey,
    parallelHeld: event.ctrlKey || event.metaKey,
  };
}

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

export function resolveComposerModifierKeyState(event: ComposerModifierEvent): {
  altHeld: boolean;
  parallelHeld: boolean;
} {
  const key = event.key;
  const isKeyDown = event.type === 'keydown';
  const isKeyUp = event.type === 'keyup';
  const modifierState = readModifierState(event);

  return {
    altHeld: key === 'Alt' ? isKeyDown || (!isKeyUp && modifierState.altHeld) : modifierState.altHeld,
    parallelHeld: key === 'Control' || key === 'Meta' ? isKeyDown || (!isKeyUp && modifierState.parallelHeld) : modifierState.parallelHeld,
  };
}

export function useComposerModifierKeys(): { composerAltHeld: boolean; composerParallelHeld: boolean } {
  const [composerAltHeld, setComposerAltHeld] = useState(false);
  const [composerParallelHeld, setComposerParallelHeld] = useState(false);

  useEffect(() => {
    function applyModifierState(nextState: { altHeld: boolean; parallelHeld: boolean }) {
      setComposerAltHeld((current) => (current === nextState.altHeld ? current : nextState.altHeld));
      setComposerParallelHeld((current) => (current === nextState.parallelHeld ? current : nextState.parallelHeld));
    }

    function handleKeyboardModifierChange(event: KeyboardEvent) {
      applyModifierState(resolveComposerModifierKeyState(event));
    }

    function handlePointerModifierChange(event: MouseEvent | PointerEvent) {
      applyModifierState(readModifierState(event));
    }

    function resetModifierState() {
      applyModifierState({ altHeld: false, parallelHeld: false });
    }

    window.addEventListener('keydown', handleKeyboardModifierChange, true);
    window.addEventListener('keyup', handleKeyboardModifierChange, true);
    window.addEventListener('pointerdown', handlePointerModifierChange, true);
    window.addEventListener('pointermove', handlePointerModifierChange, true);
    window.addEventListener('mousedown', handlePointerModifierChange, true);
    window.addEventListener('mousemove', handlePointerModifierChange, true);
    window.addEventListener('blur', resetModifierState);
    document.addEventListener('visibilitychange', resetModifierState);

    return () => {
      window.removeEventListener('keydown', handleKeyboardModifierChange, true);
      window.removeEventListener('keyup', handleKeyboardModifierChange, true);
      window.removeEventListener('pointerdown', handlePointerModifierChange, true);
      window.removeEventListener('pointermove', handlePointerModifierChange, true);
      window.removeEventListener('mousedown', handlePointerModifierChange, true);
      window.removeEventListener('mousemove', handlePointerModifierChange, true);
      window.removeEventListener('blur', resetModifierState);
      document.removeEventListener('visibilitychange', resetModifierState);
    };
  }, []);

  return { composerAltHeld, composerParallelHeld };
}
