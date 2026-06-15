const MAX_UINT32 = 0xffffffffn;
const DECIMAL_MAP_SEED_PATTERN = /^\d{1,10}$/;

export const MAP_SEED_PLACEHOLDER = '20260613';

export function isValidMapSeedInput(input: string): boolean {
  if (!DECIMAL_MAP_SEED_PATTERN.test(input)) return false;
  return BigInt(input) <= MAX_UINT32;
}

export function isAllowedMapSeedInput(input: string): boolean {
  return input === '' || isValidMapSeedInput(input);
}

export function parseOptionalMapSeedInput(input: string): number | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  if (!isValidMapSeedInput(trimmed)) {
    throw new Error('Seed must be a whole number from 0 to 4294967295');
  }

  return Number(trimmed);
}
