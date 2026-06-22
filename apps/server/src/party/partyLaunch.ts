import { matchMaker } from 'colyseus';
import {
  DEFAULT_GAMEPLAY_MODE,
  DEFAULT_MATCH_PERSPECTIVE,
  getGameplayModeLabel,
  getRankDivisionIndex,
  isCustomLobbyGameplayMode,
  type GameplayMode,
  type MatchPerspective,
  type PartyBotLaunchDescriptor,
  type PartyLaunchPayload,
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
    difficulty: member.botDifficulty ?? 'normal',
  };
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
    defaultBotDifficulty: 'normal',
    partyBots: input.partyBots,
  });
}

export async function launchPartyToMatchmaking(
  party: PartyRosterRuntime,
  mode: 'quick_play' | 'ranked'
): Promise<PartyLaunchResult> {
  const humanMembers = party.getHumanMembers();
  const partyBots = party.getBotMembers().map(toPartyBotDescriptor);
  if (humanMembers.length === 0) {
    throw new Error('Party is empty');
  }

  humanMembers.forEach(assertPartyTutorialComplete);
  const contexts = humanMembers.map(toMatchmakingContext);
  const gameplayMode = mode === 'ranked' ? DEFAULT_GAMEPLAY_MODE : party.selectedGameplayMode;
  const botFillMode: MatchmakingBotFillMode = mode === 'quick_play' && party.getBotFillEnabled(gameplayMode)
    ? 'fill_even'
    : 'manual';
  const matchPerspective = mode === 'ranked'
    ? DEFAULT_MATCH_PERSPECTIVE
    : party.getActiveMatchPerspective('quick_play', gameplayMode);
  const targetRankDivisionIndex = await chooseMatchmakingRankBand({
    ...averageMatchmakingContext(contexts, mode),
    gameplayMode,
    botFillMode,
    matchPerspective,
  });

  const tickets = new Map<string, ReturnType<typeof issueQuickPlayTicket> | ReturnType<typeof issueRankedTicket>>();
  if (mode === 'ranked') {
    for (const context of contexts) {
      if (!context.walletAddress) {
        const member = humanMembers.find((candidate) => candidate.userId === context.userId);
        throw new Error(`${member?.displayName ?? 'A party member'} needs a linked Solana wallet for ranked`);
      }
      const tokenHold = await assertRankedTokenHoldingEligibility(context.walletAddress);
      tickets.set(context.userId, issueRankedTicket(context, targetRankDivisionIndex, tokenHold));
    }
  } else {
    for (const context of contexts) {
      tickets.set(context.userId, issueQuickPlayTicket(context, targetRankDivisionIndex, {
        gameplayMode,
        botFillMode,
        matchPerspective,
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

export async function launchPartyToCustomLobby(party: PartyRosterRuntime): Promise<PartyLaunchResult> {
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
  const lobbyName = party.mode === 'practice'
    ? 'Party Practice'
    : `Custom ${getGameplayModeLabel(gameplayMode)}`;
  const matchPerspective = party.mode === 'practice'
    ? party.getActiveMatchPerspective('practice', party.selectedGameplayMode)
    : party.getActiveMatchPerspective('custom', gameplayMode);
  const room = await matchMaker.createRoom('lobby_room', {
    lobbyName,
    isPrivate: true,
    initialBotCount: 0,
    botFillMode: 'manual',
    defaultBotDifficulty: 'normal',
    partyBots,
    gameplayMode,
    matchPerspective,
  });

  await createAcceptedLobbyInvites({
    lobbyId: room.roomId,
    lobbyName,
    matchMode: 'custom',
    leaderUserId: party.leaderId,
    members: humanMembers,
  });

  const payloadsByUserId = new Map<string, PartyLaunchPayload>();
  for (const member of humanMembers) {
    payloadsByUserId.set(member.userId, {
      mode: party.mode,
      lobbyId: room.roomId,
      matchMode: 'custom',
      gameplayMode,
      botFillMode: 'manual',
      matchPerspective,
      selectedHero: member.heroId,
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
