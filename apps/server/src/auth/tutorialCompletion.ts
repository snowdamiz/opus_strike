import { isProductionEnvironment } from '../config/security';

export const DEV_TUTORIAL_BYPASS_HEADER = 'x-voxel-strike-dev-tutorial-bypass';

export class TutorialRequiredError extends Error {
  readonly statusCode = 403;

  constructor() {
    super('Complete the tutorial before playing online matches');
    this.name = 'TutorialRequiredError';
  }
}

function isTruthyBypassValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isTruthyBypassValue);
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function isDevTutorialBypassRequested(value: unknown): boolean {
  return !isProductionEnvironment() && isTruthyBypassValue(value);
}

export function assertTutorialCompleted(
  tutorialCompletedAt: Date | string | null | undefined,
  options: { devBypass?: unknown } = {}
): void {
  if (isDevTutorialBypassRequested(options.devBypass)) return;

  if (!tutorialCompletedAt) {
    throw new TutorialRequiredError();
  }
}
