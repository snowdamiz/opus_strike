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

export const friendshipInclude = {
  userA: { select: socialUserSelect },
  userB: { select: socialUserSelect },
  requestedBy: { select: socialUserSelect },
} satisfies Prisma.FriendshipInclude;

export type SocialUserRecord = Prisma.UserGetPayload<{ select: typeof socialUserSelect }>;
export type LobbyInviteWithUsers = Prisma.LobbyInviteGetPayload<{ include: typeof lobbyInviteInclude }>;
export type PartyInviteWithUsers = Prisma.PartyInviteGetPayload<{ include: typeof partyInviteInclude }>;
export type FriendshipWithUsers = Prisma.FriendshipGetPayload<{ include: typeof friendshipInclude }>;
export type RelationshipState = 'none' | 'friend' | 'pending_incoming' | 'pending_outgoing';

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

export interface FriendRequestPayload {
  requestId: string;
  status: string;
  direction: 'incoming' | 'outgoing';
  requestedAt: string;
  respondedAt: string | null;
  user: ReturnType<typeof serializeSocialUser>;
}

export interface SocialFriendPayload {
  friendshipId: string;
  friendedAt: string;
  user: ReturnType<typeof serializeSocialUser>;
}

export interface SearchResultPayload {
  user: ReturnType<typeof serializeSocialUser>;
  relationship: RelationshipState;
}

export interface SocialStatePayload {
  friends: SocialFriendPayload[];
  incomingRequests: FriendRequestPayload[];
  outgoingRequests: FriendRequestPayload[];
  lobbyInvites: LobbyInvitePayload[];
  partyInvites: PartyInvitePayload[];
  discordPlayers: SearchResultPayload[];
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

export function otherFriendshipUser(friendship: FriendshipWithUsers, currentUserId: string): SocialUserRecord {
  return friendship.userAId === currentUserId ? friendship.userB : friendship.userA;
}

export function serializeFriendshipRequest(
  friendship: FriendshipWithUsers,
  currentUserId: string
): FriendRequestPayload {
  const requestedByCurrentUser = friendship.requestedByUserId === currentUserId;

  return {
    requestId: friendship.id,
    status: friendship.status,
    direction: requestedByCurrentUser ? 'outgoing' : 'incoming',
    requestedAt: friendship.createdAt.toISOString(),
    respondedAt: friendship.respondedAt?.toISOString() ?? null,
    user: serializeSocialUser(otherFriendshipUser(friendship, currentUserId)),
  };
}

export function serializeFriendship(
  friendship: FriendshipWithUsers,
  currentUserId: string
): SocialFriendPayload {
  return {
    friendshipId: friendship.id,
    friendedAt: friendship.respondedAt?.toISOString() ?? friendship.updatedAt.toISOString(),
    user: serializeSocialUser(otherFriendshipUser(friendship, currentUserId)),
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

const SOCIAL_INVITE_EXPIRY_SWEEP_INTERVAL_MS = 5_000;
let lastSocialInviteExpirySweepAtMs = 0;
let socialInviteExpirySweep: Promise<void> | null = null;

async function expireOldSocialInvitesIfDue(now = new Date()): Promise<void> {
  if (socialInviteExpirySweep) return socialInviteExpirySweep;
  const nowMs = now.getTime();
  if (nowMs - lastSocialInviteExpirySweepAtMs < SOCIAL_INVITE_EXPIRY_SWEEP_INTERVAL_MS) return;

  lastSocialInviteExpirySweepAtMs = nowMs;
  socialInviteExpirySweep = Promise.all([
    expireOldLobbyInvites(now),
    expireOldPartyInvites(now),
  ]).then(() => undefined);

  try {
    await socialInviteExpirySweep;
  } finally {
    socialInviteExpirySweep = null;
  }
}

export async function getRelationshipsForCandidates(
  currentUserId: string,
  candidateUserIds: string[]
): Promise<Map<string, RelationshipState>> {
  if (candidateUserIds.length === 0) return new Map();

  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [
        { userAId: currentUserId, userBId: { in: candidateUserIds } },
        { userBId: currentUserId, userAId: { in: candidateUserIds } },
      ],
    },
    select: {
      userAId: true,
      userBId: true,
      requestedByUserId: true,
      status: true,
    },
  });

  const relationshipByUserId = new Map<string, RelationshipState>();
  for (const friendship of friendships) {
    const otherUserId = friendship.userAId === currentUserId ? friendship.userBId : friendship.userAId;
    if (friendship.status === 'accepted') {
      relationshipByUserId.set(otherUserId, 'friend');
    } else if (friendship.status === 'pending' && friendship.requestedByUserId === currentUserId) {
      relationshipByUserId.set(otherUserId, 'pending_outgoing');
    } else if (friendship.status === 'pending') {
      relationshipByUserId.set(otherUserId, 'pending_incoming');
    } else {
      relationshipByUserId.set(otherUserId, 'none');
    }
  }

  return relationshipByUserId;
}

export async function loadSocialStateForUser(userId: string): Promise<SocialStatePayload> {
  const now = new Date();
  await expireOldSocialInvitesIfDue(now);
  const [friendships, incomingRequests, outgoingRequests, lobbyInvites, partyInvites, discordPlayers] = await Promise.all([
    prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      include: friendshipInclude,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.friendship.findMany({
      where: {
        status: 'pending',
        requestedByUserId: { not: userId },
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      include: friendshipInclude,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.friendship.findMany({
      where: {
        status: 'pending',
        requestedByUserId: userId,
      },
      include: friendshipInclude,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.lobbyInvite.findMany({
      where: {
        toUserId: userId,
        status: 'pending',
        expiresAt: { gt: now },
      },
      include: lobbyInviteInclude,
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.partyInvite.findMany({
      where: {
        toUserId: userId,
        status: 'pending',
        expiresAt: { gt: now },
      },
      include: partyInviteInclude,
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.user.findMany({
      where: {
        id: { not: userId },
        authAccounts: {
          some: { provider: 'discord' },
        },
      },
      select: socialUserSelect,
      orderBy: [
        { lastLoginAt: 'desc' },
        { rankedGames: 'desc' },
        { totalScore: 'desc' },
      ],
      take: 12,
    }),
  ]);

  const discordRelationships = await getRelationshipsForCandidates(
    userId,
    discordPlayers.map((candidate) => candidate.id)
  );

  return {
    friends: friendships.map((friendship) => serializeFriendship(friendship, userId)),
    incomingRequests: incomingRequests.map((request) => serializeFriendshipRequest(request, userId)),
    outgoingRequests: outgoingRequests.map((request) => serializeFriendshipRequest(request, userId)),
    lobbyInvites: lobbyInvites.map(serializeLobbyInvite),
    partyInvites: partyInvites.map(serializePartyInvite),
    discordPlayers: discordPlayers
      .map((candidate) => ({
        user: serializeSocialUser(candidate),
        relationship: discordRelationships.get(candidate.id) ?? 'none',
      }))
      .filter((candidate) => candidate.relationship !== 'friend'),
  };
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
