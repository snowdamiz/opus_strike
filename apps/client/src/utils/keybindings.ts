export function mouseButtonToKeybindCode(button: number): string {
  if (button === 0) return 'Mouse0';
  if (button === 2) return 'Mouse1';
  if (button === 1) return 'Mouse2';
  return `Mouse${button}`;
}

export function formatKeybind(code: string): string {
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse1') return 'RMB';
  if (code === 'Mouse2') return 'MMB';
  if (code.startsWith('Mouse')) return `M${code.slice(5)}`;
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl';
  if (code === 'AltLeft' || code === 'AltRight') return 'Alt';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  return code;
}
