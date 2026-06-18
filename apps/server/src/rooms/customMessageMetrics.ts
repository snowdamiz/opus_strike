const STRING_WRAPPER_BYTES = 2;
const COLLECTION_WRAPPER_BYTES = 2;
const PROPERTY_SEPARATOR_BYTES = 1;
const ITEM_SEPARATOR_BYTES = 1;
const NUMBER_ESTIMATE_BYTES = 8;
const BOOLEAN_ESTIMATE_BYTES = 5;
const NULL_ESTIMATE_BYTES = 4;
const UNKNOWN_OBJECT_BYTES = 16;
const MAX_ESTIMATE_DEPTH = 8;
const PACKED_TRANSFORM_NUMBER_COUNT = 13;
const PACKED_TRANSFORM_ESTIMATE_BYTES =
  COLLECTION_WRAPPER_BYTES +
  PACKED_TRANSFORM_NUMBER_COUNT * NUMBER_ESTIMATE_BYTES +
  (PACKED_TRANSFORM_NUMBER_COUNT - 1) * ITEM_SEPARATOR_BYTES;
const SELF_MOVEMENT_AUTHORITY_ESTIMATE_BYTES = 420;
const PLAYER_VITALS_BASE_BYTES = 64;
const PLAYER_VITALS_SNAPSHOT_ESTIMATE_BYTES = 520;
const PLAYER_TRANSFORM_HIDDEN_ID_ESTIMATE_BYTES = 48;
const PLAYER_INTEREST_BASE_BYTES = 56;
const PLAYER_INTEREST_SNAPSHOT_ESTIMATE_BYTES = 96;
const PLAYER_PING_BASE_BYTES = 48;
const PLAYER_PING_SNAPSHOT_ESTIMATE_BYTES = 48;
const MATCH_SNAPSHOT_ESTIMATE_BYTES = 760;
const ABILITY_USED_ESTIMATE_BYTES = 280;
const PLAYER_DAMAGED_ESTIMATE_BYTES = 260;
const CHRONOS_AEGIS_DAMAGED_ESTIMATE_BYTES = 280;
const PHANTOM_SHIELD_BROKEN_ESTIMATE_BYTES = 240;
const PLAYER_KILLED_ESTIMATE_BYTES = 300;
const PLAYER_HEALED_BASE_BYTES = 180;
const PLAYER_HEALED_TARGET_ESTIMATE_BYTES = 88;
const POWERUP_COLLECTED_ESTIMATE_BYTES = 180;

function estimateStringBytes(value: string): number {
  return STRING_WRAPPER_BYTES + Buffer.byteLength(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function estimatePlayerTransformsV2Bytes(payload: unknown): number {
  if (!isRecord(payload)) return UNKNOWN_OBJECT_BYTES;
  return 80 +
    arrayLength(payload.players) * PACKED_TRANSFORM_ESTIMATE_BYTES +
    arrayLength(payload.hiddenPlayerIds) * PLAYER_TRANSFORM_HIDDEN_ID_ESTIMATE_BYTES;
}

function estimatePlayerVitalsBytes(payload: unknown): number {
  if (!isRecord(payload)) return UNKNOWN_OBJECT_BYTES;
  return PLAYER_VITALS_BASE_BYTES +
    arrayLength(payload.players) * PLAYER_VITALS_SNAPSHOT_ESTIMATE_BYTES +
    arrayLength(payload.removedPlayerIds) * 48;
}

function estimatePlayerInterestBytes(payload: unknown): number {
  if (!isRecord(payload)) return UNKNOWN_OBJECT_BYTES;
  return PLAYER_INTEREST_BASE_BYTES + arrayLength(payload.players) * PLAYER_INTEREST_SNAPSHOT_ESTIMATE_BYTES;
}

function estimatePlayerPingsBytes(payload: unknown): number {
  if (!isRecord(payload)) return UNKNOWN_OBJECT_BYTES;
  return PLAYER_PING_BASE_BYTES + arrayLength(payload.players) * PLAYER_PING_SNAPSHOT_ESTIMATE_BYTES;
}

function estimatePingRequestBytes(payload: unknown): number {
  if (!isRecord(payload) || typeof payload.nonce !== 'string') return UNKNOWN_OBJECT_BYTES;
  return 16 + estimateStringBytes(payload.nonce);
}

function estimatePlayerHealedBytes(payload: unknown): number {
  if (!isRecord(payload)) return UNKNOWN_OBJECT_BYTES;
  return PLAYER_HEALED_BASE_BYTES + arrayLength(payload.targets) * PLAYER_HEALED_TARGET_ESTIMATE_BYTES;
}

function estimateValueBytes(value: unknown, seen: WeakSet<object>, depth: number): number {
  if (value === null || value === undefined) return NULL_ESTIMATE_BYTES;

  switch (typeof value) {
    case 'string':
      return estimateStringBytes(value);
    case 'number':
    case 'bigint':
      return NUMBER_ESTIMATE_BYTES;
    case 'boolean':
      return BOOLEAN_ESTIMATE_BYTES;
    case 'object':
      break;
    default:
      return 0;
  }

  if (depth >= MAX_ESTIMATE_DEPTH) return UNKNOWN_OBJECT_BYTES;

  const objectValue = value as object;
  if (seen.has(objectValue)) return UNKNOWN_OBJECT_BYTES;
  seen.add(objectValue);

  if (Array.isArray(value)) {
    let bytes = COLLECTION_WRAPPER_BYTES;
    for (let index = 0; index < value.length; index++) {
      if (index > 0) bytes += ITEM_SEPARATOR_BYTES;
      bytes += estimateValueBytes(value[index], seen, depth + 1);
    }
    seen.delete(objectValue);
    return bytes;
  }

  let bytes = COLLECTION_WRAPPER_BYTES;
  let propertyCount = 0;
  const record = value as Record<string, unknown>;
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    if (propertyCount > 0) bytes += ITEM_SEPARATOR_BYTES;
    bytes += estimateStringBytes(key) + PROPERTY_SEPARATOR_BYTES;
    bytes += estimateValueBytes(record[key], seen, depth + 1);
    propertyCount++;
  }

  seen.delete(objectValue);
  return bytes;
}

function estimateFallbackMessageBytes(payload: unknown): number {
  return Math.max(0, Math.ceil(estimateValueBytes(payload, new WeakSet<object>(), 0)));
}

export function estimateCustomMessageBytes(type: string, payload: unknown): number {
  switch (type) {
    case 'playerTransformsV2':
      return estimatePlayerTransformsV2Bytes(payload);
    case 'selfMovementAuthority':
      return SELF_MOVEMENT_AUTHORITY_ESTIMATE_BYTES;
    case 'playerVitals':
      return estimatePlayerVitalsBytes(payload);
    case 'playerInterest':
      return estimatePlayerInterestBytes(payload);
    case 'playerPings':
      return estimatePlayerPingsBytes(payload);
    case 'playerPingRequest':
      return estimatePingRequestBytes(payload);
    case 'matchSnapshot':
      return MATCH_SNAPSHOT_ESTIMATE_BYTES;
    case 'abilityUsed':
      return ABILITY_USED_ESTIMATE_BYTES;
    case 'playerDamaged':
      return PLAYER_DAMAGED_ESTIMATE_BYTES;
    case 'chronosAegisDamaged':
      return CHRONOS_AEGIS_DAMAGED_ESTIMATE_BYTES;
    case 'phantomShieldBroken':
      return PHANTOM_SHIELD_BROKEN_ESTIMATE_BYTES;
    case 'playerKilled':
      return PLAYER_KILLED_ESTIMATE_BYTES;
    case 'playerHealed':
      return estimatePlayerHealedBytes(payload);
    case 'powerupCollected':
      return POWERUP_COLLECTED_ESTIMATE_BYTES;
    default:
      return estimateFallbackMessageBytes(payload);
  }
}
