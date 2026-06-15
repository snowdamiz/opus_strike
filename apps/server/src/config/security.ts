export function envFlag(name: string, defaultValue = false): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return defaultValue;
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
}

export function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === 'production';
}

const LOCAL_DEVELOPMENT_AUTH_SECRET = 'local-development-auth-secret-do-not-use-in-production';
const LOCAL_DEVELOPMENT_ENTRY_TICKET_SECRET = 'local-development-entry-ticket-secret';
const MIN_PRODUCTION_SECRET_LENGTH = 32;

function isWeakProductionSecret(value: string): boolean {
  return value.length < MIN_PRODUCTION_SECRET_LENGTH
    || value === LOCAL_DEVELOPMENT_AUTH_SECRET
    || value === LOCAL_DEVELOPMENT_ENTRY_TICKET_SECRET
    || value === 'voxel-strike-secret-key-change-in-production';
}

function assertUsableProductionSecret(secret: string, label: string): void {
  if (!isProductionEnvironment()) return;
  if (!secret) {
    throw new Error(`${label} must be set in production`);
  }
  if (isWeakProductionSecret(secret)) {
    throw new Error(`${label} must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters and must not use a development fallback`);
  }
}

export function getAuthTokenSecret(): string {
  const secret = process.env.JWT_SECRET?.trim() || '';
  if (secret) {
    assertUsableProductionSecret(secret, 'JWT_SECRET');
    return secret;
  }

  assertUsableProductionSecret('', 'JWT_SECRET');
  return LOCAL_DEVELOPMENT_AUTH_SECRET;
}

export function assertUsableAuthSecret(): void {
  void getAuthTokenSecret();
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
  return process.env.ENTRY_TICKET_SECRET?.trim()
    || process.env.JWT_SECRET?.trim()
    || (isProductionEnvironment()
      ? ''
      : LOCAL_DEVELOPMENT_ENTRY_TICKET_SECRET);
}

export function assertUsableEntryTicketSecret(): void {
  const secret = getEntryTicketSecret();
  if (!secret) {
    throw new Error('ENTRY_TICKET_SECRET or JWT_SECRET must be set for lobby-created game rooms');
  }
  assertUsableProductionSecret(secret, 'ENTRY_TICKET_SECRET or JWT_SECRET');
}
