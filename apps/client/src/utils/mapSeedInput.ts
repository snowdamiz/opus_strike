const MAX_UINT32 = 0xffffffffn;

export function parseOptionalMapSeedInput(input: string): number | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  if (!/^(?:0x[0-9a-f]+|\d+)$/i.test(trimmed)) {
    throw new Error('Seed must be a whole number or 0x hex value');
  }

  const parsed = BigInt(trimmed);
  if (parsed > MAX_UINT32) {
    throw new Error('Seed must be between 0 and 4294967295');
  }

  return Number(parsed);
}
