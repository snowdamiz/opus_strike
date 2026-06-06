import { useEffect, useCallback, useRef, useState } from 'react';
import { createEmptyInputState, DEFAULT_KEYBINDINGS } from '@voxel-strike/shared';
import type { InputState } from '@voxel-strike/shared';
import { isGameConsoleOpen } from '../components/ui/GameConsole';
import { useSettingsStore } from '../store/settingsStore';

interface UseInputReturn {
  inputState: InputState;
  isPointerLocked: boolean;
  isControlPressed: boolean;
  requestPointerLock: () => void;
  exitPointerLock: () => void;
}

export function useInput(): UseInputReturn {
  const inputStateRef = useRef<InputState>(createEmptyInputState());
  const [inputState, setInputState] = useState<InputState>(createEmptyInputState());
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [isControlPressed, setIsControlPressed] = useState(false);
  const toggleCrouch = useSettingsStore(state => state.settings.toggleCrouch);
  const toggleSprint = useSettingsStore(state => state.settings.toggleSprint);

  // Create key to action mapping
  const keyToAction = useRef<Map<string, keyof InputState>>(new Map());
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const toggleSettingsRef = useRef({ toggleCrouch, toggleSprint });

  useEffect(() => {
    toggleSettingsRef.current = { toggleCrouch, toggleSprint };
  }, [toggleCrouch, toggleSprint]);

  useEffect(() => {
    // Build reverse mapping
    const map = new Map<string, keyof InputState>();
    for (const [action, key] of Object.entries(DEFAULT_KEYBINDINGS)) {
      map.set(key, action as keyof InputState);
    }
    keyToAction.current = map;
  }, []);

  // Handle key down
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore game controls when console is open
      if (isGameConsoleOpen()) {
        return;
      }

      if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
        setIsControlPressed(true);
      }

      // Prevent default for game keys
      if (keyToAction.current.has(e.code)) {
        e.preventDefault();
      }

      const action = keyToAction.current.get(e.code);
      const wasPressed = pressedKeysRef.current.has(e.code);
      pressedKeysRef.current.add(e.code);

      if (
        action === 'crouch' &&
        toggleSettingsRef.current.toggleCrouch &&
        !wasPressed
      ) {
        inputStateRef.current = {
          ...inputStateRef.current,
          crouch: !inputStateRef.current.crouch,
        };
        setInputState({ ...inputStateRef.current });
        return;
      }

      if (
        action === 'sprint' &&
        toggleSettingsRef.current.toggleSprint &&
        !wasPressed
      ) {
        inputStateRef.current = {
          ...inputStateRef.current,
          sprint: !inputStateRef.current.sprint,
        };
        setInputState({ ...inputStateRef.current });
        return;
      }

      if (action && !inputStateRef.current[action]) {
        inputStateRef.current = {
          ...inputStateRef.current,
          [action]: true,
        };
        setInputState({ ...inputStateRef.current });
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
        setIsControlPressed(false);
      }

      pressedKeysRef.current.delete(e.code);

      // Always handle key up to prevent stuck keys
      const action = keyToAction.current.get(e.code);
      if (
        (action === 'crouch' && toggleSettingsRef.current.toggleCrouch) ||
        (action === 'sprint' && toggleSettingsRef.current.toggleSprint)
      ) {
        return;
      }

      if (action && inputStateRef.current[action]) {
        inputStateRef.current = {
          ...inputStateRef.current,
          [action]: false,
        };
        setInputState({ ...inputStateRef.current });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Handle mouse buttons
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (!isPointerLocked) return;

      if (e.button === 0) {
        inputStateRef.current = { ...inputStateRef.current, primaryFire: true };
        setInputState({ ...inputStateRef.current });
      } else if (e.button === 2) {
        inputStateRef.current = { ...inputStateRef.current, secondaryFire: true };
        setInputState({ ...inputStateRef.current });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        inputStateRef.current = { ...inputStateRef.current, primaryFire: false };
        setInputState({ ...inputStateRef.current });
      } else if (e.button === 2) {
        inputStateRef.current = { ...inputStateRef.current, secondaryFire: false };
        setInputState({ ...inputStateRef.current });
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
  }, [isPointerLocked]);

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
      setIsControlPressed(false);
      pressedKeysRef.current.clear();
    }
  }, [isPointerLocked]);

  const requestPointerLock = useCallback(() => {
    const canvas = document.querySelector('canvas');
    if (canvas && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock().catch((err) => {
        // Ignore pointer lock errors - they happen when user clicks too fast
        console.log('Pointer lock request failed:', err.message);
      });
    }
  }, []);

  const exitPointerLock = useCallback(() => {
    document.exitPointerLock();
  }, []);

  return {
    inputState,
    isPointerLocked,
    isControlPressed,
    requestPointerLock,
    exitPointerLock,
  };
}
