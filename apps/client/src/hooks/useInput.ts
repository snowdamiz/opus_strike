import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { createEmptyInputState } from '@voxel-strike/shared';
import type { InputState } from '@voxel-strike/shared';
import { isGameConsoleOpen } from '../store/gameConsoleState';
import { useMobileControlsStore } from '../store/mobileControlsStore';
import { useSettingsStore } from '../store/settingsStore';
import { mouseButtonToKeybindCode } from '../utils/keybindings';
import { useGamepadInput } from './gamepadInput';

type InputAction = keyof InputState;

interface UseInputReturn {
  inputState: InputState;
  isPointerLocked: boolean;
  isTouchInputActive: boolean;
  isGamepadInputActive: boolean;
  requestPointerLock: () => void;
  exitPointerLock: () => void;
}

interface UseInputOptions {
  gamepadEnabled?: boolean;
}

function mergeInputStates(primary: InputState, secondary: InputState): InputState {
  return {
    moveForward: primary.moveForward || secondary.moveForward,
    moveBackward: primary.moveBackward || secondary.moveBackward,
    moveLeft: primary.moveLeft || secondary.moveLeft,
    moveRight: primary.moveRight || secondary.moveRight,
    jump: primary.jump || secondary.jump,
    crouch: primary.crouch || secondary.crouch,
    sprint: primary.sprint || secondary.sprint,
    primaryFire: primary.primaryFire || secondary.primaryFire,
    secondaryFire: primary.secondaryFire || secondary.secondaryFire,
    reload: primary.reload || secondary.reload,
    ability1: primary.ability1 || secondary.ability1,
    ability2: primary.ability2 || secondary.ability2,
    ultimate: primary.ultimate || secondary.ultimate,
    interact: primary.interact || secondary.interact,
  };
}

const BROWSER_SHORTCUT_MODIFIER_CODES = new Set([
  'AltLeft',
  'AltRight',
  'ControlLeft',
  'ControlRight',
  'MetaLeft',
  'MetaRight',
]);

const SINGLE_KEY_BROWSER_UNLOAD_CODES = new Set([
  'Backspace',
  'BrowserBack',
  'BrowserForward',
  'F5',
]);

const BROWSER_CONTROL_CODES = new Set([
  'F1',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F10',
  'F11',
  'F12',
]);

function hasShortcutModifier(input: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return input.ctrlKey || input.metaKey || input.altKey;
}

function isBrowserUnloadShortcut(input: {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isEditableTarget?: boolean;
}): boolean {
  if (
    SINGLE_KEY_BROWSER_UNLOAD_CODES.has(input.code) &&
    !(input.isEditableTarget && input.code === 'Backspace')
  ) {
    return true;
  }
  if (input.shiftKey && input.code === 'Escape') return true;
  if (hasShortcutModifier(input) && input.code === 'Escape') return true;

  if ((input.ctrlKey || input.metaKey) && (
    input.code === 'KeyQ' ||
    input.code === 'KeyR' ||
    input.code === 'KeyW'
  )) {
    return true;
  }

  if ((input.ctrlKey || input.metaKey || input.altKey) && input.code === 'F4') {
    return true;
  }

  if (input.altKey && (
    input.code === 'KeyF' ||
    input.code === 'Space'
  )) {
    return true;
  }

  if ((input.altKey || input.metaKey) && (
    input.code === 'ArrowLeft' ||
    input.code === 'ArrowRight' ||
    input.code === 'BracketLeft' ||
    input.code === 'BracketRight'
  )) {
    return true;
  }

  if (input.metaKey && (
    input.code === 'KeyH' ||
    input.code === 'KeyM'
  )) {
    return true;
  }

  return false;
}

export function shouldPreventGameplayBrowserShortcut(input: {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isEditableTarget?: boolean;
}): boolean {
  if (isBrowserUnloadShortcut(input)) return true;
  if (BROWSER_CONTROL_CODES.has(input.code)) return true;
  if (input.isEditableTarget) return false;

  return (
    BROWSER_SHORTCUT_MODIFIER_CODES.has(input.code) ||
    hasShortcutModifier(input)
  );
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (document.body.dataset.rebindingKeybind === 'true') return true;
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function useInput(options: UseInputOptions = {}): UseInputReturn {
  const { gamepadEnabled = true } = options;
  const inputStateRef = useRef<InputState>(createEmptyInputState());
  const [inputState, setInputState] = useState<InputState>(createEmptyInputState());
  const [isPointerLocked, setIsPointerLocked] = useState(
    () => typeof document !== 'undefined' && document.pointerLockElement !== null
  );
  const mobileInputState = useMobileControlsStore(state => state.inputState);
  const isTouchInputActive = useMobileControlsStore(state => state.isTouchInputActive);
  const { inputState: gamepadInputState, isGamepadInputActive } = useGamepadInput(gamepadEnabled);
  const toggleCrouch = useSettingsStore(state => state.settings.toggleCrouch);
  const toggleSprint = useSettingsStore(state => state.settings.toggleSprint);
  const keybindings = useSettingsStore(state => state.settings.keybindings);

  // Create key to action mapping
  const keyToAction = useRef<Map<string, InputAction>>(new Map());
  const pressedCodesRef = useRef<Set<string>>(new Set());
  const toggleSettingsRef = useRef({ toggleCrouch, toggleSprint });

  useEffect(() => {
    toggleSettingsRef.current = { toggleCrouch, toggleSprint };
  }, [toggleCrouch, toggleSprint]);

  useEffect(() => {
    // Build reverse mapping
    const map = new Map<string, InputAction>();
    for (const [action, code] of Object.entries(keybindings)) {
      if (action === 'scoreboard') continue;
      map.set(code, action as InputAction);
    }
    keyToAction.current = map;
    inputStateRef.current = createEmptyInputState();
    setInputState(createEmptyInputState());
    pressedCodesRef.current.clear();
  }, [keybindings]);

  const setActionPressed = useCallback((action: InputAction, isPressed: boolean) => {
    if (inputStateRef.current[action] === isPressed) return;

    inputStateRef.current = {
      ...inputStateRef.current,
      [action]: isPressed,
    };
    setInputState({ ...inputStateRef.current });
  }, []);

  const pressInputCode = useCallback((code: string): boolean => {
    const action = keyToAction.current.get(code);
    if (!action) return false;

    const wasPressed = pressedCodesRef.current.has(code);
    pressedCodesRef.current.add(code);

    if (
      action === 'crouch' &&
      toggleSettingsRef.current.toggleCrouch
    ) {
      if (!wasPressed) {
        inputStateRef.current = {
          ...inputStateRef.current,
          crouch: !inputStateRef.current.crouch,
        };
        setInputState({ ...inputStateRef.current });
      }
      return true;
    }

    if (
      action === 'sprint' &&
      toggleSettingsRef.current.toggleSprint
    ) {
      if (!wasPressed) {
        inputStateRef.current = {
          ...inputStateRef.current,
          sprint: !inputStateRef.current.sprint,
        };
        setInputState({ ...inputStateRef.current });
      }
      return true;
    }

    setActionPressed(action, true);
    return true;
  }, [setActionPressed]);

  const releaseInputCode = useCallback((code: string): boolean => {
    const action = keyToAction.current.get(code);
    pressedCodesRef.current.delete(code);
    if (!action) return false;

    if (
      (action === 'crouch' && toggleSettingsRef.current.toggleCrouch) ||
      (action === 'sprint' && toggleSettingsRef.current.toggleSprint)
    ) {
      return true;
    }

    setActionPressed(action, false);
    return true;
  }, [setActionPressed]);

  const shouldConsumeBrowserShortcut = useCallback((e: KeyboardEvent) => (
    shouldPreventGameplayBrowserShortcut({
      code: e.code,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      isEditableTarget: isEditableKeyboardTarget(e.target),
    })
  ), []);

  const consumeKeyboardEvent = useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, []);

  // Handle key down
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const consumedBrowserShortcut = shouldConsumeBrowserShortcut(e);
      if (consumedBrowserShortcut) {
        consumeKeyboardEvent(e);
      }

      // Ignore game controls when console is open
      if (isGameConsoleOpen()) {
        return;
      }

      if (pressInputCode(e.code)) {
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (shouldConsumeBrowserShortcut(e)) {
        consumeKeyboardEvent(e);
      }

      if (releaseInputCode(e.code)) {
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [consumeKeyboardEvent, pressInputCode, releaseInputCode, shouldConsumeBrowserShortcut]);

  // Handle mouse buttons
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (!isPointerLocked) return;

      if (pressInputCode(mouseButtonToKeybindCode(e.button))) {
        e.preventDefault();
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (releaseInputCode(mouseButtonToKeybindCode(e.button))) {
        e.preventDefault();
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (isPointerLocked) {
        e.preventDefault();
      }
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('contextmenu', handleContextMenu);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [isPointerLocked, pressInputCode, releaseInputCode]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Handle pointer lock
  useEffect(() => {
    const handlePointerLockChange = () => {
      setIsPointerLocked(document.pointerLockElement !== null);
    };

    const handlePointerLockError = () => {
      // Don't log as error - this is normal when clicking during transitions
      setIsPointerLocked(false);
    };

    document.addEventListener('pointerlockchange', handlePointerLockChange);
    document.addEventListener('pointerlockerror', handlePointerLockError);
    handlePointerLockChange();

    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      document.removeEventListener('pointerlockerror', handlePointerLockError);
    };
  }, []);

  // Clear all inputs when losing pointer lock
  useEffect(() => {
    if (!isPointerLocked) {
      inputStateRef.current = createEmptyInputState();
      setInputState(createEmptyInputState());
      pressedCodesRef.current.clear();
    }
  }, [isPointerLocked]);

  const requestPointerLock = useCallback(() => {
    const canvas = document.querySelector('canvas');
    if (canvas && document.pointerLockElement !== canvas) {
      const lockResult = canvas.requestPointerLock() as Promise<void> | void;
      if (lockResult && typeof lockResult.catch === 'function') {
        lockResult.catch((err) => {
          // Ignore pointer lock errors - they happen when user clicks too fast
          console.log('Pointer lock request failed:', err.message);
        });
      }
    }
  }, []);

  const exitPointerLock = useCallback(() => {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, []);

  const mergedInputState = useMemo(
    () => mergeInputStates(mergeInputStates(inputState, mobileInputState), gamepadInputState),
    [gamepadInputState, inputState, mobileInputState]
  );

  return {
    inputState: mergedInputState,
    isPointerLocked,
    isTouchInputActive,
    isGamepadInputActive,
    requestPointerLock,
    exitPointerLock,
  };
}
