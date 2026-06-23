import assert from 'node:assert/strict';
import { shouldPreventGameplayBrowserShortcut } from './useInput';

const gameplayCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space']);
const gameplayCodesWithControl = new Set([...gameplayCodes, 'ControlLeft']);

function shouldPreventShortcut(input: {
  code: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isPointerLocked?: boolean;
  pressedCodes?: string[];
}): boolean {
  return shouldPreventGameplayBrowserShortcut({
    code: input.code,
    ctrlKey: input.ctrlKey ?? false,
    metaKey: input.metaKey ?? false,
    isPointerLocked: input.isPointerLocked ?? true,
    pressedCodes: new Set(input.pressedCodes ?? []),
    gameplayCodes,
  });
}

assert.equal(
  shouldPreventShortcut({ code: 'ControlLeft', ctrlKey: true, pressedCodes: ['KeyW'] }),
  true,
  'pressing Ctrl while W is held should suppress browser shortcuts'
);

assert.equal(
  shouldPreventGameplayBrowserShortcut({
    code: 'ControlLeft',
    ctrlKey: true,
    metaKey: false,
    isPointerLocked: true,
    pressedCodes: new Set(),
    gameplayCodes: gameplayCodesWithControl,
  }),
  true,
  'explicitly rebound Ctrl gameplay keys should be suppressed'
);

assert.equal(
  shouldPreventShortcut({ code: 'KeyW', ctrlKey: true, pressedCodes: ['KeyW'] }),
  true,
  'Ctrl-modified gameplay key events should be suppressed'
);

assert.equal(
  shouldPreventShortcut({ code: 'KeyW', metaKey: true, pressedCodes: ['KeyW'] }),
  true,
  'Command-modified gameplay key events should be suppressed'
);

assert.equal(
  shouldPreventShortcut({ code: 'ControlLeft', ctrlKey: true }),
  false,
  'Ctrl alone is not a gameplay/browser shortcut overlap'
);

assert.equal(
  shouldPreventShortcut({ code: 'ControlLeft', ctrlKey: true, pressedCodes: ['KeyW'], isPointerLocked: false }),
  false,
  'shortcuts are only suppressed while pointer lock is active'
);

assert.equal(
  shouldPreventShortcut({ code: 'KeyO', ctrlKey: true, pressedCodes: ['KeyW'] }),
  false,
  'non-gameplay Ctrl shortcuts are left to the browser'
);

console.log('useInput shortcut tests passed');
