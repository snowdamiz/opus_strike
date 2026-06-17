import { config } from '../config/environment';
import type { DevTutorialOverride } from '../store/settingsStore';

export const DEV_TUTORIAL_BYPASS_HEADER = 'x-voxel-strike-dev-tutorial-bypass';

export function requiresTutorial(
  tutorialCompletedAt: string | null | undefined,
  devTutorialOverride: DevTutorialOverride
): boolean {
  if (config.isDev) {
    if (devTutorialOverride === 'bypass') return false;
    if (devTutorialOverride === 'force') return true;
  }

  return !tutorialCompletedAt;
}

export function shouldBypassTutorialForDev(devTutorialOverride: DevTutorialOverride): boolean {
  return config.isDev && devTutorialOverride === 'bypass';
}
