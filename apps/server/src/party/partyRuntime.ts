import {
  DEFAULT_GAMEPLAY_MODE,
  DEFAULT_GAME_CONFIG,
  getRankDivisionIndex,
  getRankFromRating,
  isGameplayMode,
  isPartyMode,
  type GameplayMode,
  type HeroId,
  type PartyMemberSnapshot,
  type PartyMode,
  type PartyStateSnapshot,
  type RankSummary,
} from '@voxel-strike/shared';

export interface PartyRuntimeMember {
  userId: string;
  sessionId: string;
  displayName: string;
  heroId: HeroId;
  ready: boolean;
  connected: boolean;
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
  private launchError: string | null = null;
  private readonly members = new Map<string, PartyRuntimeMember>();
  private readonly sessionToUserId = new Map<string, string>();

  constructor(partyId: string, maxMembers = DEFAULT_GAME_CONFIG.teamSize) {
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

  addMember(input: AddPartyMemberInput): PartyMemberChange {
    const existing = this.members.get(input.userId);
    if (!existing && this.members.size >= this.maxMembers) {
      throw new Error('Party is full');
    }

    const competitiveRating = input.competitiveRating ?? existing?.competitiveRating ?? 800;
    const member: PartyRuntimeMember = {
      userId: input.userId,
      sessionId: input.sessionId,
      displayName: input.displayName,
      heroId: input.heroId,
      ready: existing?.ready ?? false,
      connected: true,
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

    let leaderChanged = false;
    if (!this.leaderUserId) {
      this.leaderUserId = input.userId;
      leaderChanged = true;
    }

    this.launchError = null;
    return { member, replacedSessionId, leaderChanged };
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
      this.leaderUserId = this.members.keys().next().value ?? null;
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

  updateHero(userId: string, heroId: HeroId): PartyRuntimeMember | null {
    const member = this.members.get(userId);
    if (!member) return null;
    member.heroId = heroId;
    member.ready = false;
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
      if (member.userId !== this.leaderUserId) {
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

    const notReady = this.getMembers().find((member) => member.userId !== this.leaderUserId && !member.ready);
    if (notReady) {
      return { ok: false, message: `${notReady.displayName} is not ready` };
    }

    return { ok: true };
  }

  snapshot(): PartyStateSnapshot {
    return {
      partyId: this.partyId,
      leaderUserId: this.leaderUserId ?? '',
      selectedMode: this.selectedMode,
      gameplayMode: this.gameplayMode,
      members: this.getMembers().map((member): PartyMemberSnapshot => ({
        userId: member.userId,
        displayName: member.displayName,
        heroId: member.heroId,
        ready: member.ready,
        connected: member.connected,
        leader: member.userId === this.leaderUserId,
        rank: member.rank,
      })),
      launchError: this.launchError,
    };
  }
}
