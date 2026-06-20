import type { HeroId, Team } from '@voxel-strike/shared';

export interface PlainNpcVec3 {
  x: number;
  y: number;
  z: number;
}

export interface NpcSpawnRequester {
  team?: string | null;
  position: PlainNpcVec3;
  lookYaw: number;
}

export interface NpcJoinedPayload {
  playerId: string;
  playerName: string;
  team: Team;
  heroId: HeroId;
  isNpc: true;
  position?: PlainNpcVec3;
}

export interface NpcSpawnedPayload {
  npcId: string;
  name: string;
  heroId: HeroId;
  team: Team;
  position: PlainNpcVec3;
}

export interface NpcErrorPayload {
  message: string;
}

export interface NpcDamagedPayload {
  npcId: string;
  name: string;
  damage: number;
  health: number;
  maxHealth: number;
  killed: boolean;
}

export interface NpcKilledPayload {
  npcId: string;
  name: string;
}

export interface AllNpcsKilledPayload {
  count: number;
}

export interface NpcLeftPayload {
  playerId: string;
  isNpc: true;
}

export interface NpcDamageSourceContext {
  sourcePosition: PlainNpcVec3 | null;
  sourceDirection: PlainNpcVec3 | null;
}

export function resolveNpcSpawnTeam(requestedTeam: Team | undefined, requesterTeam?: string | null): Team {
  if (requestedTeam) return requestedTeam;
  if (requesterTeam === undefined || requesterTeam === null) return 'blue';
  return requesterTeam === 'red' ? 'blue' : 'red';
}

export function resolveNpcSpawnPosition(input: {
  requestedPosition?: PlainNpcVec3;
  requester?: NpcSpawnRequester | null;
  random?: () => number;
}): PlainNpcVec3 {
  if (input.requestedPosition) {
    return { ...input.requestedPosition };
  }

  const { requester } = input;
  if (!requester) {
    return { x: 0, y: 5, z: 0 };
  }

  const random = input.random ?? Math.random;
  const angle = requester.lookYaw + (random() - 0.5) * 0.5;
  const distance = 5 + random() * 5;
  return {
    x: requester.position.x + Math.sin(angle) * distance,
    y: requester.position.y,
    z: requester.position.z + Math.cos(angle) * distance,
  };
}

export function resolveNpcDamageSourceContext(input: {
  source?: { position: PlainNpcVec3 } | null;
  target: { position: PlainNpcVec3 };
}): NpcDamageSourceContext {
  const { source, target } = input;
  if (!source) {
    return {
      sourcePosition: null,
      sourceDirection: null,
    };
  }

  return {
    sourcePosition: { ...source.position },
    sourceDirection: normalizeNpcDamageDirection({
      x: target.position.x - source.position.x,
      y: target.position.y - source.position.y,
      z: target.position.z - source.position.z,
    }),
  };
}

export function buildNpcJoinedPayload(input: {
  npcId: string;
  npcName: string;
  team: Team;
  heroId: HeroId;
  position: PlainNpcVec3;
  includePosition: boolean;
}): NpcJoinedPayload {
  return {
    playerId: input.npcId,
    playerName: input.npcName,
    team: input.team,
    heroId: input.heroId,
    isNpc: true,
    ...(input.includePosition ? { position: { ...input.position } } : {}),
  };
}

export function buildNpcSpawnedPayload(input: {
  npcId: string;
  npcName: string;
  team: Team;
  heroId: HeroId;
  position: PlainNpcVec3;
}): NpcSpawnedPayload {
  return {
    npcId: input.npcId,
    name: input.npcName,
    heroId: input.heroId,
    team: input.team,
    position: { ...input.position },
  };
}

export function buildNpcErrorPayload(message: string): NpcErrorPayload {
  return { message };
}

export function buildNpcDamagedPayload(input: {
  npcId: string;
  npcName: string;
  damage: number;
  health: number;
  maxHealth: number;
  killed: boolean;
}): NpcDamagedPayload {
  return {
    npcId: input.npcId,
    name: input.npcName,
    damage: input.damage,
    health: input.health,
    maxHealth: input.maxHealth,
    killed: input.killed,
  };
}

export function buildNpcKilledPayload(input: {
  npcId: string;
  npcName: string;
}): NpcKilledPayload {
  return {
    npcId: input.npcId,
    name: input.npcName,
  };
}

export function buildAllNpcsKilledPayload(count: number): AllNpcsKilledPayload {
  return { count };
}

export function buildNpcLeftPayload(playerId: string): NpcLeftPayload {
  return {
    playerId,
    isNpc: true,
  };
}

function normalizeNpcDamageDirection(vector: PlainNpcVec3): PlainNpcVec3 | null {
  const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
  if (length <= 0.0001) return null;

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}
