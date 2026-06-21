import {
  ALL_HERO_IDS,
  DEFAULT_GAMEPLAY_MODE,
  DEFAULT_MATCH_PERSPECTIVE,
  PARTY_MAX_MEMBERS,
  createDefaultMatchPerspectiveSettings,
  createDefaultPartyBotFillSettings,
  getMatchPerspectiveSettingMode,
  getGameplayModeRules,
  getPartyMaxMembersForMode,
  getHumanPartyHeroIds,
  hasDuplicatePartyHeroes,
  isMatchMode,
  isCustomLobbyGameplayMode,
  getRankDivisionIndex,
  getRankFromRating,
  isGameplayMode,
  isMatchPerspective,
  isMatchPerspectiveSettingMode,
  isPartyMode,
  requiresUniquePartyHeroes,
  type GameplayMode,
  type BotDifficulty,
  type HeroId,
  type MatchPerspective,
  type MatchPerspectiveSettingMode,
  type MatchPerspectiveSettings,
  type PartyLaunchPayload,
  type PartyBotFillSettings,
  type PartyMemberSnapshot,
  type PartyMode,
  type PartyStateSnapshot,
  type RankSummary,
} from '@voxel-strike/shared';

export interface PartyRuntimeMember {
  userId: string;
  sessionId: string | null;
  displayName: string;
  heroId: HeroId;
  ready: boolean;
  connected: boolean;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
  rank: RankSummary;
  competitiveRating: number;
  rankDivisionIndex: number;
  walletAddress: string | null;
  tutorialCompletedAt: Date | null;
  rankedPlacementsRemaining: number;
  devTutorialBypass: boolean;
}

export interface AddPartyMemberInput {
  userId: string;
  sessionId: string;
  displayName: string;
  heroId: HeroId;
  rank?: RankSummary;
  competitiveRating?: number;
  rankDivisionIndex?: number;
  walletAddress?: string | null;
  tutorialCompletedAt?: Date | null;
  rankedPlacementsRemaining?: number;
  devTutorialBypass?: boolean;
}

export interface AddPartyBotInput {
  displayName?: string;
  heroId?: HeroId;
  difficulty?: BotDifficulty;
}

export interface PersistentPartySnapshotInput {
  selectedMode?: unknown;
  gameplayMode?: unknown;
  leaderUserId?: unknown;
  botFillEnabledByMode?: unknown;
  perspectiveByMode?: unknown;
  members?: unknown;
  pendingLaunchPayloadsByUserId?: unknown;
}

export interface PartyMemberChange {
  member: PartyRuntimeMember;
  replacedSessionId: string | null;
  leaderChanged: boolean;
  removed: boolean;
}

export interface PartyPersistentSnapshot extends PartyStateSnapshot {
  pendingLaunchPayloadsByUserId?: Record<string, PartyLaunchPayload>;
}

export class PartyRosterRuntime {
  readonly partyId: string;
  readonly maxMembers: number;
  private leaderUserId: string | null = null;
  private selectedMode: PartyMode = 'quick_play';
  private gameplayMode: GameplayMode = DEFAULT_GAMEPLAY_MODE;
  private botFillEnabledByMode: PartyBotFillSettings = createDefaultPartyBotFillSettings();
  private perspectiveByMode: MatchPerspectiveSettings = createDefaultMatchPerspectiveSettings();
  private launchError: string | null = null;
  private readonly members = new Map<string, PartyRuntimeMember>();
  private readonly sessionToUserId = new Map<string, string>();
  private pendingLaunchPayloadsByUserId = new Map<string, PartyLaunchPayload>();
  private botCounter = 0;

  constructor(partyId: string, maxMembers = PARTY_MAX_MEMBERS) {
    this.partyId = partyId;
    this.maxMembers = maxMembers;
  }

  get size(): number {
    return this.members.size;
  }

  get leaderId(): string | null {
    return this.leaderUserId;
  }

  get mode(): PartyMode {
    return this.selectedMode;
  }

  get selectedGameplayMode(): GameplayMode {
    return this.gameplayMode;
  }

  getBotFillEnabled(gameplayMode: GameplayMode): boolean {
    return this.botFillEnabledByMode[gameplayMode] === true;
  }

  getActiveMatchPerspective(partyMode: PartyMode, gameplayMode: GameplayMode): MatchPerspective {
    const modeKey = getMatchPerspectiveSettingMode(partyMode, gameplayMode);
    return modeKey ? this.perspectiveByMode[modeKey] : DEFAULT_MATCH_PERSPECTIVE;
  }

  initializeSelection(input: Pick<PersistentPartySnapshotInput, 'selectedMode' | 'gameplayMode'>): void {
    if (isPartyMode(input.selectedMode)) {
      this.selectedMode = input.selectedMode;
    }
    if (isGameplayMode(input.gameplayMode)) {
      this.gameplayMode = input.gameplayMode;
    }
    if (this.selectedMode === 'custom' && !isCustomLobbyGameplayMode(this.gameplayMode)) {
      this.gameplayMode = DEFAULT_GAMEPLAY_MODE;
    }
  }

  addMember(input: AddPartyMemberInput): PartyMemberChange {
    const existing = this.members.get(input.userId);
    if (!existing && this.members.size >= this.maxMembers) {
      throw new Error('Party is full');
    }

    const competitiveRating = input.competitiveRating ?? existing?.competitiveRating ?? 800;
    const heroId = this.resolveHumanHero(input.userId, input.heroId);
    const ready = existing?.heroId === heroId ? existing.ready : false;
    const member: PartyRuntimeMember = {
      userId: input.userId,
      sessionId: input.sessionId,
      displayName: input.displayName,
      heroId,
      ready,
      connected: true,
      isBot: false,
      botDifficulty: undefined,
      rank: input.rank ?? existing?.rank ?? getRankFromRating(competitiveRating, 0),
      competitiveRating,
      rankDivisionIndex: input.rankDivisionIndex ?? getRankDivisionIndex(competitiveRating),
      walletAddress: input.walletAddress ?? existing?.walletAddress ?? null,
      tutorialCompletedAt: input.tutorialCompletedAt ?? existing?.tutorialCompletedAt ?? null,
      rankedPlacementsRemaining: input.rankedPlacementsRemaining ?? existing?.rankedPlacementsRemaining ?? 0,
      devTutorialBypass: input.devTutorialBypass ?? existing?.devTutorialBypass ?? false,
    };

    const replacedSessionId = existing && existing.sessionId !== input.sessionId
      ? existing.sessionId
      : null;
    if (replacedSessionId) {
      this.sessionToUserId.delete(replacedSessionId);
    }

    this.members.set(input.userId, member);
    this.sessionToUserId.set(input.sessionId, input.userId);
    this.reassignBotHeroes();

    let leaderChanged = false;
    if (!this.leaderUserId) {
      this.leaderUserId = input.userId;
      leaderChanged = true;
    }

    this.launchError = null;
    return { member, replacedSessionId, leaderChanged, removed: false };
  }

  addBot(leaderUserId: string, input: AddPartyBotInput = {}): PartyRuntimeMember {
    this.assertLeader(leaderUserId);
    if (this.members.size >= this.maxMembers) {
      throw new Error('Party is full');
    }

    const botIndex = this.botCounter++;
    const competitiveRating = 800;
    const difficulty = input.difficulty ?? 'normal';
    const member: PartyRuntimeMember = {
      userId: `party-bot:${this.partyId}:${botIndex}`,
      sessionId: null,
      displayName: (input.displayName?.trim() || `Bot ${botIndex + 1}`).slice(0, 24),
      heroId: input.heroId ?? 'blaze',
      ready: true,
      connected: true,
      isBot: true,
      botDifficulty: difficulty,
      rank: getRankFromRating(competitiveRating, 0),
      competitiveRating,
      rankDivisionIndex: getRankDivisionIndex(competitiveRating),
      walletAddress: null,
      tutorialCompletedAt: null,
      rankedPlacementsRemaining: 0,
      devTutorialBypass: true,
    };

    this.members.set(member.userId, member);
    this.reassignBotHeroes();
    this.launchError = null;
    return member;
  }

  kickMember(leaderUserId: string, targetUserId: string): PartyRuntimeMember | null {
    this.assertLeader(leaderUserId);
    if (leaderUserId === targetUserId) {
      throw new Error('Cannot kick yourself');
    }

    const member = this.members.get(targetUserId);
    if (!member) return null;
    this.members.delete(targetUserId);
    if (member.sessionId) {
      this.sessionToUserId.delete(member.sessionId);
    }
    this.launchError = null;
    return member;
  }

  removeSession(sessionId: string, options: { removeMember?: boolean } = {}): PartyMemberChange | null {
    const userId = this.sessionToUserId.get(sessionId);
    if (!userId) return null;

    this.sessionToUserId.delete(sessionId);
    const member = this.members.get(userId);
    if (!member) return null;

    if (member.sessionId === sessionId) {
      member.sessionId = null;
    }

    let leaderChanged = false;
    const shouldRemoveMember = options.removeMember === true;
    if (shouldRemoveMember) {
      this.members.delete(userId);
      this.pendingLaunchPayloadsByUserId.delete(userId);
      if (this.leaderUserId === userId) {
        this.leaderUserId = this.chooseReplacementLeader();
        leaderChanged = true;
      }
    } else {
      member.connected = false;
    }

    this.launchError = null;
    return { member, replacedSessionId: null, leaderChanged, removed: shouldRemoveMember };
  }

  getMemberBySession(sessionId: string): PartyRuntimeMember | null {
    const userId = this.sessionToUserId.get(sessionId);
    return userId ? this.members.get(userId) ?? null : null;
  }

  getMember(userId: string): PartyRuntimeMember | null {
    return this.members.get(userId) ?? null;
  }

  getMembers(): PartyRuntimeMember[] {
    return Array.from(this.members.values());
  }

  getHumanMembers(): PartyRuntimeMember[] {
    return this.getMembers().filter((member) => !member.isBot);
  }

  getBotMembers(): PartyRuntimeMember[] {
    return this.getMembers().filter((member) => member.isBot);
  }

  restorePersistentSnapshot(snapshot: PersistentPartySnapshotInput | null | undefined): void {
    if (!snapshot || typeof snapshot !== 'object') return;

    this.initializeSelection(snapshot);
    this.members.clear();
    this.sessionToUserId.clear();
    this.pendingLaunchPayloadsByUserId.clear();
    this.leaderUserId = null;

    const botFill = createDefaultPartyBotFillSettings();
    if (snapshot.botFillEnabledByMode && typeof snapshot.botFillEnabledByMode === 'object') {
      const rawBotFill = snapshot.botFillEnabledByMode as Partial<Record<GameplayMode, unknown>>;
      for (const mode of Object.keys(botFill) as GameplayMode[]) {
        botFill[mode] = rawBotFill[mode] === true;
      }
    }
    this.botFillEnabledByMode = botFill;

    const perspectives = createDefaultMatchPerspectiveSettings();
    if (snapshot.perspectiveByMode && typeof snapshot.perspectiveByMode === 'object') {
      const rawPerspectives = snapshot.perspectiveByMode as Partial<Record<MatchPerspectiveSettingMode, unknown>>;
      for (const mode of Object.keys(perspectives) as MatchPerspectiveSettingMode[]) {
        perspectives[mode] = isMatchPerspective(rawPerspectives[mode]) ? rawPerspectives[mode] : perspectives[mode];
      }
    }
    this.perspectiveByMode = perspectives;

    const members = Array.isArray(snapshot.members) ? snapshot.members : [];
    const restoredLeaderUserId = normalizeUserId(snapshot.leaderUserId);

    for (const member of members) {
      if (this.members.size >= this.maxMembers) break;
      if (!member || typeof member !== 'object') continue;
      const rawMember = member as Partial<PartyMemberSnapshot>;
      const competitiveRating = 800;
      const requestedHeroId = typeof rawMember.heroId === 'string' && ALL_HERO_IDS.includes(rawMember.heroId as HeroId)
        ? rawMember.heroId as HeroId
        : 'blaze';
      const displayName = typeof rawMember.displayName === 'string' && rawMember.displayName.trim()
        ? rawMember.displayName.trim().slice(0, 24)
        : null;

      if (rawMember.isBot !== true) {
        const userId = normalizeUserId(rawMember.userId);
        if (!userId) continue;
        const heroId = this.resolveHumanHero(userId, requestedHeroId);
        this.members.set(userId, {
          userId,
          sessionId: null,
          displayName: displayName ?? userId,
          heroId,
          ready: rawMember.ready === true && heroId === requestedHeroId,
          connected: false,
          isBot: false,
          botDifficulty: undefined,
          rank: normalizeRankSummary(rawMember.rank),
          competitiveRating,
          rankDivisionIndex: getRankDivisionIndex(competitiveRating),
          walletAddress: null,
          tutorialCompletedAt: null,
          rankedPlacementsRemaining: 0,
          devTutorialBypass: false,
        });
        continue;
      }

      const botIndex = this.botCounter++;
      const difficulty = normalizeBotDifficulty(rawMember.botDifficulty);
      const heroId = requestedHeroId;
      this.members.set(`party-bot:${this.partyId}:restored:${botIndex}`, {
        userId: `party-bot:${this.partyId}:restored:${botIndex}`,
        sessionId: null,
        displayName: displayName ?? `Bot ${botIndex + 1}`,
        heroId,
        ready: true,
        connected: true,
        isBot: true,
        botDifficulty: difficulty,
        rank: getRankFromRating(competitiveRating, 0),
        competitiveRating,
        rankDivisionIndex: getRankDivisionIndex(competitiveRating),
        walletAddress: null,
        tutorialCompletedAt: null,
        rankedPlacementsRemaining: 0,
        devTutorialBypass: true,
      });
    }

    const restoredLeader = restoredLeaderUserId ? this.members.get(restoredLeaderUserId) : null;
    this.leaderUserId = restoredLeader && !restoredLeader.isBot
      ? restoredLeader.userId
      : this.chooseReplacementLeader();
    this.restorePendingLaunchPayloads(snapshot.pendingLaunchPayloadsByUserId);
    this.reassignBotHeroes();
    this.launchError = null;
  }

  updateHero(userId: string, heroId: HeroId): PartyRuntimeMember | null {
    const member = this.members.get(userId);
    if (!member) return null;
    if (
      !member.isBot
      && this.requiresUniqueHeroes()
      && !this.isHumanHeroAvailable(heroId, userId)
    ) {
      throw new Error('Hero is already picked by a party member');
    }
    member.heroId = heroId;
    member.ready = false;
    this.reassignBotHeroes();
    this.launchError = null;
    return member;
  }

  setReady(userId: string, ready: boolean): PartyRuntimeMember | null {
    const member = this.members.get(userId);
    if (!member) return null;
    if (ready && this.requiresUniqueHeroes() && hasDuplicatePartyHeroes(this.members.values())) {
      throw new Error('Each party member needs a unique hero');
    }
    member.ready = this.leaderUserId === userId ? false : ready;
    this.launchError = null;
    return member;
  }

  setMode(userId: string, mode: unknown, gameplayMode?: unknown): PartyStateSnapshot {
    if (this.leaderUserId !== userId) {
      throw new Error('Only the party leader can choose the mode');
    }
    if (!isPartyMode(mode)) {
      throw new Error('Invalid party mode');
    }
    let nextGameplayMode = this.gameplayMode;
    if (gameplayMode !== undefined) {
      if (!isGameplayMode(gameplayMode)) {
        throw new Error('Invalid gameplay mode');
      }
      nextGameplayMode = gameplayMode;
    }
    if (mode === 'custom' && !isCustomLobbyGameplayMode(nextGameplayMode)) {
      throw new Error('Custom lobbies support Capture the Flag or Team Deathmatch');
    }
    this.selectedMode = mode;
    this.gameplayMode = nextGameplayMode;
    this.clearNonLeaderReady();
    this.launchError = null;
    return this.snapshot();
  }

  setBotFillEnabled(userId: string, gameplayMode: unknown, enabled: unknown): PartyStateSnapshot {
    if (this.leaderUserId !== userId) {
      throw new Error('Only the party leader can choose bot fill');
    }
    if (!isGameplayMode(gameplayMode)) {
      throw new Error('Invalid gameplay mode');
    }
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid bot fill value');
    }

    this.botFillEnabledByMode = {
      ...this.botFillEnabledByMode,
      [gameplayMode]: enabled,
    };
    this.clearNonLeaderReady();
    this.launchError = null;
    return this.snapshot();
  }

  setMatchPerspective(userId: string, modeKey: unknown, perspective: unknown): PartyStateSnapshot {
    if (this.leaderUserId !== userId) {
      throw new Error('Only the party leader can choose match perspective');
    }
    if (!isMatchPerspectiveSettingMode(modeKey)) {
      throw new Error('Invalid match settings mode');
    }
    if (!isMatchPerspective(perspective)) {
      throw new Error('Invalid match perspective');
    }

    this.perspectiveByMode = {
      ...this.perspectiveByMode,
      [modeKey]: perspective,
    };
    this.clearNonLeaderReady();
    this.launchError = null;
    return this.snapshot();
  }

  setLaunchError(message: string | null): PartyStateSnapshot {
    this.launchError = message;
    return this.snapshot();
  }

  setPendingLaunchPayloads(payloadsByUserId: Map<string, PartyLaunchPayload>): void {
    this.pendingLaunchPayloadsByUserId = new Map(payloadsByUserId);
    this.launchError = null;
  }

  getPendingLaunchPayload(userId: string): PartyLaunchPayload | null {
    return this.pendingLaunchPayloadsByUserId.get(userId) ?? null;
  }

  clearPendingLaunchPayload(userId: string): void {
    this.pendingLaunchPayloadsByUserId.delete(userId);
  }

  hasPendingLaunchPayloads(): boolean {
    return this.pendingLaunchPayloadsByUserId.size > 0;
  }

  validateStart(): { ok: true } | { ok: false; message: string } {
    if (!this.leaderUserId || this.members.size === 0) {
      return { ok: false, message: 'Party is empty' };
    }

    if (this.selectedMode === 'custom' && !isCustomLobbyGameplayMode(this.gameplayMode)) {
      return { ok: false, message: 'Custom lobbies support Capture the Flag or Team Deathmatch' };
    }

    const maxMembersForMode = getPartyMaxMembersForMode(this.selectedMode, this.gameplayMode);
    if (this.members.size > maxMembersForMode) {
      if (this.gameplayMode === 'battle_royal') {
        return { ok: false, message: `Battle Royal squads are limited to ${maxMembersForMode} players` };
      }
      const label = this.selectedMode === 'custom'
        ? 'Custom lobbies'
        : getGameplayModeRules(this.gameplayMode).label;
      return { ok: false, message: `${label} parties are limited to ${maxMembersForMode} players` };
    }

    const notReady = this.getMembers().find((member) => !member.isBot && member.userId !== this.leaderUserId && !member.ready);
    if (notReady) {
      return { ok: false, message: `${notReady.displayName} is not ready` };
    }

    const disconnected = this.getMembers().find((member) => !member.isBot && !member.connected);
    if (disconnected) {
      return { ok: false, message: `${disconnected.displayName} is disconnected` };
    }

    if (this.requiresUniqueHeroes() && hasDuplicatePartyHeroes(this.members.values())) {
      return { ok: false, message: 'Each party member needs a unique hero' };
    }

    return { ok: true };
  }

  snapshot(): PartyStateSnapshot {
    return {
      partyId: this.partyId,
      leaderUserId: this.leaderUserId ?? '',
      selectedMode: this.selectedMode,
      gameplayMode: this.gameplayMode,
      botFillEnabledByMode: { ...this.botFillEnabledByMode },
      perspectiveByMode: { ...this.perspectiveByMode },
      members: this.getMembers().map((member): PartyMemberSnapshot => ({
        userId: member.userId,
        displayName: member.displayName,
        heroId: member.heroId,
        ready: member.ready,
        connected: member.connected,
        leader: member.userId === this.leaderUserId,
        isBot: member.isBot,
        botDifficulty: member.botDifficulty,
        rank: member.rank,
      })),
      launchError: this.launchError,
    };
  }

  persistentSnapshot(): PartyPersistentSnapshot {
    const snapshot: PartyPersistentSnapshot = this.snapshot();
    if (this.pendingLaunchPayloadsByUserId.size === 0) {
      return snapshot;
    }

    snapshot.pendingLaunchPayloadsByUserId = Object.fromEntries(this.pendingLaunchPayloadsByUserId);
    return snapshot;
  }

  private assertLeader(userId: string): void {
    if (!this.leaderUserId || this.leaderUserId !== userId) {
      throw new Error('Only the party leader can manage bots');
    }
  }

  private clearNonLeaderReady(): void {
    for (const member of this.members.values()) {
      if (!member.isBot && member.userId !== this.leaderUserId) {
        member.ready = false;
      }
    }
  }

  private chooseReplacementLeader(): string | null {
    return this.getMembers().find((candidate) => !candidate.isBot && candidate.connected)?.userId
      ?? this.getMembers().find((candidate) => !candidate.isBot)?.userId
      ?? null;
  }

  private isHumanHeroAvailable(heroId: HeroId, exceptUserId?: string | null): boolean {
    return !getHumanPartyHeroIds(this.members.values(), exceptUserId).has(heroId);
  }

  private resolveHumanHero(userId: string, requestedHeroId: HeroId): HeroId {
    if (!this.requiresUniqueHeroes()) {
      return requestedHeroId;
    }

    if (this.isHumanHeroAvailable(requestedHeroId, userId)) {
      return requestedHeroId;
    }

    return this.getFirstAvailableHero(userId) ?? requestedHeroId;
  }

  private getFirstAvailableHero(exceptUserId?: string | null): HeroId | null {
    const occupied = new Set<HeroId>();

    for (const member of this.members.values()) {
      if (member.userId === exceptUserId) continue;
      occupied.add(member.heroId);
    }

    return ALL_HERO_IDS.find((heroId) => !occupied.has(heroId)) ?? null;
  }

  private reassignBotHeroes(): void {
    if (!this.requiresUniqueHeroes()) {
      return;
    }

    const occupied = new Set<HeroId>();
    const bots: PartyRuntimeMember[] = [];

    for (const member of this.members.values()) {
      if (member.isBot) {
        bots.push(member);
        continue;
      }
      occupied.add(member.heroId);
    }

    for (const bot of bots) {
      if (!occupied.has(bot.heroId)) {
        occupied.add(bot.heroId);
        continue;
      }

      const replacement = ALL_HERO_IDS.find((heroId) => !occupied.has(heroId));
      if (replacement) {
        bot.heroId = replacement;
      }
      occupied.add(bot.heroId);
    }
  }

  private restorePendingLaunchPayloads(value: unknown): void {
    if (!value || typeof value !== 'object') return;

    for (const [userId, payload] of Object.entries(value as Record<string, unknown>)) {
      if (!this.members.has(userId)) continue;
      const normalizedPayload = normalizePartyLaunchPayload(payload);
      if (normalizedPayload) {
        this.pendingLaunchPayloadsByUserId.set(userId, normalizedPayload);
      }
    }
  }

  private requiresUniqueHeroes(): boolean {
    return requiresUniquePartyHeroes(this.selectedMode);
  }
}

function normalizeBotDifficulty(value: unknown): BotDifficulty {
  return value === 'easy' || value === 'normal' || value === 'hard' ? value : 'normal';
}

function normalizeUserId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[a-zA-Z0-9:_-]{2,160}$/.test(trimmed) ? trimmed : null;
}

function normalizeRankSummary(value: unknown): RankSummary {
  if (
    value
    && typeof value === 'object'
    && typeof (value as Partial<RankSummary>).label === 'string'
    && typeof (value as Partial<RankSummary>).rating === 'number'
  ) {
    return value as RankSummary;
  }

  return getRankFromRating(800, 0);
}

function normalizePartyLaunchPayload(value: unknown): PartyLaunchPayload | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Partial<PartyLaunchPayload>;
  if (!isPartyMode(payload.mode) || !isMatchMode(payload.matchMode)) return null;
  if (typeof payload.lobbyId !== 'string' || !payload.lobbyId.trim()) return null;
  if (!isGameplayMode(payload.gameplayMode) || !isMatchPerspective(payload.matchPerspective)) return null;
  if (payload.botFillMode !== undefined && payload.botFillMode !== 'manual' && payload.botFillMode !== 'fill_even') {
    return null;
  }

  return {
    mode: payload.mode,
    lobbyId: payload.lobbyId.trim(),
    matchMode: payload.matchMode,
    gameplayMode: payload.gameplayMode,
    botFillMode: payload.botFillMode,
    matchPerspective: payload.matchPerspective,
    matchmakingTicket: typeof payload.matchmakingTicket === 'string' ? payload.matchmakingTicket : undefined,
    targetRankDivisionIndex: typeof payload.targetRankDivisionIndex === 'number' ? payload.targetRankDivisionIndex : undefined,
    targetRankLabel: typeof payload.targetRankLabel === 'string' ? payload.targetRankLabel : undefined,
  };
}
