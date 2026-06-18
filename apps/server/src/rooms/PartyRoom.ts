import type { IncomingMessage } from 'http';
import { Room, Client } from 'colyseus';
import {
  DEFAULT_GAME_CONFIG,
  type GameplayMode,
  type HeroId,
  type PartyMode,
} from '@voxel-strike/shared';
import { resolveRoomAuthContext, type RoomAuthContext } from '../auth/session';
import { assertGameplayAccountEligible } from '../auth/accountEligibility';
import prisma from '../db';
import { MessageRateLimiter, type RateLimitRule } from './rateLimiter';
import { isHeroId, isRecord } from './protocolValidation';
import { PartyRosterRuntime } from '../party/partyRuntime';
import {
  launchPartyToCustomLobby,
  launchPartyToMatchmaking,
} from '../party/partyLaunch';

interface PartyJoinOptions {
  heroId?: HeroId;
  authToken?: string;
  devTutorialBypass?: boolean;
}

const PARTY_MESSAGE_RATE_LIMITS = {
  hero: { limit: 8, intervalMs: 5000 },
  ready: { limit: 10, intervalMs: 5000 },
  mode: { limit: 8, intervalMs: 5000 },
  start: { limit: 4, intervalMs: 8000 },
} satisfies Record<string, RateLimitRule>;

function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 0) return false;
  if (value === 1) return true;
  return null;
}

function validateReadyPayload(value: unknown): boolean | null {
  return isRecord(value) ? booleanValue(value.ready) : null;
}

function validateModePayload(value: unknown): {
  mode: PartyMode;
  gameplayMode?: GameplayMode;
} | null {
  if (!isRecord(value)) return null;
  const mode = value.mode;
  if (mode !== 'quick_play' && mode !== 'ranked' && mode !== 'custom' && mode !== 'practice') return null;
  const gameplayMode = value.gameplayMode;
  if (
    gameplayMode !== undefined &&
    gameplayMode !== 'capture_the_flag' &&
    gameplayMode !== 'team_deathmatch'
  ) {
    return null;
  }
  return {
    mode,
    gameplayMode,
  };
}

function isDevTutorialBypassEnabled(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

export class PartyRoom extends Room {
  maxClients = DEFAULT_GAME_CONFIG.teamSize;
  override get autoDispose(): boolean {
    return true;
  }

  private party!: PartyRosterRuntime;
  private readonly rateLimiter = new MessageRateLimiter();
  private readonly authBySessionId = new Map<string, RoomAuthContext>();

  async onAuth(client: Client, options: PartyJoinOptions, request?: IncomingMessage): Promise<RoomAuthContext> {
    const authContext = await resolveRoomAuthContext(options as Record<string, unknown>, request);
    await assertGameplayAccountEligible(authContext.userId);
    return authContext;
  }

  onCreate() {
    this.party = new PartyRosterRuntime(this.roomId, DEFAULT_GAME_CONFIG.teamSize);

    this.onMessage('setHero', (client, data: unknown) => {
      if (!this.consumePartyMessage(client, 'setHero', PARTY_MESSAGE_RATE_LIMITS.hero)) return;
      if (!isRecord(data) || !isHeroId(data.heroId)) return;
      this.handleSetHero(client, data.heroId);
    });

    this.onMessage('setReady', (client, data: unknown) => {
      if (!this.consumePartyMessage(client, 'setReady', PARTY_MESSAGE_RATE_LIMITS.ready)) return;
      const ready = validateReadyPayload(data);
      if (ready === null) return;
      this.handleSetReady(client, ready);
    });

    this.onMessage('setMode', (client, data: unknown) => {
      if (!this.consumePartyMessage(client, 'setMode', PARTY_MESSAGE_RATE_LIMITS.mode)) return;
      const payload = validateModePayload(data);
      if (!payload) return;
      this.handleSetMode(client, payload.mode, payload.gameplayMode);
    });

    this.onMessage('start', (client) => {
      if (!this.consumePartyMessage(client, 'start', PARTY_MESSAGE_RATE_LIMITS.start)) return;
      this.handleStart(client).catch((error) => {
        this.sendLaunchError(client, error instanceof Error ? error.message : 'Failed to start party');
      });
    });

    this.onMessage('leave', (client) => {
      client.leave();
    });
  }

  async onJoin(client: Client, options: PartyJoinOptions) {
    const authContext = (client as Client & { auth?: RoomAuthContext }).auth;
    if (!authContext) {
      client.send('error', { message: 'Authentication required' });
      client.leave();
      return;
    }

    const canJoin = await this.canJoinParty(authContext);
    if (!canJoin) {
      client.send('error', { message: 'Party invite required' });
      client.leave();
      return;
    }

    this.authBySessionId.set(client.sessionId, authContext);
    const change = this.party.addMember({
      userId: authContext.userId,
      sessionId: client.sessionId,
      displayName: authContext.displayName,
      heroId: isHeroId(options.heroId) ? options.heroId : 'blaze',
      rank: authContext.rank,
      competitiveRating: authContext.competitiveRating,
      rankDivisionIndex: authContext.rankDivisionIndex,
      walletAddress: authContext.walletAddress ?? null,
      tutorialCompletedAt: authContext.tutorialCompletedAt,
      rankedPlacementsRemaining: authContext.rankedPlacementsRemaining,
      devTutorialBypass: isDevTutorialBypassEnabled(options.devTutorialBypass),
    });

    if (change.replacedSessionId) {
      const oldClient = this.clients.find((candidate) => candidate.sessionId === change.replacedSessionId);
      oldClient?.send('duplicateSession', { reason: 'Connected from another tab/window' });
      oldClient?.leave(4000);
    }

    this.broadcast('partyMemberJoined', {
      userId: authContext.userId,
      displayName: authContext.displayName,
    });
    if (change.leaderChanged) {
      this.broadcast('partyLeaderChanged', { leaderUserId: this.party.leaderId });
    }
    this.broadcastPartyState();
  }

  onLeave(client: Client) {
    this.rateLimiter.clearScope(client.sessionId);
    this.authBySessionId.delete(client.sessionId);
    const change = this.party.removeSession(client.sessionId);
    if (!change) return;

    this.broadcast('partyMemberLeft', {
      userId: change.member.userId,
      displayName: change.member.displayName,
    });
    if (change.leaderChanged) {
      this.broadcast('partyLeaderChanged', { leaderUserId: this.party.leaderId });
    }
    this.broadcastPartyState();
  }

  private async canJoinParty(authContext: RoomAuthContext): Promise<boolean> {
    if (this.party.size === 0 || this.party.getMember(authContext.userId)) return true;

    const invite = await prisma.partyInvite.findFirst({
      where: {
        partyId: this.roomId,
        toUserId: authContext.userId,
        status: 'accepted',
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    return Boolean(invite);
  }

  private consumePartyMessage(client: Client, messageType: string, rule: RateLimitRule): boolean {
    if (this.rateLimiter.consume(client.sessionId, messageType, rule)) return true;
    client.send('error', { message: 'Too many party actions. Wait a moment and try again.' });
    return false;
  }

  private memberForClient(client: Client) {
    const member = this.party.getMemberBySession(client.sessionId);
    if (!member) {
      client.send('error', { message: 'Party member not found' });
    }
    return member;
  }

  private handleSetHero(client: Client, heroId: HeroId): void {
    const member = this.memberForClient(client);
    if (!member) return;
    const updated = this.party.updateHero(member.userId, heroId);
    if (!updated) return;
    this.broadcast('partyMemberUpdated', {
      userId: updated.userId,
      heroId: updated.heroId,
      ready: updated.ready,
    });
    this.broadcastPartyState();
  }

  private handleSetReady(client: Client, ready: boolean): void {
    const member = this.memberForClient(client);
    if (!member) return;
    const updated = this.party.setReady(member.userId, ready);
    if (!updated) return;
    this.broadcast('partyMemberUpdated', {
      userId: updated.userId,
      ready: updated.ready,
    });
    this.broadcastPartyState();
  }

  private handleSetMode(client: Client, mode: PartyMode, gameplayMode?: GameplayMode): void {
    const member = this.memberForClient(client);
    if (!member) return;
    try {
      this.party.setMode(member.userId, mode, gameplayMode);
      this.broadcastPartyState();
    } catch (error) {
      client.send('error', { message: error instanceof Error ? error.message : 'Failed to set party mode' });
    }
  }

  private async handleStart(client: Client): Promise<void> {
    const member = this.memberForClient(client);
    if (!member) return;
    if (member.userId !== this.party.leaderId) {
      this.sendLaunchError(client, 'Only the party leader can start');
      return;
    }

    const validation = this.party.validateStart();
    if (!validation.ok) {
      this.sendLaunchError(client, validation.message);
      return;
    }

    const result = this.party.mode === 'quick_play' || this.party.mode === 'ranked'
      ? await launchPartyToMatchmaking(this.party, this.party.mode)
      : await launchPartyToCustomLobby(this.party);

    for (const partyMember of this.party.getMembers()) {
      const payload = result.payloadsByUserId.get(partyMember.userId);
      if (!payload) continue;
      const target = this.clients.find((candidate) => candidate.sessionId === partyMember.sessionId);
      target?.send('partyLaunch', payload);
    }
  }

  private sendLaunchError(client: Client, message: string): void {
    this.party.setLaunchError(message);
    client.send('error', { message });
    this.broadcastPartyState();
  }

  private broadcastPartyState(): void {
    this.updateMetadata();
    this.broadcast('partyState', this.party.snapshot());
  }

  private updateMetadata(): void {
    this.setMetadata({
      leaderUserId: this.party.leaderId,
      memberUserIds: this.party.getMembers().map((member) => member.userId),
      selectedMode: this.party.mode,
      size: this.party.size,
      maxMembers: this.party.maxMembers,
    });
  }
}
