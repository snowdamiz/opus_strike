import { useCallback, useEffect } from 'react';
import { playSharedSound, useAudio } from './useAudio';

const GLOBAL_BUTTON_SOUND_SELECTOR = [
  'button',
  '[role="button"]',
  'input[type="button"]',
  'input[type="reset"]',
  'input[type="submit"]',
].join(',');

function getButtonSoundTarget(target: EventTarget | null): Element | null {
  if (typeof Element === 'undefined') return null;
  if (!(target instanceof Element)) return null;

  const button = target.closest(GLOBAL_BUTTON_SOUND_SELECTOR);
  if (!button) return null;

  if (button.hasAttribute('disabled')) return null;
  if (button.getAttribute('aria-disabled') === 'true') return null;

  return button;
}

// UI sound effects hook
export function useUISounds() {
  const playButtonHover = useCallback(() => {}, []);
  const playButtonClick = useCallback(() => {}, []);

  return {
    playButtonHover,
    playButtonClick,
  };
}

export function useGlobalButtonSounds() {
  const { preloadSounds } = useAudio();

  useEffect(() => {
    void preloadSounds(['buttonClick']);
  }, [preloadSounds]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleButtonClick = (event: MouseEvent) => {
      if (!getButtonSoundTarget(event.target)) return;
      void playSharedSound('buttonClick');
    };

    document.addEventListener('click', handleButtonClick, true);
    return () => {
      document.removeEventListener('click', handleButtonClick, true);
    };
  }, []);
}
