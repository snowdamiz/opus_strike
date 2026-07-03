import assert from 'node:assert/strict';
import { shouldPreventGameplayBrowserShortcut } from './useInput';

function shouldPreventShortcut(input: {
  code: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isEditableTarget?: boolean;
}): boolean {
  return shouldPreventGameplayBrowserShortcut({
    code: input.code,
    ctrlKey: input.ctrlKey ?? false,
    metaKey: input.metaKey ?? false,
    altKey: input.altKey ?? false,
    shiftKey: input.shiftKey ?? false,
    isEditableTarget: input.isEditableTarget,
  });
}

assert.equal(
  shouldPreventShortcut({ code: 'ControlLeft', ctrlKey: true }),
  true,
  'modifier key presses are consumed on non-editable game surfaces'
);

assert.equal(
  shouldPreventShortcut({ code: 'AltLeft', altKey: true }),
  true,
  'Alt alone is consumed on non-editable game surfaces so it cannot focus browser menus'
);

assert.equal(
  shouldPreventShortcut({ code: 'KeyW', ctrlKey: true }),
  true,
  'Ctrl+W should be suppressed because it closes the current tab'
);

assert.equal(
  shouldPreventShortcut({ code: 'KeyW', metaKey: true }),
  true,
  'Command+W should be suppressed because it closes the current tab'
);

assert.equal(
  shouldPreventShortcut({ code: 'KeyW', ctrlKey: true, shiftKey: true }),
  true,
  'Ctrl+Shift+W should be suppressed while the game is mounted'
);

assert.equal(
  shouldPreventShortcut({ code: 'KeyQ', metaKey: true }),
  true,
  'Command+Q should be suppressed because it quits browsers on macOS'
);

assert.equal(
  shouldPreventShortcut({ code: 'KeyQ', ctrlKey: true, shiftKey: true }),
  true,
  'Ctrl+Shift+Q should be suppressed because it can quit Firefox'
);

assert.equal(
  shouldPreventShortcut({ code: 'F4', altKey: true }),
  true,
  'Alt+F4 should be suppressed because it closes the current window'
);

assert.equal(
  shouldPreventShortcut({ code: 'F4', ctrlKey: true }),
  true,
  'Ctrl+F4 should be suppressed because it closes the current tab'
);

assert.equal(
  shouldPreventShortcut({ code: 'F5' }),
  true,
  'F5 should be suppressed because it reloads the game'
);

assert.equal(
  shouldPreventShortcut({ code: 'Backspace' }),
  true,
  'Backspace should be suppressed because some browsers navigate back with it'
);

assert.equal(
  shouldPreventShortcut({ code: 'BrowserBack' }),
  true,
  'hardware browser back should be suppressed'
);

assert.equal(
  shouldPreventShortcut({ code: 'ArrowLeft', altKey: true }),
  true,
  'Alt+Left should be suppressed because it navigates back'
);

assert.equal(
  shouldPreventShortcut({ code: 'BracketLeft', metaKey: true }),
  true,
  'Command+[ should be suppressed because it navigates back'
);

assert.equal(
  shouldPreventShortcut({ code: 'KeyF', altKey: true }),
  true,
  'Alt+F should be suppressed because it can start Chrome menu exit'
);

assert.equal(
  shouldPreventShortcut({ code: 'Space', altKey: true }),
  true,
  'Alt+Space should be suppressed because it can open the window menu close path'
);

assert.equal(
  shouldPreventShortcut({ code: 'Escape', metaKey: true, altKey: true, isEditableTarget: true }),
  true,
  'modifier+Escape should still be blocked in editable inputs'
);

assert.equal(
  shouldPreventShortcut({ code: 'Backspace', isEditableTarget: true }),
  false,
  'Backspace should keep working in editable inputs'
);

assert.equal(
  shouldPreventShortcut({ code: 'KeyW', ctrlKey: true, isEditableTarget: true }),
  true,
  'Ctrl+W should still be blocked in editable inputs'
);

assert.equal(
  shouldPreventShortcut({ code: 'KeyC', ctrlKey: true, isEditableTarget: true }),
  false,
  'safe text-editing Ctrl shortcuts should keep working in editable inputs'
);

assert.equal(
  shouldPreventShortcut({ code: 'KeyL', ctrlKey: true }),
  true,
  'all Ctrl browser chords are suppressed on non-editable game surfaces'
);

assert.equal(
  shouldPreventShortcut({ code: 'KeyO', ctrlKey: true }),
  true,
  'non-unload Ctrl shortcuts are still suppressed on non-editable game surfaces'
);

assert.equal(
  shouldPreventShortcut({ code: 'KeyO', ctrlKey: true, isEditableTarget: true }),
  false,
  'safe Ctrl shortcuts are left alone in editable inputs'
);

assert.equal(
  shouldPreventShortcut({ code: 'KeyO' }),
  false,
  'ordinary unmodified gameplay key presses are not treated as browser shortcuts'
);

console.log('useInput shortcut tests passed');
