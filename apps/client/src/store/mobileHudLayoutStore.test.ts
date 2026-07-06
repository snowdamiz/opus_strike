import assert from 'node:assert/strict';
import {
  clampMobileHudLayoutRect,
  MOBILE_HUD_LAYOUT_DEFINITIONS,
} from './mobileHudLayoutStore';

function assertNear(actual: number, expected: number, label: string): void {
  assert.ok(Math.abs(actual - expected) < 0.0001, `${label}: expected ${expected}, got ${actual}`);
}

function assertSameDefaultAspect(id: 'mobile-joystick' | 'hud-minimap', width: number, height: number): void {
  const defaultRect = MOBILE_HUD_LAYOUT_DEFINITIONS[id].defaultRect;
  assertNear(width / height, defaultRect.width / defaultRect.height, `${id} aspect ratio`);
}

const tinyJoystick = clampMobileHudLayoutRect('mobile-joystick', {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
});
assert.equal(tinyJoystick.width, MOBILE_HUD_LAYOUT_DEFINITIONS['mobile-joystick'].minWidth);
assertSameDefaultAspect('mobile-joystick', tinyJoystick.width, tinyJoystick.height);

const mismatchedJoystick = clampMobileHudLayoutRect('mobile-joystick', {
  x: 0,
  y: 0,
  width: 8,
  height: 99,
});
assert.equal(mismatchedJoystick.width, 8);
assertSameDefaultAspect('mobile-joystick', mismatchedJoystick.width, mismatchedJoystick.height);

const oversizedMinimap = clampMobileHudLayoutRect('hud-minimap', {
  x: 96,
  y: 96,
  width: 100,
  height: 100,
});
assertNear(
  oversizedMinimap.height,
  MOBILE_HUD_LAYOUT_DEFINITIONS['hud-minimap'].maxHeight,
  'oversized minimap max height'
);
assertSameDefaultAspect('hud-minimap', oversizedMinimap.width, oversizedMinimap.height);
assert.ok(oversizedMinimap.x <= 100 - oversizedMinimap.width);
assert.ok(oversizedMinimap.y <= 100 - oversizedMinimap.height);

const safeZone = clampMobileHudLayoutRect('hud-safe-zone', {
  x: 99,
  y: 99,
  width: 1,
  height: 100,
});
assert.equal(safeZone.width, MOBILE_HUD_LAYOUT_DEFINITIONS['hud-safe-zone'].minWidth);
assert.equal(safeZone.height, MOBILE_HUD_LAYOUT_DEFINITIONS['hud-safe-zone'].maxHeight);

console.log('mobile HUD layout store tests passed');
