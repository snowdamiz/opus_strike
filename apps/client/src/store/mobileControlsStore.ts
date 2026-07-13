import { create } from 'zustand';
import { createEmptyInputState } from '@voxel-strike/shared';
import type { InputState } from '@voxel-strike/shared';
import { resetLookDelta } from './lookInputStore';

type MobileMovementVector = {
  x: number;
  y: number;
};

interface MobileControlsState {
  inputState: InputState;
  movementVector: MobileMovementVector;
  isTouchInputActive: boolean;
  setActionPressed: (action: keyof InputState, pressed: boolean) => void;
  setMovementVector: (x: number, y: number) => void;
  reset: () => void;
}

const MOVEMENT_DEADZONE = 0.28;
const SPRINT_THRESHOLD = 0.78;

function hasAnyInput(inputState: InputState): boolean {
  return Object.values(inputState).some(Boolean);
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

export const useMobileControlsStore = create<MobileControlsState>((set) => ({
  inputState: createEmptyInputState(),
  movementVector: { x: 0, y: 0 },
  isTouchInputActive: false,

  setActionPressed: (action, pressed) => set((state) => {
    if (state.inputState[action] === pressed) return state;

    const nextInputState = {
      ...state.inputState,
      [action]: pressed,
    };

    return {
      inputState: nextInputState,
      isTouchInputActive: hasAnyInput(nextInputState),
    };
  }),

  setMovementVector: (x, y) => set((state) => {
    const nextX = clampUnit(x);
    const nextY = clampUnit(y);
    const magnitude = Math.hypot(nextX, nextY);
    const nextInputState = {
      ...state.inputState,
      moveForward: nextY < -MOVEMENT_DEADZONE,
      moveBackward: nextY > MOVEMENT_DEADZONE,
      moveLeft: nextX < -MOVEMENT_DEADZONE,
      moveRight: nextX > MOVEMENT_DEADZONE,
      sprint: magnitude >= SPRINT_THRESHOLD,
    };

    if (
      state.movementVector.x === nextX &&
      state.movementVector.y === nextY &&
      state.inputState.moveForward === nextInputState.moveForward &&
      state.inputState.moveBackward === nextInputState.moveBackward &&
      state.inputState.moveLeft === nextInputState.moveLeft &&
      state.inputState.moveRight === nextInputState.moveRight &&
      state.inputState.sprint === nextInputState.sprint
    ) {
      return state;
    }

    return {
      inputState: nextInputState,
      movementVector: { x: nextX, y: nextY },
      isTouchInputActive: hasAnyInput(nextInputState),
    };
  }),

  reset: () => set({
    inputState: createEmptyInputState(),
    movementVector: { x: 0, y: 0 },
    isTouchInputActive: false,
  }),
}));

export function resetMobileControls(): void {
  resetLookDelta();
  useMobileControlsStore.getState().reset();
}
