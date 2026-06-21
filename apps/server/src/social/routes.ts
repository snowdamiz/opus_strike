import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { matchMaker } from 'colyseus';
import { Prisma, type MatchMode } from '@prisma/client';
import prisma from '../db';
import { assertGameplayAccountEligible } from '../auth/accountEligibility';
import { enforceJsonRateLimit, getRequestAuthToken } from '../auth/http';
import { verifyAuthToken, type AuthTokenPayload } from '../auth/session';
import {
  canUserAccessPersistentPartyRoom,
  findActivePersistentPartyForUser,
} from '../party/persistentParty';
import { socialEventBus, type SocialChangeReason } from './eventBus';
import {
  SocialServiceError,
  createLobbyInvite,
  createPartyInvite,
  expireOldLobbyInvites,
  expireOldPartyInvites,
  friendshipInclude,
  getFriendshipPair,
  getRelationshipsForCandidates,
  loadSocialStateForUser,
  lobbyInviteInclude,
  partyInviteInclude,
  serializeLobbyInvite,
  serializePartyInvite,
  serializeFriendship,
  serializeFriendshipRequest,
  serializeSocialUser,
  socialUserSelect,
} from './service';

const router: RouterType = Router();

const SOCIAL_RATE_LIMITS = {
  read: { limit: 90, windowMs: 60 * 1000 },
  search: { limit: 45, windowMs: 60 * 1000 },
  mutate: { limit: 30, windowMs: 60 * 1000 },
  invite: { limit: 20, windowMs: 60 * 1000 },
} as const;

async function getAuthenticatedPayload(req: Request): Promise<AuthTokenPayload | null> {
  const token = getRequestAuthToken(req);
  if (!token) return null;
  return verifyAuthToken(token);
}

async function requireCurrentUser(req: Request, res: Response): Promise<{
  id: string;
  walletAddress: string | null;
  name: string;
} | null>;
async function requireCurrentUser(req: Request, res: Response, options: {
  requireGameplayEligible?: boolean;
}): Promise<{
  id: string;
  walletAddress: string | null;
  name: string;
} | null>;
async function requireCurrentUser(req: Request, res: Response, options: {
  requireGameplayEligible?: boolean;
} = {}): Promise<{
  id: string;
  walletAddress: string | null;
  name: string;
} | null> {
  const payload = await getAuthenticatedPayload(req);
  if (!payload) {
    res.status(401).json({ error: 'Sign in to use social features' });
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      walletAddress: true,
      name: true,
    },
  });

  if (!user || (payload.walletAddress && user.walletAddress !== payload.walletAddress)) {
    res.status(401).json({ error: 'Session expired' });
    return null;
  }

  if (options.requireGameplayEligible) {
    await assertGameplayAccountEligible(user.id);
  }

  return user;
}

function cleanShortText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
  return text || null;
}

function parseMatchMode(value: unknown): MatchMode | null {
  return value === 'quick_play' || value === 'ranked' || value === 'custom'
    ? value
    : null;
}

async function canInviteFromParty(partyId: string, userId: string): Promise<boolean> {
  const rooms = await matchMaker.query({ name: 'party_room' });
  const room = (rooms as any[]).find((candidate) => candidate.roomId === partyId);
  if (room) {
    const memberUserIds = room.metadata?.memberUserIds;
    if (Array.isArray(memberUserIds) && memberUserIds.includes(userId)) return true;
  }
  return canUserAccessPersistentPartyRoom(partyId, userId);
}

function sendSocialError(res: Response, error: unknown): void {
  const statusCode = typeof error === 'object' && error && 'statusCode' in error
    ? Number((error as { statusCode?: unknown }).statusCode) || 500
    : null;
  if (statusCode && statusCode >= 400 && statusCode < 600) {
    res.status(statusCode).json({ error: error instanceof Error ? error.message : 'Request failed' });
    return;
  }

  if (error instanceof SocialServiceError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  console.error('[social] request failed:', error);
  res.status(500).json({ error: 'Internal server error' });
}

function notifySocialUsers(userIds: readonly string[], reason: SocialChangeReason): void {
  socialEventBus.publishSocialChanged(userIds, reason).catch((error) => {
    console.error('[social] realtime publish failed:', error);
  });
}

router.get('/party-session', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'social:read', SOCIAL_RATE_LIMITS.read)) return;

  try {
    const user = await requireCurrentUser(req, res, { requireGameplayEligible: true });
    if (!user) return;

    const party = await findActivePersistentPartyForUser(user.id);
    res.json({
      party: party
        ? {
            partyId: party.roomId,
            persistentPartyId: party.id,
            updatedAt: party.updatedAt.toISOString(),
          }
        : null,
    });
  } catch (error) {
    sendSocialError(res, error);
  }
});

router.get('/', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'social:read', SOCIAL_RATE_LIMITS.read)) return;

  try {
    const user = await requireCurrentUser(req, res);
    if (!user) return;

    res.json(await loadSocialStateForUser(user.id));
  } catch (error) {
    sendSocialError(res, error);
  }
});

router.get('/search', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'social:search', SOCIAL_RATE_LIMITS.search)) return;

  try {
    const user = await requireCurrentUser(req, res);
    if (!user) return;

    const query = cleanShortText(req.query.query, 24);
    if (!query || query.length < 2) {
      res.json({ users: [] });
      return;
    }

    const users = await prisma.user.findMany({
      where: {
        id: { not: user.id },
        name: {
          contains: query,
          mode: 'insensitive',
        },
      },
      select: socialUserSelect,
      orderBy: [
        { rankedGames: 'desc' },
        { totalScore: 'desc' },
        { createdAt: 'asc' },
      ],
      take: 8,
    });

    const relationshipByUserId = await getRelationshipsForCandidates(
      user.id,
      users.map((candidate) => candidate.id)
    );

    res.json({
      users: users.map((candidate) => ({
        user: serializeSocialUser(candidate),
        relationship: relationshipByUserId.get(candidate.id) ?? 'none',
      })),
    });
  } catch (error) {
    sendSocialError(res, error);
  }
});

router.post('/friend-requests', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'social:mutate', SOCIAL_RATE_LIMITS.mutate)) return;

  try {
    const user = await requireCurrentUser(req, res, { requireGameplayEligible: true });
    if (!user) return;

    const targetUserId = cleanShortText(req.body?.targetUserId, 96);
    const targetName = cleanShortText(req.body?.targetName, 24);
    if (!targetUserId && !targetName) {
      res.status(400).json({ error: 'Enter a player name' });
      return;
    }

    const target = await prisma.user.findFirst({
      where: targetUserId
        ? { id: targetUserId }
        : { name: { equals: targetName!, mode: 'insensitive' } },
      select: socialUserSelect,
    });

    if (!target) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    if (target.id === user.id) {
      res.status(400).json({ error: 'Cannot add yourself' });
      return;
    }

    const pair = getFriendshipPair(user.id, target.id);
    const now = new Date();
    const request = await prisma.$transaction(async (tx) => {
      const existing = await tx.friendship.findUnique({
        where: { userAId_userBId: pair },
        include: friendshipInclude,
      });

      if (existing?.status === 'accepted') {
        throw new SocialServiceError(409, 'You are already friends');
      }

      if (existing?.status === 'pending') {
        throw new SocialServiceError(
          409,
          existing.requestedByUserId === user.id
            ? 'Friend request already sent'
            : 'That player already sent you a friend request'
        );
      }

      if (existing) {
        return tx.friendship.update({
          where: { id: existing.id },
          data: {
            requestedByUserId: user.id,
            status: 'pending',
            respondedAt: null,
          },
          include: friendshipInclude,
        });
      }

      return tx.friendship.create({
        data: {
          ...pair,
          requestedByUserId: user.id,
          status: 'pending',
          createdAt: now,
        },
        include: friendshipInclude,
      });
    });

    notifySocialUsers([user.id, target.id], 'friend_request_created');
    res.status(201).json({ request: serializeFriendshipRequest(request, user.id) });
  } catch (error) {
    sendSocialError(res, error);
  }
});

router.post('/friend-requests/:requestId/accept', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'social:mutate', SOCIAL_RATE_LIMITS.mutate)) return;

  try {
    const user = await requireCurrentUser(req, res, { requireGameplayEligible: true });
    if (!user) return;

    const requestId = cleanShortText(req.params.requestId, 96);
    if (!requestId) {
      res.status(400).json({ error: 'Friend request is required' });
      return;
    }

    const existing = await prisma.friendship.findUnique({
      where: { id: requestId },
      include: friendshipInclude,
    });

    if (!existing || (existing.userAId !== user.id && existing.userBId !== user.id)) {
      res.status(404).json({ error: 'Friend request not found' });
      return;
    }

    if (existing.status !== 'pending' || existing.requestedByUserId === user.id) {
      res.status(400).json({ error: 'This request cannot be accepted' });
      return;
    }

    const friendship = await prisma.friendship.update({
      where: { id: existing.id },
      data: {
        status: 'accepted',
        respondedAt: new Date(),
      },
      include: friendshipInclude,
    });

    notifySocialUsers([friendship.userAId, friendship.userBId], 'friend_request_accepted');
    res.json({ friend: serializeFriendship(friendship, user.id) });
  } catch (error) {
    sendSocialError(res, error);
  }
});

router.post('/friend-requests/:requestId/decline', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'social:mutate', SOCIAL_RATE_LIMITS.mutate)) return;

  try {
    const user = await requireCurrentUser(req, res, { requireGameplayEligible: true });
    if (!user) return;

    const requestId = cleanShortText(req.params.requestId, 96);
    if (!requestId) {
      res.status(400).json({ error: 'Friend request is required' });
      return;
    }

    const existing = await prisma.friendship.findUnique({
      where: { id: requestId },
      include: friendshipInclude,
    });

    if (!existing || (existing.userAId !== user.id && existing.userBId !== user.id)) {
      res.status(404).json({ error: 'Friend request not found' });
      return;
    }

    if (existing.status !== 'pending' || existing.requestedByUserId === user.id) {
      res.status(400).json({ error: 'This request cannot be declined' });
      return;
    }

    const request = await prisma.friendship.update({
      where: { id: existing.id },
      data: {
        status: 'declined',
        respondedAt: new Date(),
      },
      include: friendshipInclude,
    });

    notifySocialUsers([request.userAId, request.userBId], 'friend_request_declined');
    res.json({ request: serializeFriendshipRequest(request, user.id) });
  } catch (error) {
    sendSocialError(res, error);
  }
});

router.post('/friend-requests/:requestId/cancel', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'social:mutate', SOCIAL_RATE_LIMITS.mutate)) return;

  try {
    const user = await requireCurrentUser(req, res, { requireGameplayEligible: true });
    if (!user) return;

    const requestId = cleanShortText(req.params.requestId, 96);
    if (!requestId) {
      res.status(400).json({ error: 'Friend request is required' });
      return;
    }

    const existing = await prisma.friendship.findUnique({
      where: { id: requestId },
      include: friendshipInclude,
    });

    if (!existing || existing.requestedByUserId !== user.id || existing.status !== 'pending') {
      res.status(404).json({ error: 'Outgoing request not found' });
      return;
    }

    const request = await prisma.friendship.update({
      where: { id: existing.id },
      data: {
        status: 'canceled',
        respondedAt: new Date(),
      },
      include: friendshipInclude,
    });

    notifySocialUsers([request.userAId, request.userBId], 'friend_request_canceled');
    res.json({ request: serializeFriendshipRequest(request, user.id) });
  } catch (error) {
    sendSocialError(res, error);
  }
});

router.delete('/friends/:friendUserId', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'social:mutate', SOCIAL_RATE_LIMITS.mutate)) return;

  try {
    const user = await requireCurrentUser(req, res, { requireGameplayEligible: true });
    if (!user) return;

    const friendUserId = cleanShortText(req.params.friendUserId, 96);
    if (!friendUserId || friendUserId === user.id) {
      res.status(400).json({ error: 'Friend is required' });
      return;
    }

    const pair = getFriendshipPair(user.id, friendUserId);
    const existing = await prisma.friendship.findUnique({
      where: { userAId_userBId: pair },
      select: { id: true, status: true },
    });

    if (existing?.status !== 'accepted') {
      res.status(404).json({ error: 'Friend not found' });
      return;
    }

    await prisma.friendship.update({
      where: { id: existing.id },
      data: {
        status: 'canceled',
        requestedByUserId: user.id,
        respondedAt: new Date(),
      },
    });

    notifySocialUsers([user.id, friendUserId], 'friend_removed');
    res.json({ success: true });
  } catch (error) {
    sendSocialError(res, error);
  }
});

router.post('/party-invites', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'social:invite', SOCIAL_RATE_LIMITS.invite)) return;

  try {
    const user = await requireCurrentUser(req, res, { requireGameplayEligible: true });
    if (!user) return;

    const toUserId = cleanShortText(req.body?.toUserId, 96);
    const partyId = cleanShortText(req.body?.partyId, 96);

    if (!toUserId || !partyId) {
      res.status(400).json({ error: 'Friend and party are required' });
      return;
    }

    if (!(await canInviteFromParty(partyId, user.id))) {
      res.status(403).json({ error: 'Join the party before inviting friends' });
      return;
    }

    const invite = await createPartyInvite({
      fromUserId: user.id,
      toUserId,
      partyId,
    });

    notifySocialUsers([invite.from.userId, invite.to.userId], 'party_invite_created');
    res.status(201).json({ invite });
  } catch (error) {
    sendSocialError(res, error);
  }
});

router.post('/party-invites/:inviteId/accept', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'social:invite', SOCIAL_RATE_LIMITS.invite)) return;

  try {
    const user = await requireCurrentUser(req, res, { requireGameplayEligible: true });
    if (!user) return;

    await expireOldPartyInvites();

    const inviteId = cleanShortText(req.params.inviteId, 96);
    if (!inviteId) {
      res.status(400).json({ error: 'Invite is required' });
      return;
    }

    const existing = await prisma.partyInvite.findUnique({
      where: { id: inviteId },
      include: partyInviteInclude,
    });

    if (!existing || existing.toUserId !== user.id || existing.status !== 'pending') {
      res.status(404).json({ error: 'Party invite not found' });
      return;
    }

    if (existing.expiresAt <= new Date()) {
      res.status(410).json({ error: 'Party invite expired' });
      return;
    }

    const invite = await prisma.partyInvite.update({
      where: { id: existing.id },
      data: {
        status: 'accepted',
        respondedAt: new Date(),
      },
      include: partyInviteInclude,
    });

    notifySocialUsers([invite.fromUserId, invite.toUserId], 'party_invite_accepted');
    res.json({ invite: serializePartyInvite(invite) });
  } catch (error) {
    sendSocialError(res, error);
  }
});

router.post('/party-invites/:inviteId/decline', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'social:invite', SOCIAL_RATE_LIMITS.invite)) return;

  try {
    const user = await requireCurrentUser(req, res, { requireGameplayEligible: true });
    if (!user) return;

    const inviteId = cleanShortText(req.params.inviteId, 96);
    if (!inviteId) {
      res.status(400).json({ error: 'Invite is required' });
      return;
    }

    const existing = await prisma.partyInvite.findUnique({
      where: { id: inviteId },
      include: partyInviteInclude,
    });

    if (!existing || existing.toUserId !== user.id || existing.status !== 'pending') {
      res.status(404).json({ error: 'Party invite not found' });
      return;
    }

    const invite = await prisma.partyInvite.update({
      where: { id: existing.id },
      data: {
        status: 'declined',
        respondedAt: new Date(),
      },
      include: partyInviteInclude,
    });

    notifySocialUsers([invite.fromUserId, invite.toUserId], 'party_invite_declined');
    res.json({ invite: serializePartyInvite(invite) });
  } catch (error) {
    sendSocialError(res, error);
  }
});

router.post('/party-invites/:inviteId/cancel', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'social:invite', SOCIAL_RATE_LIMITS.invite)) return;

  try {
    const user = await requireCurrentUser(req, res, { requireGameplayEligible: true });
    if (!user) return;

    const inviteId = cleanShortText(req.params.inviteId, 96);
    if (!inviteId) {
      res.status(400).json({ error: 'Invite is required' });
      return;
    }

    const existing = await prisma.partyInvite.findUnique({
      where: { id: inviteId },
      include: partyInviteInclude,
    });

    if (!existing || existing.fromUserId !== user.id || existing.status !== 'pending') {
      res.status(404).json({ error: 'Party invite not found' });
      return;
    }

    const invite = await prisma.partyInvite.update({
      where: { id: existing.id },
      data: {
        status: 'canceled',
        respondedAt: new Date(),
      },
      include: partyInviteInclude,
    });

    notifySocialUsers([invite.fromUserId, invite.toUserId], 'party_invite_canceled');
    res.json({ invite: serializePartyInvite(invite) });
  } catch (error) {
    sendSocialError(res, error);
  }
});

router.post('/lobby-invites', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'social:invite', SOCIAL_RATE_LIMITS.invite)) return;

  try {
    const user = await requireCurrentUser(req, res, { requireGameplayEligible: true });
    if (!user) return;

    const toUserId = cleanShortText(req.body?.toUserId, 96);
    const lobbyId = cleanShortText(req.body?.lobbyId, 96);
    const lobbyName = cleanShortText(req.body?.lobbyName, 32) ?? 'Game Lobby';
    const matchMode = parseMatchMode(req.body?.matchMode);

    if (!toUserId || !lobbyId) {
      res.status(400).json({ error: 'Friend and lobby are required' });
      return;
    }

    const invite = await createLobbyInvite({
      fromUserId: user.id,
      toUserId,
      lobbyId,
      lobbyName,
      matchMode,
    });

    notifySocialUsers([invite.from.userId, invite.to.userId], 'lobby_invite_created');
    res.status(201).json({ invite });
  } catch (error) {
    sendSocialError(res, error);
  }
});

router.post('/lobby-invites/:inviteId/accept', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'social:invite', SOCIAL_RATE_LIMITS.invite)) return;

  try {
    const user = await requireCurrentUser(req, res, { requireGameplayEligible: true });
    if (!user) return;

    await expireOldLobbyInvites();

    const inviteId = cleanShortText(req.params.inviteId, 96);
    if (!inviteId) {
      res.status(400).json({ error: 'Invite is required' });
      return;
    }

    const existing = await prisma.lobbyInvite.findUnique({
      where: { id: inviteId },
      include: lobbyInviteInclude,
    });

    if (!existing || existing.toUserId !== user.id || existing.status !== 'pending') {
      res.status(404).json({ error: 'Lobby invite not found' });
      return;
    }

    if (existing.expiresAt <= new Date()) {
      res.status(410).json({ error: 'Lobby invite expired' });
      return;
    }

    const invite = await prisma.lobbyInvite.update({
      where: { id: existing.id },
      data: {
        status: 'accepted',
        respondedAt: new Date(),
      },
      include: lobbyInviteInclude,
    });

    notifySocialUsers([invite.fromUserId, invite.toUserId], 'lobby_invite_accepted');
    res.json({ invite: serializeLobbyInvite(invite) });
  } catch (error) {
    sendSocialError(res, error);
  }
});

router.post('/lobby-invites/:inviteId/decline', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'social:invite', SOCIAL_RATE_LIMITS.invite)) return;

  try {
    const user = await requireCurrentUser(req, res, { requireGameplayEligible: true });
    if (!user) return;

    const inviteId = cleanShortText(req.params.inviteId, 96);
    if (!inviteId) {
      res.status(400).json({ error: 'Invite is required' });
      return;
    }

    const existing = await prisma.lobbyInvite.findUnique({
      where: { id: inviteId },
      include: lobbyInviteInclude,
    });

    if (!existing || existing.toUserId !== user.id || existing.status !== 'pending') {
      res.status(404).json({ error: 'Lobby invite not found' });
      return;
    }

    const invite = await prisma.lobbyInvite.update({
      where: { id: existing.id },
      data: {
        status: 'declined',
        respondedAt: new Date(),
      },
      include: lobbyInviteInclude,
    });

    notifySocialUsers([invite.fromUserId, invite.toUserId], 'lobby_invite_declined');
    res.json({ invite: serializeLobbyInvite(invite) });
  } catch (error) {
    sendSocialError(res, error);
  }
});

router.post('/lobby-invites/:inviteId/cancel', async (req: Request, res: Response) => {
  if (!enforceJsonRateLimit(req, res, 'social:invite', SOCIAL_RATE_LIMITS.invite)) return;

  try {
    const user = await requireCurrentUser(req, res, { requireGameplayEligible: true });
    if (!user) return;

    const inviteId = cleanShortText(req.params.inviteId, 96);
    if (!inviteId) {
      res.status(400).json({ error: 'Invite is required' });
      return;
    }

    const existing = await prisma.lobbyInvite.findUnique({
      where: { id: inviteId },
      include: lobbyInviteInclude,
    });

    if (!existing || existing.fromUserId !== user.id || existing.status !== 'pending') {
      res.status(404).json({ error: 'Lobby invite not found' });
      return;
    }

    const invite = await prisma.lobbyInvite.update({
      where: { id: existing.id },
      data: {
        status: 'canceled',
        respondedAt: new Date(),
      },
      include: lobbyInviteInclude,
    });

    notifySocialUsers([invite.fromUserId, invite.toUserId], 'lobby_invite_canceled');
    res.json({ invite: serializeLobbyInvite(invite) });
  } catch (error) {
    sendSocialError(res, error);
  }
});

export default router;
