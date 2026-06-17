export class TutorialRequiredError extends Error {
  readonly statusCode = 403;

  constructor() {
    super('Complete the tutorial before playing online matches');
    this.name = 'TutorialRequiredError';
  }
}

export function assertTutorialCompleted(tutorialCompletedAt: Date | string | null | undefined): void {
  if (!tutorialCompletedAt) {
    throw new TutorialRequiredError();
  }
}
