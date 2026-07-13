import assert from 'node:assert/strict';
import { createEmptyInputState } from '@voxel-strike/shared';
import { resetMobileControls, useMobileControlsStore } from './mobileControlsStore';

resetMobileControls();

const controls = useMobileControlsStore.getState();
controls.setActionPressed('jump', true);
controls.setMovementVector(0.9, -1);

let state = useMobileControlsStore.getState();
assert.equal(state.inputState.moveForward, true);
assert.equal(state.inputState.moveRight, true);
assert.equal(state.inputState.sprint, true);
assert.equal(state.inputState.jump, true);
assert.equal(state.isTouchInputActive, true);

controls.setMovementVector(0, 0);
state = useMobileControlsStore.getState();

assert.deepEqual(state.movementVector, { x: 0, y: 0 });
assert.equal(state.inputState.moveForward, false);
assert.equal(state.inputState.moveBackward, false);
assert.equal(state.inputState.moveLeft, false);
assert.equal(state.inputState.moveRight, false);
assert.equal(state.inputState.sprint, false);
assert.equal(state.inputState.jump, true, 'releasing the stick must preserve a separately held action');
assert.equal(state.isTouchInputActive, true);

resetMobileControls();
state = useMobileControlsStore.getState();

assert.deepEqual(state.inputState, createEmptyInputState());
assert.deepEqual(state.movementVector, { x: 0, y: 0 });
assert.equal(state.isTouchInputActive, false);

console.log('mobile controls store tests passed');
