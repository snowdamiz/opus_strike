import { matchMaker } from 'colyseus';
import {
  DEFAULT_GAMEPLAY_MODE,
  DEFAULT_MATCH_PERSPECTIVE,
  RANKED_GAMEPLAY_MODE,
  getGameplayModeLabel,
  getRankDivisionIndex,
  isCustomLobbyGameplayMode,
  type GameplayMode,
  type MatchPerspective,
  type PartyBotLaunchDescriptor,
  type PartyLaunchPayload,
  type PartyLaunchWagerOptions,
} from '@voxel-strike/shared';
import type { MatchMode } from '@voxel-strike/shared';
import prisma from '../db';
import { assertTutorialCompleted } from '../auth/tutorialCompletion';
import {
  assertRankedTokenHoldingEligibility,
} from '../matchmaking/rankedTokenHold';
import {
  averageMatchmakingContext,
  chooseMatchmakingRankBand,
  issueQuickPlayTicket,
  issueRankedTicket,
  type MatchmakingUserContext,
} from '../matchmaking/service';
import type { MatchmakingBotFillMode } from '../matchmaking/matchSettings';
import { RANKED_BOT_FILL_MODE } from '../matchmaking/matchSettings';
import { getLocalMatchmakingRegion } from '../matchmaking/region';
import { resolveUserLoadoutForHero } from '../cosmetics/skinShopService';
import { BOT_RANKED_BATTLE_ROYAL_PROFILE_PREFIX } from '../rooms/bot-ai';
import { wagerService } from '../wagers/service';
import type { PartyRosterRuntime, PartyRuntimeMember } from './partyRuntime';

interface PartyLaunchResult {
  lobbyId: string;
  payloadsByUserId: Map<string, PartyLaunchPayload>;
}

function toMatchmakingContext(member: PartyRuntimeMember): MatchmakingUserContext {
  return {
    userId: member.userId,
    walletAddress: member.walletAddress,
    competitiveRating: member.competitiveRating,
    rankDivisionIndex: member.rankDivisionIndex,
    tutorialCompletedAt: member.tutorialCompletedAt,
    rank: {
      competitiveRating: member.competitiveRating,
      rankedGames: 0,
      rankedWins: 0,
      rankedLosses: 0,
      rankedDraws: 0,
      rankedPlacementsRemaining: member.rankedPlacementsRemaining,
      rankedLastMatchAt: null,
      current: member.rank,
      peak: member.rank,
      progress: member.rank.progress,
    },
  };
}

function assertPartyTutorialComplete(member: PartyRuntimeMember): void {
  assertTutorialCompleted(member.tutorialCompletedAt, {
    devBypass: member.devTutorialBypass,
  });
}

function toPartyBotDescriptor(member: PartyRuntimeMember): PartyBotLaunchDescriptor {
  return {
    displayName: member.displayName,
    heroId: member.heroId,
    skinId: member.skinId,
    difficulty: member.botDifficulty ?? 'normal',
  };
}

async function revalidateHumanMemberSkins(party: PartyRosterRuntime): Promise<void> {
  for (const member of party.getHumanMembers()) {
    const skinId = await resolveUserLoadoutForHero(member.userId, member.heroId, member.skinId);
    if (skinId !== member.skinId) {
      party.updateSkin(member.userId, skinId);
    }
  }
}

async function createMatchmakingLobby(input: {
  mode: 'quick_play' | 'ranked';
  lobbyName: string;
  gameplayMode: GameplayMode;
  matchmakingTicket: string;
  rankBandId: number;
  partyLeaderUserId: string;
  partyBots: PartyBotLaunchDescriptor[];
  botFillMode: MatchmakingBotFillMode;
  matchPerspective: MatchPerspective;
  matchmakingRegion?: string;
  expectedHumanPlayers: number;
  expectedHumanUserIds: string[];
}) {
  return matchMaker.createRoom('lobby_room', {
    lobbyName: input.lobbyName,
    isPrivate: false,
    matchmakingMode: true,
    matchMode: input.mode,
    gameplayMode: input.gameplayMode,
    matchmakingTicket: input.matchmakingTicket,
    rankBandId: input.rankBandId,
    expectedPartyLeaderUserId: input.partyLeaderUserId,
    expectedHumanPlayers: input.expectedHumanPlayers,
    expectedHumanUserIds: input.expectedHumanUserIds,
    initialBotCount: 0,
    botFillMode: input.botFillMode,
    matchPerspective: input.matchPerspective,
    matchmakingRegion: input.matchmakingRegion,
    defaultBotDifficulty: input.mode === 'ranked' ? 'hard' : 'normal',
    botProfilePrefix: input.mode === 'ranked' ? BOT_RANKED_BATTLE_ROYAL_PROFILE_PREFIX : undefined,
    partyBots: input.partyBots,
  });
}

export async function launchPartyToMatchmaking(
  party: PartyRosterRuntime,
  mode: 'quick_play' | 'ranked'
): Promise<PartyLaunchResult> {
  await revalidateHumanMemberSkins(party);
  const humanMembers = party.getHumanMembers();
  const partyBots = mode === 'ranked' ? [] : party.getBotMembers().map(toPartyBotDescriptor);
  if (humanMembers.length === 0) {
    throw new Error('Party is empty');
  }

  humanMembers.forEach(assertPartyTutorialComplete);
  const contexts = humanMembers.map(toMatchmakingContext);
  const gameplayMode = mode === 'ranked' ? RANKED_GAMEPLAY_MODE : party.selectedGameplayMode;
  const botFillMode: MatchmakingBotFillMode = mode === 'ranked'
    ? RANKED_BOT_FILL_MODE
    : party.getBotFillEnabled(gameplayMode)
      ? 'fill_even'
      : 'manual';
  const matchPerspective = mode === 'ranked'
    ? DEFAULT_MATCH_PERSPECTIVE
    : party.getActiveMatchPerspective('quick_play', gameplayMode);
  const matchmakingRegion = getLocalMatchmakingRegion();
  const targetRankDivisionIndex = await chooseMatchmakingRankBand({
    ...averageMatchmakingContext(contexts, mode),
    gameplayMode,
    botFillMode,
    matchPerspective,
    matchmakingRegion,
  });

  const tickets = new Map<string, ReturnType<typeof issueQuickPlayTicket> | ReturnType<typeof issueRankedTicket>>();
  if (mode === 'ranked') {
    for (const context of contexts) {
      const tokenHold = await assertRankedTokenHoldingEligibility(context.walletAddress);
      const member = humanMembers.find((candidate) => candidate.userId === context.userId);
      tickets.set(context.userId, issueRankedTicket(
        context,
        targetRankDivisionIndex,
        tokenHold,
        member?.heroId,
        member?.skinId,
        matchmakingRegion
      ));
    }
  } else {
    for (const context of contexts) {
      const member = humanMembers.find((candidate) => candidate.userId === context.userId);
      tickets.set(context.userId, issueQuickPlayTicket(context, targetRankDivisionIndex, {
        gameplayMode,
        botFillMode,
        matchPerspective,
        selectedHero: member?.heroId,
        selectedSkinId: member?.skinId,
        matchmakingRegion,
      }));
    }
  }

  const firstTicket = tickets.values().next().value;
  if (!firstTicket) {
    throw new Error('Failed to issue party matchmaking tickets');
  }

  const room = await createMatchmakingLobby({
    mode,
    lobbyName: mode === 'ranked'
      ? 'Ranked'
      : gameplayMode === DEFAULT_GAMEPLAY_MODE
        ? getGameplayModeLabel(DEFAULT_GAMEPLAY_MODE)
        : getGameplayModeLabel(gameplayMode),
    gameplayMode,
    matchmakingTicket: firstTicket.ticket,
    rankBandId: targetRankDivisionIndex,
    partyLeaderUserId: party.leaderId ?? humanMembers[0].userId,
    partyBots,
    botFillMode,
    matchPerspective,
    matchmakingRegion,
    expectedHumanPlayers: humanMembers.length,
    expectedHumanUserIds: humanMembers.map((member) => member.userId),
  });

  const payloadsByUserId = new Map<string, PartyLaunchPayload>();
  for (const member of humanMembers) {
    const issued = tickets.get(member.userId);
    if (!issued) continue;
    payloadsByUserId.set(member.userId, {
      mode,
      lobbyId: room.roomId,
      matchMode: mode,
      gameplayMode,
      botFillMode,
      matchPerspective,
      selectedHero: member.heroId,
      selectedSkinId: member.skinId,
      matchmakingTicket: issued.ticket,
      targetRankDivisionIndex,
      targetRankLabel: issued.targetRankLabel,
    });
  }

  return { lobbyId: room.roomId, payloadsByUserId };
}

async function createAcceptedLobbyInvites(input: {
  lobbyId: string;
  lobbyName: string;
  matchMode: MatchMode;
  leaderUserId: string;
  members: PartyRuntimeMember[];
}): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
  await prisma.lobbyInvite.createMany({
    data: input.members.map((member) => ({
      lobbyId: input.lobbyId,
      lobbyName: input.lobbyName,
      matchMode: input.matchMode,
      fromUserId: input.leaderUserId,
      toUserId: member.userId,
      status: 'accepted',
      expiresAt,
      respondedAt: now,
    })),
  });
}

async function normalizeCustomWagerOptions(
  wager: PartyLaunchWagerOptions | undefined
): Promise<PartyLaunchWagerOptions | undefined> {
  const normalized = await wagerService.normalizeCreateOptions(wager);
  if (!normalized.enabled) return undefined;
  return {
    enabled: true,
    coverChargeLamports: normalized.coverChargeLamports.toString(),
    token: normalized.token,
  };
}

export async function launchPartyToCustomLobby(
  party: PartyRosterRuntime,
  options: { wager?: PartyLaunchWagerOptions } = {}
): Promise<PartyLaunchResult> {
  await revalidateHumanMemberSkins(party);
  const humanMembers = party.getHumanMembers();
  const partyBots = party.getBotMembers().map(toPartyBotDescriptor);
  if (humanMembers.length === 0 || !party.leaderId) {
    throw new Error('Party is empty');
  }
  if (party.mode === 'custom' && !isCustomLobbyGameplayMode(party.selectedGameplayMode)) {
    throw new Error('Custom lobbies support Capture the Flag or Team Deathmatch');
  }

  humanMembers.forEach(assertPartyTutorialComplete);

  const gameplayMode = party.selectedGameplayMode;
  const wager = party.mode === 'custom'
    ? await normalizeCustomWagerOptions(options.wager)
    : undefined;
  const matchMode: MatchMode = wager ? 'custom_wager' : 'custom';
  const lobbyName = party.mode === 'practice'
    ? 'Party Practice'
    : wager
      ? `Wager ${getGameplayModeLabel(gameplayMode)}`
      : `Custom ${getGameplayModeLabel(gameplayMode)}`;
  const matchPerspective = party.mode === 'practice'
    ? party.getActiveMatchPerspective('practice', party.selectedGameplayMode)
    : party.getActiveMatchPerspective('custom', gameplayMode);
  const room = await matchMaker.createRoom('lobby_room', {
    lobbyName,
    isPrivate: true,
    matchMode,
    initialBotCount: 0,
    botFillMode: 'manual',
    defaultBotDifficulty: 'normal',
    partyBots,
    gameplayMode,
    matchPerspective,
    wager,
  });

  await createAcceptedLobbyInvites({
    lobbyId: room.roomId,
    lobbyName,
    matchMode,
    leaderUserId: party.leaderId,
    members: humanMembers,
  });

  const payloadsByUserId = new Map<string, PartyLaunchPayload>();
  for (const member of humanMembers) {
    payloadsByUserId.set(member.userId, {
      mode: party.mode,
      lobbyId: room.roomId,
      matchMode,
      gameplayMode,
      botFillMode: 'manual',
      matchPerspective,
      ...(wager ? { wager } : {}),
      selectedHero: member.heroId,
      selectedSkinId: member.skinId,
    });
  }

  return { lobbyId: room.roomId, payloadsByUserId };
}

export function averagePartyRatingDivision(members: PartyRuntimeMember[]): number {
  if (members.length === 0) return 0;
  const averageRating = Math.round(
    members.reduce((total, member) => total + member.competitiveRating, 0) / members.length
  );
  return getRankDivisionIndex(averageRating);
}
