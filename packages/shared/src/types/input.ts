export interface InputState {
  moveForward: boolean;
  moveBackward: boolean;
  moveLeft: boolean;
  moveRight: boolean;
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
  primaryFire: boolean;
  secondaryFire: boolean;
  ability1: boolean;
  ability2: boolean;
  ultimate: boolean;
  interact: boolean;
}

export interface MouseState {
  deltaX: number;
  deltaY: number;
  buttons: number;
}

export const DEFAULT_KEYBINDINGS: Record<string, string> = {
  moveForward: 'KeyW',
  moveBackward: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  jump: 'Space',
  crouch: 'ControlLeft',
  sprint: 'ShiftLeft',
  primaryFire: 'Mouse0',
  secondaryFire: 'Mouse1',
  ability1: 'KeyE',
  ability2: 'KeyQ',
  ultimate: 'KeyF',
  interact: 'KeyR',
};

export function createEmptyInputState(): InputState {
  return {
    moveForward: false,
    moveBackward: false,
    moveLeft: false,
    moveRight: false,
    jump: false,
    crouch: false,
    sprint: false,
    primaryFire: false,
    secondaryFire: false,
    ability1: false,
    ability2: false,
    ultimate: false,
    interact: false,
  };
}

