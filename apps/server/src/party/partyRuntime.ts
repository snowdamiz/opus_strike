import {
  ALL_HERO_IDS,
  DEFAULT_GAMEPLAY_MODE,
  PARTY_MAX_MEMBERS,
  createDefaultPartyBotFillSettings,
  getHumanPartyHeroIds,
  getRankDivisionIndex,
  getRankFromRating,
  isGameplayMode,
  isPartyMode,
  type GameplayMode,
  type BotDifficulty,
  type HeroId,
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
  botFillEnabledByMode?: unknown;
  members?: unknown;
}

export interface PartyMemberChange {
  member: PartyRuntimeMember;
  replacedSessionId: string | null;
  leaderChanged: boolean;
}

export class PartyRosterRuntime {
  readonly partyId: string;
  readonly maxMembers: number;
  private leaderUserId: string | null = null;
  private selectedMode: PartyMode = 'quick_play';
  private gameplayMode: GameplayMode = DEFAULT_GAMEPLAY_MODE;
  private botFillEnabledByMode: PartyBotFillSettings = createDefaultPartyBotFillSettings();
  private launchError: string | null = null;
  private readonly members = new Map<string, PartyRuntimeMember>();
  private readonly sessionToUserId = new Map<string, string>();
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
    return { member, replacedSessionId, leaderChanged };
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

  removeSession(sessionId: string): PartyMemberChange | null {
    const userId = this.sessionToUserId.get(sessionId);
    if (!userId) return null;

    this.sessionToUserId.delete(sessionId);
    const member = this.members.get(userId);
    if (!member) return null;

    this.members.delete(userId);

    let leaderChanged = false;
    if (this.leaderUserId === userId) {
      this.leaderUserId = this.getMembers().find((candidate) => !candidate.isBot)?.userId ?? null;
      leaderChanged = true;
    }

    this.launchError = null;
    return { member, replacedSessionId: null, leaderChanged };
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

    if (isPartyMode(snapshot.selectedMode)) {
      this.selectedMode = snapshot.selectedMode;
    }
    if (isGameplayMode(snapshot.gameplayMode)) {
      this.gameplayMode = snapshot.gameplayMode;
    }

    const botFill = createDefaultPartyBotFillSettings();
    if (snapshot.botFillEnabledByMode && typeof snapshot.botFillEnabledByMode === 'object') {
      const rawBotFill = snapshot.botFillEnabledByMode as Partial<Record<GameplayMode, unknown>>;
      for (const mode of Object.keys(botFill) as GameplayMode[]) {
        botFill[mode] = rawBotFill[mode] === true;
      }
    }
    this.botFillEnabledByMode = botFill;

    const members = Array.isArray(snapshot.members) ? snapshot.members : [];
    for (const member of Array.from(this.members.values())) {
      if (member.isBot) {
        this.members.delete(member.userId);
      }
    }

    for (const member of members) {
      if (this.members.size >= this.maxMembers) break;
      if (!member || typeof member !== 'object') continue;
      const rawMember = member as Partial<PartyMemberSnapshot>;
      if (rawMember.isBot !== true) continue;

      const botIndex = this.botCounter++;
      const competitiveRating = 800;
      const heroId = typeof rawMember.heroId === 'string' && ALL_HERO_IDS.includes(rawMember.heroId as HeroId)
        ? rawMember.heroId as HeroId
        : 'blaze';
      const difficulty = normalizeBotDifficulty(rawMember.botDifficulty);
      const displayName = typeof rawMember.displayName === 'string' && rawMember.displayName.trim()
        ? rawMember.displayName.trim().slice(0, 24)
        : `Bot ${botIndex + 1}`;

      this.members.set(`party-bot:${this.partyId}:restored:${botIndex}`, {
        userId: `party-bot:${this.partyId}:restored:${botIndex}`,
        sessionId: null,
        displayName,
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

    this.reassignBotHeroes();
    this.launchError = null;
  }

  updateHero(userId: string, heroId: HeroId): PartyRuntimeMember | null {
    const member = this.members.get(userId);
    if (!member) return null;
    if (!member.isBot && !this.isHumanHeroAvailable(heroId, userId)) {
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
    this.selectedMode = mode;
    if (gameplayMode !== undefined) {
      if (!isGameplayMode(gameplayMode)) {
        throw new Error('Invalid gameplay mode');
      }
      this.gameplayMode = gameplayMode;
    }
    for (const member of this.members.values()) {
      if (!member.isBot && member.userId !== this.leaderUserId) {
        member.ready = false;
      }
    }
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
    for (const member of this.members.values()) {
      if (!member.isBot && member.userId !== this.leaderUserId) {
        member.ready = false;
      }
    }
    this.launchError = null;
    return this.snapshot();
  }

  setLaunchError(message: string | null): PartyStateSnapshot {
    this.launchError = message;
    return this.snapshot();
  }

  validateStart(): { ok: true } | { ok: false; message: string } {
    if (!this.leaderUserId || this.members.size === 0) {
      return { ok: false, message: 'Party is empty' };
    }

    const notReady = this.getMembers().find((member) => !member.isBot && member.userId !== this.leaderUserId && !member.ready);
    if (notReady) {
      return { ok: false, message: `${notReady.displayName} is not ready` };
    }

    const pickedHeroIds = new Set<HeroId>();
    for (const member of this.members.values()) {
      if (pickedHeroIds.has(member.heroId)) {
        return { ok: false, message: 'Each party member needs a unique hero' };
      }
      pickedHeroIds.add(member.heroId);
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

  private assertLeader(userId: string): void {
    if (!this.leaderUserId || this.leaderUserId !== userId) {
      throw new Error('Only the party leader can manage bots');
    }
  }

  private isHumanHeroAvailable(heroId: HeroId, exceptUserId?: string | null): boolean {
    return !getHumanPartyHeroIds(this.members.values(), exceptUserId).has(heroId);
  }

  private resolveHumanHero(userId: string, requestedHeroId: HeroId): HeroId {
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
}

function normalizeBotDifficulty(value: unknown): BotDifficulty {
  return value === 'easy' || value === 'normal' || value === 'hard' ? value : 'normal';
}
