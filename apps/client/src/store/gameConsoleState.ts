let isConsoleOpen = false;

export function isGameConsoleOpen(): boolean {
  return isConsoleOpen;
}

export function setGameConsoleOpen(open: boolean): void {
  isConsoleOpen = open;
}
