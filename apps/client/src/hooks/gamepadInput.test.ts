import assert from 'node:assert/strict';
import {
  mapGamepadToInputState,
  normalizeGamepadAxis,
  readGamepadInput,
  readGamepadLookVector,
  type GamepadInputSnapshot,
} from './gamepadInput';

function button(pressed = false, value = pressed ? 1 : 0) {
  return { pressed, value };
}

function gamepad(input: {
  axes?: number[];
  buttons?: Record<number, ReturnType<typeof button>>;
  connected?: boolean;
} = {}): GamepadInputSnapshot {
  const buttons = Array.from({ length: 16 }, (_, index) => input.buttons?.[index] ?? button());
  return {
    axes: input.axes ?? [0, 0, 0, 0],
    buttons,
    connected: input.connected ?? true,
    mapping: 'standard',
  };
}

assert.equal(normalizeGamepadAxis(0.23), 0, 'axis values inside the deadzone should be ignored');
assert.equal(normalizeGamepadAxis(1), 1, 'positive full tilt should normalize to 1');
assert.equal(normalizeGamepadAxis(-1), -1, 'negative full tilt should normalize to -1');

const movementInput = mapGamepadToInputState(gamepad({ axes: [-1, -1, 0, 0] }));
assert.equal(movementInput.moveForward, true, 'left stick up should move forward');
assert.equal(movementInput.moveLeft, true, 'left stick left should strafe left');
assert.equal(movementInput.moveBackward, false, 'left stick up should not move backward');
assert.equal(movementInput.moveRight, false, 'left stick left should not strafe right');

const buttonInput = mapGamepadToInputState(gamepad({
  buttons: {
    0: button(true),
    1: button(true),
    2: button(false, 0.8),
    3: button(true),
    4: button(true),
    5: button(true),
    6: button(false, 0.6),
    7: button(false, 0.7),
    10: button(true),
    12: button(true),
  },
}));
assert.equal(buttonInput.jump, true, 'A/Cross should jump');
assert.equal(buttonInput.crouch, true, 'B/Circle should crouch');
assert.equal(buttonInput.reload, true, 'X/Square should reload');
assert.equal(buttonInput.ultimate, true, 'Y/Triangle should use ultimate');
assert.equal(buttonInput.ability1, true, 'left bumper should use ability 1');
assert.equal(buttonInput.ability2, true, 'right bumper should use ability 2');
assert.equal(buttonInput.secondaryFire, true, 'left trigger should secondary fire');
assert.equal(buttonInput.primaryFire, true, 'right trigger should primary fire');
assert.equal(buttonInput.sprint, true, 'left stick click should sprint');
assert.equal(buttonInput.interact, true, 'd-pad up should interact');

const look = readGamepadLookVector(gamepad({ axes: [0, 0, 1, -1] }));
assert.equal(look.x, 1, 'right stick full right should look right');
assert.equal(look.y, -1, 'right stick full up should look up');

assert.equal(
  readGamepadInput(gamepad({ axes: [0.05, -0.05, 0.05, -0.05] })).isActive,
  false,
  'deadzone-only gamepad noise should not activate controller input'
);

assert.equal(
  readGamepadInput(gamepad({ axes: [0, 0, 0.8, 0] })).isActive,
  true,
  'right-stick look should activate controller input'
);

assert.equal(
  readGamepadInput(gamepad({ connected: false })).isActive,
  false,
  'disconnected gamepads should not be active'
);

console.log('gamepad input tests passed');
