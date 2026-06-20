import { Prisma, type MatchMode } from '@prisma/client';
import prisma from '../db';
import { serializeRankPayload } from '../ranking/serialization';

export const socialUserSelect = {
  id: true,
  name: true,
  lastLoginAt: true,
  competitiveRating: true,
  rankedGames: true,
  rankedWins: true,
  rankedLosses: true,
  rankedDraws: true,
  rankedPlacementsRemaining: true,
  rankedPeakRating: true,
  rankedLastMatchAt: true,
} satisfies Prisma.UserSelect;

export const lobbyInviteInclude = {
  fromUser: { select: socialUserSelect },
  toUser: { select: socialUserSelect },
} satisfies Prisma.LobbyInviteInclude;

export const partyInviteInclude = {
  fromUser: { select: socialUserSelect },
  toUser: { select: socialUserSelect },
} satisfies Prisma.PartyInviteInclude;

export type SocialUserRecord = Prisma.UserGetPayload<{ select: typeof socialUserSelect }>;
export type LobbyInviteWithUsers = Prisma.LobbyInviteGetPayload<{ include: typeof lobbyInviteInclude }>;
export type PartyInviteWithUsers = Prisma.PartyInviteGetPayload<{ include: typeof partyInviteInclude }>;

export interface LobbyInvitePayload {
  inviteId: string;
  lobbyId: string;
  lobbyName: string;
  matchMode: MatchMode | null;
  status: string;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
  from: ReturnType<typeof serializeSocialUser>;
  to: ReturnType<typeof serializeSocialUser>;
}

export interface PartyInvitePayload {
  inviteId: string;
  partyId: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
  from: ReturnType<typeof serializeSocialUser>;
  to: ReturnType<typeof serializeSocialUser>;
}

export class SocialServiceError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'SocialServiceError';
    this.statusCode = statusCode;
  }
}

export function getFriendshipPair(userId: string, otherUserId: string): {
  userAId: string;
  userBId: string;
} {
  return userId < otherUserId
    ? { userAId: userId, userBId: otherUserId }
    : { userAId: otherUserId, userBId: userId };
}

export function serializeSocialUser(user: SocialUserRecord) {
  return {
    userId: user.id,
    name: user.name,
    rank: serializeRankPayload(user).current,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

export function serializeLobbyInvite(invite: LobbyInviteWithUsers): LobbyInvitePayload {
  return {
    inviteId: invite.id,
    lobbyId: invite.lobbyId,
    lobbyName: invite.lobbyName,
    matchMode: invite.matchMode,
    status: invite.status,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
    respondedAt: invite.respondedAt?.toISOString() ?? null,
    from: serializeSocialUser(invite.fromUser),
    to: serializeSocialUser(invite.toUser),
  };
}

export function serializePartyInvite(invite: PartyInviteWithUsers): PartyInvitePayload {
  return {
    inviteId: invite.id,
    partyId: invite.partyId,
    status: invite.status,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
    respondedAt: invite.respondedAt?.toISOString() ?? null,
    from: serializeSocialUser(invite.fromUser),
    to: serializeSocialUser(invite.toUser),
  };
}

export async function expireOldLobbyInvites(now = new Date()): Promise<void> {
  await prisma.lobbyInvite.updateMany({
    where: {
      status: 'pending',
      expiresAt: { lte: now },
    },
    data: {
      status: 'expired',
      respondedAt: now,
    },
  });
}

export async function expireOldPartyInvites(now = new Date()): Promise<void> {
  await prisma.partyInvite.updateMany({
    where: {
      status: 'pending',
      expiresAt: { lte: now },
    },
    data: {
      status: 'expired',
      respondedAt: now,
    },
  });
}

export async function ensureAcceptedFriendship(userId: string, otherUserId: string): Promise<void> {
  const pair = getFriendshipPair(userId, otherUserId);
  const friendship = await prisma.friendship.findUnique({
    where: { userAId_userBId: pair },
    select: { status: true },
  });

  if (friendship?.status !== 'accepted') {
    throw new SocialServiceError(403, 'You can only invite friends');
  }
}

export async function createLobbyInvite(options: {
  fromUserId: string;
  toUserId: string;
  lobbyId: string;
  lobbyName: string;
  matchMode?: MatchMode | null;
  expiresInMs?: number;
}): Promise<LobbyInvitePayload> {
  const fromUserId = options.fromUserId.trim();
  const toUserId = options.toUserId.trim();
  const lobbyId = options.lobbyId.trim();
  const lobbyName = options.lobbyName.trim().replace(/\s+/g, ' ').slice(0, 32);

  if (!fromUserId || !toUserId || !lobbyId) {
    throw new SocialServiceError(400, 'Missing invite target or lobby');
  }

  if (fromUserId === toUserId) {
    throw new SocialServiceError(400, 'Cannot invite yourself');
  }

  await ensureAcceptedFriendship(fromUserId, toUserId);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + (options.expiresInMs ?? 15 * 60 * 1000));
  const existing = await prisma.lobbyInvite.findFirst({
    where: {
      fromUserId,
      toUserId,
      lobbyId,
      status: 'pending',
      expiresAt: { gt: now },
    },
    include: lobbyInviteInclude,
    orderBy: { createdAt: 'desc' },
  });

  const invite = existing
    ? await prisma.lobbyInvite.update({
      where: { id: existing.id },
      data: {
        lobbyName: lobbyName || 'Game Lobby',
        matchMode: options.matchMode ?? null,
        expiresAt,
      },
      include: lobbyInviteInclude,
    })
    : await prisma.lobbyInvite.create({
      data: {
        fromUserId,
        toUserId,
        lobbyId,
        lobbyName: lobbyName || 'Game Lobby',
        matchMode: options.matchMode ?? null,
        expiresAt,
      },
      include: lobbyInviteInclude,
    });

  return serializeLobbyInvite(invite);
}

export async function createPartyInvite(options: {
  fromUserId: string;
  toUserId: string;
  partyId: string;
  expiresInMs?: number;
}): Promise<PartyInvitePayload> {
  const fromUserId = options.fromUserId.trim();
  const toUserId = options.toUserId.trim();
  const partyId = options.partyId.trim();

  if (!fromUserId || !toUserId || !partyId) {
    throw new SocialServiceError(400, 'Missing invite target or party');
  }

  if (fromUserId === toUserId) {
    throw new SocialServiceError(400, 'Cannot invite yourself');
  }

  await ensureAcceptedFriendship(fromUserId, toUserId);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + (options.expiresInMs ?? 15 * 60 * 1000));
  const existing = await prisma.partyInvite.findFirst({
    where: {
      fromUserId,
      toUserId,
      partyId,
      status: 'pending',
      expiresAt: { gt: now },
    },
    include: partyInviteInclude,
    orderBy: { createdAt: 'desc' },
  });

  const invite = existing
    ? await prisma.partyInvite.update({
      where: { id: existing.id },
      data: { expiresAt },
      include: partyInviteInclude,
    })
    : await prisma.partyInvite.create({
      data: {
        fromUserId,
        toUserId,
        partyId,
        expiresAt,
      },
      include: partyInviteInclude,
    });

  return serializePartyInvite(invite);
}
