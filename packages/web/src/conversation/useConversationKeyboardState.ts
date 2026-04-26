import { useEffect, useState } from 'react';

export function useVisualViewportKeyboardInset(): number {
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    const syncKeyboardInset = () => {
      const visualViewport = window.visualViewport;
      if (!visualViewport) {
        setKeyboardInset(0);
        return;
      }

      const nextInset = Math.max(
        0,
        Math.round(window.innerHeight - (visualViewport.height + visualViewport.offsetTop)),
      );
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

export function useComposerModifierKeys(): { composerAltHeld: boolean; composerParallelHeld: boolean } {
  const [composerAltHeld, setComposerAltHeld] = useState(false);
  const [composerParallelHeld, setComposerParallelHeld] = useState(false);

  useEffect(() => {
    function handleModifierChange(event: KeyboardEvent) {
      setComposerAltHeld(event.altKey);
      setComposerParallelHeld(event.ctrlKey || event.metaKey);
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
