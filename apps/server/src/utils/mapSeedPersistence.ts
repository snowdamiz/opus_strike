export function mapSeedToDatabaseValue(mapSeed: number): bigint {
  return BigInt(mapSeed >>> 0);
}

export function nullableMapSeedToDatabaseValue(mapSeed: number | null): bigint | null {
  return mapSeed === null ? null : mapSeedToDatabaseValue(mapSeed);
}

export function mapSeedFromDatabaseValue(mapSeed: bigint | number): number {
  return Number(mapSeed);
}

export function nullableMapSeedFromDatabaseValue(mapSeed: bigint | number | null): number | null {
  return mapSeed === null ? null : mapSeedFromDatabaseValue(mapSeed);
}
