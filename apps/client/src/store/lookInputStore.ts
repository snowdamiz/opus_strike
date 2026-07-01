type LookDelta = {
  x: number;
  y: number;
};

let pendingLookDelta: LookDelta = { x: 0, y: 0 };

export function addLookDelta(deltaX: number, deltaY: number): void {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;

  pendingLookDelta = {
    x: pendingLookDelta.x + deltaX,
    y: pendingLookDelta.y + deltaY,
  };
}

export function consumeLookDelta(): LookDelta {
  const delta = pendingLookDelta;
  pendingLookDelta = { x: 0, y: 0 };
  return delta;
}

export function resetLookDelta(): void {
  pendingLookDelta = { x: 0, y: 0 };
}
