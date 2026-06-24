import crypto from 'crypto';
import {
  DEFAULT_MATCH_PERSPECTIVE,
  getHeroSkinDefinition,
  isHeroSkinId,
  isMatchPerspective,
  isTeamId,
  type HeroId,
  type HeroSkinId,
  type MatchPerspective,
  type PlayerRole,
  type Team,
} from '@voxel-strike/shared';
import { createSignedTicket, readSignedTicketClaims } from './signedTicket';

export interface GameEntryTicketClaims {
  version: 1;
  lobbyId: string;
  gameRoomId: string;
  lobbyPlayerId: string;
  userId: string;
  displayName: string;
  matchPerspective?: MatchPerspective;
  role?: PlayerRole;
  assignedTeam?: Team;
  selectedHero?: HeroId;
  selectedSkinId?: HeroSkinId;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface CreateGameEntryTicketInput {
  lobbyId: string;
  gameRoomId: string;
  lobbyPlayerId: string;
  userId: string;
  displayName: string;
  matchPerspective?: MatchPerspective;
  role?: PlayerRole;
  assignedTeam?: Team;
  selectedHero?: HeroId;
  selectedSkinId?: HeroSkinId;
  ttlMs?: number;
}

const DEFAULT_TICKET_TTL_MS = 90_000;

function normalizeSelectedSkinId(heroId: HeroId | undefined, skinId: unknown): HeroSkinId | undefined {
  if (!heroId || !isHeroSkinId(skinId)) return undefined;
  const skin = getHeroSkinDefinition(skinId);
  return skin.heroId === heroId ? skinId : undefined;
}

function normalizeTicketRole(role: unknown): PlayerRole {
  return role === 'observer' ? 'observer' : 'combat';
}

export function createGameEntryTicket(input: CreateGameEntryTicketInput): string {
  const now = Date.now();
  const claims: GameEntryTicketClaims = {
    version: 1,
    lobbyId: input.lobbyId,
    gameRoomId: input.gameRoomId,
    lobbyPlayerId: input.lobbyPlayerId,
    userId: input.userId,
    displayName: input.displayName,
    matchPerspective: input.matchPerspective ?? DEFAULT_MATCH_PERSPECTIVE,
    role: input.role ?? 'combat',
    assignedTeam: input.assignedTeam,
    selectedHero: input.selectedHero,
    selectedSkinId: normalizeSelectedSkinId(input.selectedHero, input.selectedSkinId),
    issuedAt: now,
    expiresAt: now + (input.ttlMs ?? DEFAULT_TICKET_TTL_MS),
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  return createSignedTicket(claims);
}

export function verifyGameEntryTicket(
  ticket: unknown,
  expected: { lobbyId?: string | null; gameRoomId: string; now?: number }
): GameEntryTicketClaims | null {
  const claims = readSignedTicketClaims<GameEntryTicketClaims>(ticket);
  if (!claims) return null;

  const now = expected.now ?? Date.now();
  if (claims.version !== 1) return null;
  if (claims.gameRoomId !== expected.gameRoomId) return null;
  if (expected.lobbyId && claims.lobbyId !== expected.lobbyId) return null;
  if (claims.expiresAt < now) return null;
  if (claims.issuedAt > now + 5_000) return null;
  const role = normalizeTicketRole(claims.role);
  if (role === 'combat' && !isTeamId(claims.assignedTeam)) return null;
  if (!claims.userId || !claims.lobbyPlayerId || !claims.displayName || !claims.nonce) return null;

  return {
    ...claims,
    role,
    assignedTeam: isTeamId(claims.assignedTeam) ? claims.assignedTeam : undefined,
    matchPerspective: isMatchPerspective(claims.matchPerspective)
      ? claims.matchPerspective
      : DEFAULT_MATCH_PERSPECTIVE,
    selectedSkinId: normalizeSelectedSkinId(claims.selectedHero, claims.selectedSkinId),
  };
}
