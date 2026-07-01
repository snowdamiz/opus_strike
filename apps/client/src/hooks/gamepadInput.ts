import { useEffect, useRef, useState } from 'react';
import { createEmptyInputState } from '@voxel-strike/shared';
import type { InputState } from '@voxel-strike/shared';
import { isGameConsoleOpen } from '../store/gameConsoleState';
import { addLookDelta, resetLookDelta } from '../store/lookInputStore';

export interface GamepadButtonSnapshot {
  pressed: boolean;
  value: number;
}

export interface GamepadInputSnapshot {
  axes: readonly number[];
  buttons: readonly GamepadButtonSnapshot[];
  connected?: boolean;
  mapping?: string;
}

export interface GamepadLookVector {
  x: number;
  y: number;
}

interface GamepadInputRead {
  inputState: InputState;
  look: GamepadLookVector;
  isActive: boolean;
}

interface UseGamepadInputReturn {
  inputState: InputState;
  isGamepadInputActive: boolean;
}

const EMPTY_GAMEPAD_INPUT_STATE = createEmptyInputState();
const GAMEPAD_AXIS_DEADZONE = 0.24;
const GAMEPAD_LOOK_DEADZONE = 0.16;
const GAMEPAD_MOVEMENT_THRESHOLD = 0.32;
const GAMEPAD_BUTTON_PRESS_THRESHOLD = 0.45;
const GAMEPAD_MAX_FRAME_SECONDS = 0.05;
const GAMEPAD_LOOK_PIXELS_PER_SECOND = 1150;

const GAMEPAD_BUTTON = {
  primary: 7,
  secondary: 6,
  ability1: 4,
  ability2: 5,
  jump: 0,
  crouch: 1,
  reload: 2,
  ultimate: 3,
  sprint: 10,
  dpadUp: 12,
} as const;

const EMPTY_GAMEPAD_RETURN: UseGamepadInputReturn = {
  inputState: EMPTY_GAMEPAD_INPUT_STATE,
  isGamepadInputActive: false,
};

function hasAnyInput(inputState: InputState): boolean {
  return Object.values(inputState).some(Boolean);
}

function inputStatesEqual(a: InputState, b: InputState): boolean {
  return (
    a.moveForward === b.moveForward &&
    a.moveBackward === b.moveBackward &&
    a.moveLeft === b.moveLeft &&
    a.moveRight === b.moveRight &&
    a.jump === b.jump &&
    a.crouch === b.crouch &&
    a.sprint === b.sprint &&
    a.primaryFire === b.primaryFire &&
    a.secondaryFire === b.secondaryFire &&
    a.reload === b.reload &&
    a.ability1 === b.ability1 &&
    a.ability2 === b.ability2 &&
    a.ultimate === b.ultimate &&
    a.interact === b.interact
  );
}

function gamepadReturnsEqual(a: UseGamepadInputReturn, b: UseGamepadInputReturn): boolean {
  return a.isGamepadInputActive === b.isGamepadInputActive && inputStatesEqual(a.inputState, b.inputState);
}

function readButton(gamepad: GamepadInputSnapshot, index: number): boolean {
  const button = gamepad.buttons[index];
  return Boolean(button?.pressed || (button?.value ?? 0) >= GAMEPAD_BUTTON_PRESS_THRESHOLD);
}

function applyLookResponseCurve(value: number): number {
  return Math.sign(value) * value * value;
}

export function normalizeGamepadAxis(value: unknown, deadzone = GAMEPAD_AXIS_DEADZONE): number {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return 0;

  const clamped = Math.max(-1, Math.min(1, numericValue));
  const magnitude = Math.abs(clamped);
  if (magnitude <= deadzone) return 0;

  return Math.sign(clamped) * ((magnitude - deadzone) / (1 - deadzone));
}

export function readGamepadLookVector(gamepad: GamepadInputSnapshot): GamepadLookVector {
  return {
    x: applyLookResponseCurve(normalizeGamepadAxis(gamepad.axes[2], GAMEPAD_LOOK_DEADZONE)),
    y: applyLookResponseCurve(normalizeGamepadAxis(gamepad.axes[3], GAMEPAD_LOOK_DEADZONE)),
  };
}

export function mapGamepadToInputState(gamepad: GamepadInputSnapshot): InputState {
  const leftX = normalizeGamepadAxis(gamepad.axes[0]);
  const leftY = normalizeGamepadAxis(gamepad.axes[1]);

  return {
    moveForward: leftY < -GAMEPAD_MOVEMENT_THRESHOLD,
    moveBackward: leftY > GAMEPAD_MOVEMENT_THRESHOLD,
    moveLeft: leftX < -GAMEPAD_MOVEMENT_THRESHOLD,
    moveRight: leftX > GAMEPAD_MOVEMENT_THRESHOLD,
    jump: readButton(gamepad, GAMEPAD_BUTTON.jump),
    crouch: readButton(gamepad, GAMEPAD_BUTTON.crouch),
    sprint: readButton(gamepad, GAMEPAD_BUTTON.sprint),
    primaryFire: readButton(gamepad, GAMEPAD_BUTTON.primary),
    secondaryFire: readButton(gamepad, GAMEPAD_BUTTON.secondary),
    reload: readButton(gamepad, GAMEPAD_BUTTON.reload),
    ability1: readButton(gamepad, GAMEPAD_BUTTON.ability1),
    ability2: readButton(gamepad, GAMEPAD_BUTTON.ability2),
    ultimate: readButton(gamepad, GAMEPAD_BUTTON.ultimate),
    interact: readButton(gamepad, GAMEPAD_BUTTON.dpadUp),
  };
}

export function readGamepadInput(gamepad: GamepadInputSnapshot | null | undefined): GamepadInputRead {
  if (!gamepad || gamepad.connected === false) {
    return { inputState: EMPTY_GAMEPAD_INPUT_STATE, look: { x: 0, y: 0 }, isActive: false };
  }

  const inputState = mapGamepadToInputState(gamepad);
  const look = readGamepadLookVector(gamepad);
  return {
    inputState,
    look,
    isActive: hasAnyInput(inputState) || look.x !== 0 || look.y !== 0,
  };
}

function selectGamepad(gamepads: readonly (Gamepad | null)[]): Gamepad | null {
  let fallback: Gamepad | null = null;

  for (const gamepad of gamepads) {
    if (gamepad?.connected === false || !gamepad?.buttons.length) {
      continue;
    }

    fallback ??= gamepad;
    if (readGamepadInput(gamepad).isActive) {
      return gamepad;
    }
  }

  return fallback;
}

export function useGamepadInput(enabled = true): UseGamepadInputReturn {
  const [state, setState] = useState<UseGamepadInputReturn>(EMPTY_GAMEPAD_RETURN);
  const stateRef = useRef(state);
  const lastFrameSecondsRef = useRef<number | null>(null);

  useEffect(() => {
    const publish = (next: UseGamepadInputReturn) => {
      if (gamepadReturnsEqual(stateRef.current, next)) return;

      stateRef.current = next;
      setState(next);
    };

    const reset = () => {
      lastFrameSecondsRef.current = null;
      resetLookDelta();
      publish(EMPTY_GAMEPAD_RETURN);
    };

    if (!enabled) {
      reset();
      return;
    }

    if (
      typeof window === 'undefined' ||
      typeof navigator === 'undefined' ||
      typeof navigator.getGamepads !== 'function'
    ) {
      return;
    }

    let rafId = 0;

    const poll = (timestampMs: number) => {
      const lastFrameSeconds = lastFrameSecondsRef.current;
      const timestampSeconds = timestampMs / 1000;
      const dt = lastFrameSeconds === null
        ? 0
        : Math.min(timestampSeconds - lastFrameSeconds, GAMEPAD_MAX_FRAME_SECONDS);
      lastFrameSecondsRef.current = timestampSeconds;

      if (document.hidden || isGameConsoleOpen()) {
        reset();
        rafId = window.requestAnimationFrame(poll);
        return;
      }

      const gamepad = selectGamepad(navigator.getGamepads());
      const gamepadInput = readGamepadInput(gamepad);
      if (dt > 0 && (gamepadInput.look.x !== 0 || gamepadInput.look.y !== 0)) {
        addLookDelta(
          gamepadInput.look.x * GAMEPAD_LOOK_PIXELS_PER_SECOND * dt,
          gamepadInput.look.y * GAMEPAD_LOOK_PIXELS_PER_SECOND * dt
        );
      }

      publish({
        inputState: gamepadInput.inputState,
        isGamepadInputActive: gamepadInput.isActive,
      });
      rafId = window.requestAnimationFrame(poll);
    };

    const resetOnVisibilityChange = () => {
      if (document.hidden) reset();
    };

    window.addEventListener('blur', reset);
    window.addEventListener('gamepaddisconnected', reset);
    document.addEventListener('visibilitychange', resetOnVisibilityChange);
    rafId = window.requestAnimationFrame(poll);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('blur', reset);
      window.removeEventListener('gamepaddisconnected', reset);
      document.removeEventListener('visibilitychange', resetOnVisibilityChange);
      lastFrameSecondsRef.current = null;
    };
  }, [enabled]);

  return state;
}
