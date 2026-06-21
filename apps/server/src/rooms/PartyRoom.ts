import type { IncomingMessage } from 'http';
import { Room, Client } from 'colyseus';
import {
  PARTY_MAX_MEMBERS,
  isGameplayMode,
  isMatchPerspective,
  isMatchPerspectiveSettingMode,
  isPartyMode,
  type BotDifficulty,
  type GameplayMode,
  type HeroId,
  type MatchPerspective,
  type MatchPerspectiveSettingMode,
  type PartyMode,
} from '@voxel-strike/shared';
import { resolveRoomAuthContext, type RoomAuthContext } from '../auth/session';
import { assertGameplayAccountEligible } from '../auth/accountEligibility';
import prisma from '../db';
import { MessageRateLimiter, type RateLimitRule } from './rateLimiter';
import { isBotDifficulty, isHeroId, isRecord, sanitizeShortText } from './protocolValidation';
import { PartyRosterRuntime } from '../party/partyRuntime';
import {
  launchPartyToCustomLobby,
  launchPartyToMatchmaking,
} from '../party/partyLaunch';
import {
  deletePersistentParty,
  loadPersistentPartyForRestore,
  savePersistentParty,
} from '../party/persistentParty';
import { loggers } from '../utils/logger';

interface PartyJoinOptions {
  heroId?: HeroId;
  selectedMode?: PartyMode;
  gameplayMode?: GameplayMode;
  authToken?: string;
  devTutorialBypass?: boolean;
  restorePartyId?: string;
}

const PARTY_MESSAGE_RATE_LIMITS = {
  hero: { limit: 8, intervalMs: 5000 },
  ready: { limit: 10, intervalMs: 5000 },
  mode: { limit: 8, intervalMs: 5000 },
  botFill: { limit: 12, intervalMs: 5000 },
  perspective: { limit: 12, intervalMs: 5000 },
  bot: { limit: 8, intervalMs: 5000 },
  kick: { limit: 8, intervalMs: 5000 },
  start: { limit: 4, intervalMs: 8000 },
} satisfies Record<string, RateLimitRule>;
const PARTY_IDLE_DISCONNECT_MS = 10 * 60 * 1000;

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
  if (!isPartyMode(mode)) return null;
  const gameplayMode = value.gameplayMode;
  if (gameplayMode !== undefined && !isGameplayMode(gameplayMode)) {
    return null;
  }
  return {
    mode,
    gameplayMode,
  };
}

function validateBotFillPayload(value: unknown): {
  gameplayMode: GameplayMode;
  enabled: boolean;
} | null {
  if (!isRecord(value) || !isGameplayMode(value.gameplayMode)) return null;
  const enabled = booleanValue(value.enabled);
  if (enabled === null) return null;
  return {
    gameplayMode: value.gameplayMode,
    enabled,
  };
}

function validatePerspectivePayload(value: unknown): {
  modeKey: MatchPerspectiveSettingMode;
  perspective: MatchPerspective;
} | null {
  if (!isRecord(value)) return null;
  if (!isMatchPerspectiveSettingMode(value.modeKey) || !isMatchPerspective(value.perspective)) return null;
  return {
    modeKey: value.modeKey,
    perspective: value.perspective,
  };
}

function validatePartyBotPayload(value: unknown): {
  difficulty?: BotDifficulty;
  displayName?: string;
  heroId?: HeroId;
} | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const difficulty = value.difficulty === undefined
    ? undefined
    : isBotDifficulty(value.difficulty) ? value.difficulty : null;
  const displayName = value.displayName === undefined
    ? undefined
    : sanitizeShortText(value.displayName, 24);
  const heroId = value.heroId === undefined
    ? undefined
    : isHeroId(value.heroId) ? value.heroId : null;
  if (difficulty === null || heroId === null) return null;
  return {
    difficulty,
    displayName: displayName ?? undefined,
    heroId,
  };
}

function validatePartyMemberIdPayload(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return sanitizeShortText(value.userId, 96);
}

function isDevTutorialBypassEnabled(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

function sanitizePersistentPartyId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[a-zA-Z0-9:_-]{2,160}$/.test(trimmed) ? trimmed : null;
}

export class PartyRoom extends Room {
  maxClients = PARTY_MAX_MEMBERS;
  override get autoDispose(): boolean {
    return false;
  }

  private party!: PartyRosterRuntime;
  private readonly rateLimiter = new MessageRateLimiter();
  private readonly authBySessionId = new Map<string, RoomAuthContext>();
  private readonly allowedHumanUserIds = new Set<string>();
  private idleDisconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private persistentPartyId: string | null = null;
  private restorePartyId: string | null = null;
  private restoreAttempted = false;
  private hasHadHumanMember = false;
  private disposed = false;
  private launchStarted = false;

  async onAuth(client: Client, options: PartyJoinOptions, request?: IncomingMessage): Promise<RoomAuthContext> {
    const authContext = await resolveRoomAuthContext(options as Record<string, unknown>, request);
    await assertGameplayAccountEligible(authContext.userId);
    return authContext;
  }

  onCreate(options: PartyJoinOptions = {}) {
    this.party = new PartyRosterRuntime(this.roomId, PARTY_MAX_MEMBERS);
    this.party.initializeSelection({
      selectedMode: options.selectedMode,
      gameplayMode: options.gameplayMode,
    });
    this.restorePartyId = sanitizePersistentPartyId(options.restorePartyId);
    this.persistentPartyId = this.restorePartyId ?? this.roomId;

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

    this.onMessage('setBotFill', (client, data: unknown) => {
      if (!this.consumePartyMessage(client, 'setBotFill', PARTY_MESSAGE_RATE_LIMITS.botFill)) return;
      const payload = validateBotFillPayload(data);
      if (!payload) return;
      this.handleSetBotFill(client, payload.gameplayMode, payload.enabled);
    });

    this.onMessage('setPerspective', (client, data: unknown) => {
      if (!this.consumePartyMessage(client, 'setPerspective', PARTY_MESSAGE_RATE_LIMITS.perspective)) return;
      const payload = validatePerspectivePayload(data);
      if (!payload) return;
      this.handleSetPerspective(client, payload.modeKey, payload.perspective);
    });

    this.onMessage('addBot', (client, data: unknown = {}) => {
      if (!this.consumePartyMessage(client, 'addBot', PARTY_MESSAGE_RATE_LIMITS.bot)) return;
      const payload = validatePartyBotPayload(data);
      if (!payload) return;
      this.handleAddBot(client, payload);
    });

    this.onMessage('kickMember', (client, data: unknown) => {
      if (!this.consumePartyMessage(client, 'kickMember', PARTY_MESSAGE_RATE_LIMITS.kick)) return;
      const targetUserId = validatePartyMemberIdPayload(data);
      if (!targetUserId) return;
      this.handleKickMember(client, targetUserId);
    });

    this.onMessage('start', (client) => {
      if (!this.consumePartyMessage(client, 'start', PARTY_MESSAGE_RATE_LIMITS.start)) return;
      this.handleStart(client).catch((error) => {
        this.sendLaunchError(client, error instanceof Error ? error.message : 'Failed to start party');
      });
    });

    this.onMessage('partyLaunchAck', (client) => {
      this.handlePartyLaunchAck(client);
    });

    this.onMessage('leave', (client) => {
      client.leave();
    });
  }

  async onJoin(client: Client, options: PartyJoinOptions) {
    this.clearIdleDisconnectTimer();
    const authContext = (client as Client & { auth?: RoomAuthContext }).auth;
    if (!authContext) {
      client.send('error', { message: 'Authentication required' });
      client.leave();
      return;
    }

    if (!(await this.restorePersistentPartyFor(authContext))) {
      client.send('error', { message: 'Party is no longer available' });
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
    let change;
    try {
      change = this.party.addMember({
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
    } catch (error) {
      client.send('error', { message: error instanceof Error ? error.message : 'Failed to join party' });
      client.leave();
      return;
    }

    if (change.replacedSessionId) {
      const oldClient = this.clients.find((candidate) => candidate.sessionId === change.replacedSessionId);
      oldClient?.send('duplicateSession', { reason: 'Connected from another tab/window' });
      oldClient?.leave(4000);
    }

    this.allowedHumanUserIds.add(authContext.userId);
    this.hasHadHumanMember = true;
    this.broadcast('partyMemberJoined', {
      userId: authContext.userId,
      displayName: authContext.displayName,
    });
    if (change.leaderChanged) {
      this.broadcast('partyLeaderChanged', { leaderUserId: this.party.leaderId });
    }
    this.broadcastPartyState();
    const pendingLaunchPayload = this.party.getPendingLaunchPayload(authContext.userId);
    if (pendingLaunchPayload) {
      client.send('partyLaunch', pendingLaunchPayload);
    }
  }

  onLeave(client: Client, consented?: boolean) {
    this.rateLimiter.clearScope(client.sessionId);
    this.authBySessionId.delete(client.sessionId);
    const change = this.party.removeSession(client.sessionId, { removeMember: consented === true });
    const hasRemainingClients = this.clients.filter((candidate) => candidate.sessionId !== client.sessionId).length > 0;
    if (!change) {
      if (!hasRemainingClients) {
        this.scheduleIdleDisconnect();
      }
      return;
    }

    if (consented === true && !change.member.isBot) {
      this.allowedHumanUserIds.delete(change.member.userId);
    }
    if (change.removed) {
      this.broadcast('partyMemberLeft', {
        userId: change.member.userId,
        displayName: change.member.displayName,
      });
    } else {
      this.broadcast('partyMemberUpdated', {
        userId: change.member.userId,
        connected: change.member.connected,
        ready: change.member.ready,
      });
    }
    if (change.leaderChanged) {
      this.broadcast('partyLeaderChanged', { leaderUserId: this.party.leaderId });
    }
    this.broadcastPartyState();
    if (!hasRemainingClients) {
      this.scheduleIdleDisconnect();
    }
  }

  onDispose() {
    this.disposed = true;
    this.clearIdleDisconnectTimer();
  }

  private async restorePersistentPartyFor(authContext: RoomAuthContext): Promise<boolean> {
    if (!this.restorePartyId || this.restoreAttempted) return true;
    this.restoreAttempted = true;

    const persistentParty = await loadPersistentPartyForRestore(this.restorePartyId, authContext.userId);
    if (!persistentParty) return false;

    this.persistentPartyId = persistentParty.id;
    this.allowedHumanUserIds.clear();
    for (const userId of persistentParty.allowedUserIds) {
      this.allowedHumanUserIds.add(userId);
    }
    this.allowedHumanUserIds.add(persistentParty.ownerUserId);
    if (persistentParty.leaderUserId) {
      this.allowedHumanUserIds.add(persistentParty.leaderUserId);
    }
    this.hasHadHumanMember = true;
    this.party.restorePersistentSnapshot(isRecord(persistentParty.snapshot) ? persistentParty.snapshot : null);
    this.launchStarted = this.party.hasPendingLaunchPayloads();
    return true;
  }

  private async canJoinParty(authContext: RoomAuthContext): Promise<boolean> {
    if (
      this.party.getMember(authContext.userId) ||
      this.allowedHumanUserIds.has(authContext.userId)
    ) {
      return true;
    }
    if (this.party.size === 0 && !this.hasHadHumanMember) return true;

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
    try {
      const updated = this.party.updateHero(member.userId, heroId);
      if (!updated) return;
      this.broadcast('partyMemberUpdated', {
        userId: updated.userId,
        heroId: updated.heroId,
        ready: updated.ready,
      });
      this.broadcastPartyState();
    } catch (error) {
      client.send('error', { message: error instanceof Error ? error.message : 'Failed to set party hero' });
    }
  }

  private handleSetReady(client: Client, ready: boolean): void {
    const member = this.memberForClient(client);
    if (!member) return;
    try {
      const updated = this.party.setReady(member.userId, ready);
      if (!updated) return;
      this.broadcast('partyMemberUpdated', {
        userId: updated.userId,
        ready: updated.ready,
      });
      this.broadcastPartyState();
    } catch (error) {
      client.send('error', { message: error instanceof Error ? error.message : 'Failed to set party ready' });
    }
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

  private handleSetBotFill(client: Client, gameplayMode: GameplayMode, enabled: boolean): void {
    const member = this.memberForClient(client);
    if (!member) return;
    try {
      this.party.setBotFillEnabled(member.userId, gameplayMode, enabled);
      this.broadcastPartyState();
    } catch (error) {
      client.send('error', { message: error instanceof Error ? error.message : 'Failed to set party bot fill' });
    }
  }

  private handleSetPerspective(client: Client, modeKey: MatchPerspectiveSettingMode, perspective: MatchPerspective): void {
    const member = this.memberForClient(client);
    if (!member) return;
    try {
      this.party.setMatchPerspective(member.userId, modeKey, perspective);
      this.broadcastPartyState();
    } catch (error) {
      client.send('error', { message: error instanceof Error ? error.message : 'Failed to set match perspective' });
    }
  }

  private handleAddBot(
    client: Client,
    payload: { difficulty?: BotDifficulty; displayName?: string; heroId?: HeroId }
  ): void {
    const member = this.memberForClient(client);
    if (!member) return;
    try {
      const bot = this.party.addBot(member.userId, payload);
      this.broadcast('partyMemberJoined', {
        userId: bot.userId,
        displayName: bot.displayName,
        isBot: true,
      });
      this.broadcastPartyState();
    } catch (error) {
      client.send('error', { message: error instanceof Error ? error.message : 'Failed to add bot' });
    }
  }

  private handleKickMember(client: Client, targetUserId: string): void {
    const member = this.memberForClient(client);
    if (!member) return;
    try {
      const removed = this.party.kickMember(member.userId, targetUserId);
      if (!removed) return;
      this.broadcast('partyMemberLeft', {
        userId: removed.userId,
        displayName: removed.displayName,
        isBot: removed.isBot,
      });
      if (removed.sessionId) {
        const targetClient = this.clients.find((candidate) => candidate.sessionId === removed.sessionId);
        targetClient?.send('partyKicked', { reason: 'Kicked by party leader' });
        targetClient?.leave(4001);
      }
      if (!removed.isBot) {
        this.allowedHumanUserIds.delete(removed.userId);
      }
      this.broadcastPartyState();
    } catch (error) {
      client.send('error', { message: error instanceof Error ? error.message : 'Failed to kick party member' });
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

    this.launchStarted = true;
    this.party.setPendingLaunchPayloads(result.payloadsByUserId);
    this.broadcastPartyState({ persist: false });
    await this.persistPartyStateNow();

    for (const partyMember of this.party.getMembers()) {
      const payload = result.payloadsByUserId.get(partyMember.userId);
      if (!payload) continue;
      const target = this.clients.find((candidate) => candidate.sessionId === partyMember.sessionId);
      target?.send('partyLaunch', payload);
    }
  }

  private handlePartyLaunchAck(client: Client): void {
    const member = this.memberForClient(client);
    if (!member) return;
    if (!this.party.getPendingLaunchPayload(member.userId)) return;

    this.party.clearPendingLaunchPayload(member.userId);
    if (this.party.hasPendingLaunchPayloads()) {
      this.persistPartyState();
      return;
    }

    this.deletePersistentPartyRecord();
  }

  private sendLaunchError(client: Client, message: string): void {
    this.party.setLaunchError(message);
    client.send('error', { message });
    this.broadcastPartyState();
  }

  private broadcastPartyState(options: { persist?: boolean } = {}): void {
    this.updateMetadata();
    this.broadcast('partyState', this.party.snapshot());
    if (options.persist !== false) {
      this.persistPartyState();
    }
  }

  private persistPartyState(): void {
    this.persistPartyStateNow().catch((error) => {
      loggers.room.warn('Failed to persist party state', error);
    });
  }

  private async persistPartyStateNow(): Promise<void> {
    const persistentPartyId = this.persistentPartyId ?? this.roomId;
    this.persistentPartyId = persistentPartyId;
    const allowedUserIds = Array.from(this.allowedHumanUserIds);
    const ownerUserId = this.party.leaderId ?? allowedUserIds[0] ?? null;

    if (this.launchStarted && !this.party.hasPendingLaunchPayloads()) {
      await deletePersistentParty(persistentPartyId);
      return;
    }

    if (!ownerUserId) {
      await deletePersistentParty(persistentPartyId);
      return;
    }

    await savePersistentParty({
      persistentPartyId,
      roomId: this.roomId,
      ownerUserId,
      leaderUserId: this.party.leaderId,
      allowedUserIds,
      party: this.party,
    });
  }

  private deletePersistentPartyRecord(): void {
    const persistentPartyId = this.persistentPartyId;
    if (!persistentPartyId) return;

    deletePersistentParty(persistentPartyId).catch((error) => {
      loggers.room.warn('Failed to clear persistent party', error);
    });
  }

  private scheduleIdleDisconnect(): void {
    this.clearIdleDisconnectTimer();
    this.idleDisconnectTimeout = setTimeout(() => {
      this.idleDisconnectTimeout = null;
      if (this.disposed || this.clients.length > 0) return;
      this.disconnect();
    }, PARTY_IDLE_DISCONNECT_MS);
    this.idleDisconnectTimeout.unref?.();
  }

  private clearIdleDisconnectTimer(): void {
    if (!this.idleDisconnectTimeout) return;
    clearTimeout(this.idleDisconnectTimeout);
    this.idleDisconnectTimeout = null;
  }

  private updateMetadata(): void {
    this.setMetadata({
      leaderUserId: this.party.leaderId,
      persistentPartyId: this.persistentPartyId,
      memberUserIds: this.party.getMembers().map((member) => member.userId),
      selectedMode: this.party.mode,
      size: this.party.size,
      maxMembers: this.party.maxMembers,
    });
  }
}
