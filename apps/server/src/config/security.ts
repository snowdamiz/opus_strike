export function envFlag(name: string, defaultValue = false): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return defaultValue;
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
}

export function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function isHardenedMovementEnabled(): boolean {
  return envFlag('HARDENED_MOVEMENT', true);
}

export function isGuestPlayAllowed(): boolean {
  return envFlag('ALLOW_GUEST_PLAY', !isProductionEnvironment());
}

export function isDirectGameRoomJoinAllowed(): boolean {
  if (isProductionEnvironment()) {
    return envFlag('ALLOW_DIRECT_GAME_ROOM', false);
  }
  return envFlag('ALLOW_DIRECT_GAME_ROOM', true);
}

export function isDevelopmentToolsEnabled(): boolean {
  return !isProductionEnvironment() && envFlag('ENABLE_DEV_TOOLS', false);
}

export function getEntryTicketSecret(): string {
  return process.env.ENTRY_TICKET_SECRET
    || process.env.JWT_SECRET
    || (isProductionEnvironment()
      ? ''
      : 'local-development-entry-ticket-secret');
}

export function assertUsableEntryTicketSecret(): void {
  if (!getEntryTicketSecret()) {
    throw new Error('ENTRY_TICKET_SECRET or JWT_SECRET must be set for lobby-created game rooms');
  }
}
