type PredictedVisualEntry = {
  abilityId: string;
  ownerId: string;
  visualId: string;
  createdAtMs: number;
  launchSide?: -1 | 1;
};

const LOCAL_VISUAL_PREDICTION_TTL_MS = 2500;
const predictedLocalAbilityVisuals: PredictedVisualEntry[] = [];

function prunePredictedLocalAbilityVisuals(now = Date.now()): void {
  for (let index = predictedLocalAbilityVisuals.length - 1; index >= 0; index--) {
    if (now - predictedLocalAbilityVisuals[index].createdAtMs > LOCAL_VISUAL_PREDICTION_TTL_MS) {
      predictedLocalAbilityVisuals.splice(index, 1);
    }
  }
}

function sidesMatch(entrySide: -1 | 1 | undefined, requestedSide: -1 | 1 | undefined): boolean {
  return entrySide === undefined || requestedSide === undefined || entrySide === requestedSide;
}

export function markPredictedLocalAbilityVisual(
  abilityId: string,
  ownerId: string,
  visualId: string,
  options: { launchSide?: -1 | 1; now?: number } = {}
): void {
  const now = options.now ?? Date.now();
  prunePredictedLocalAbilityVisuals(now);
  predictedLocalAbilityVisuals.push({
    abilityId,
    ownerId,
    visualId,
    createdAtMs: now,
    launchSide: options.launchSide,
  });
}

export function consumePredictedLocalAbilityVisual(
  abilityId: string,
  ownerId: string,
  options: { launchSide?: -1 | 1; now?: number } = {}
): string | null {
  const now = options.now ?? Date.now();
  prunePredictedLocalAbilityVisuals(now);

  let bestIndex = -1;
  let bestCreatedAt = Number.POSITIVE_INFINITY;
  for (let index = 0; index < predictedLocalAbilityVisuals.length; index++) {
    const entry = predictedLocalAbilityVisuals[index];
    if (entry.abilityId !== abilityId) continue;
    if (entry.ownerId !== ownerId) continue;
    if (!sidesMatch(entry.launchSide, options.launchSide)) continue;
    if (entry.createdAtMs < bestCreatedAt) {
      bestCreatedAt = entry.createdAtMs;
      bestIndex = index;
    }
  }

  if (bestIndex < 0) return null;
  const [entry] = predictedLocalAbilityVisuals.splice(bestIndex, 1);
  return entry.visualId;
}

export function resetPredictedLocalAbilityVisuals(): void {
  predictedLocalAbilityVisuals.length = 0;
}
