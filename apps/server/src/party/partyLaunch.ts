import { matchMaker } from 'colyseus';
import {
  DEFAULT_GAMEPLAY_MODE,
  getRankDivisionIndex,
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

async function createMatchmakingLobby(input: {
  mode: 'quick_play' | 'ranked';
  lobbyName: string;
  matchmakingTicket: string;
  rankBandId: number;
}) {
  return matchMaker.createRoom('lobby_room', {
    lobbyName: input.lobbyName,
    isPrivate: false,
    matchmakingMode: true,
    matchMode: input.mode,
    matchmakingTicket: input.matchmakingTicket,
    rankBandId: input.rankBandId,
    initialBotCount: 0,
    botFillMode: 'manual',
    defaultBotDifficulty: 'normal',
  });
}

export async function launchPartyToMatchmaking(
  party: PartyRosterRuntime,
  mode: 'quick_play' | 'ranked'
): Promise<PartyLaunchResult> {
  const members = party.getMembers();
  if (members.length === 0) {
    throw new Error('Party is empty');
  }

  members.forEach(assertPartyTutorialComplete);
  const contexts = members.map(toMatchmakingContext);
  const targetRankDivisionIndex = await chooseMatchmakingRankBand(
    averageMatchmakingContext(contexts, mode)
  );

  const tickets = new Map<string, ReturnType<typeof issueQuickPlayTicket> | ReturnType<typeof issueRankedTicket>>();
  if (mode === 'ranked') {
    for (const context of contexts) {
      if (!context.walletAddress) {
        const member = members.find((candidate) => candidate.userId === context.userId);
        throw new Error(`${member?.displayName ?? 'A party member'} needs a linked Solana wallet for ranked`);
      }
      const tokenHold = await assertRankedTokenHoldingEligibility(context.walletAddress);
      tickets.set(context.userId, issueRankedTicket(context, targetRankDivisionIndex, tokenHold));
    }
  } else {
    for (const context of contexts) {
      tickets.set(context.userId, issueQuickPlayTicket(context, targetRankDivisionIndex));
    }
  }

  const firstTicket = tickets.values().next().value;
  if (!firstTicket) {
    throw new Error('Failed to issue party matchmaking tickets');
  }

  const room = await createMatchmakingLobby({
    mode,
    lobbyName: mode === 'ranked' ? 'Ranked' : 'Quick Play',
    matchmakingTicket: firstTicket.ticket,
    rankBandId: targetRankDivisionIndex,
  });

  const payloadsByUserId = new Map<string, PartyLaunchPayload>();
  for (const member of members) {
    const issued = tickets.get(member.userId);
    if (!issued) continue;
    payloadsByUserId.set(member.userId, {
      mode,
      lobbyId: room.roomId,
      matchMode: mode,
      gameplayMode: DEFAULT_GAMEPLAY_MODE,
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
  const members = party.getMembers();
  if (members.length === 0 || !party.leaderId) {
    throw new Error('Party is empty');
  }

  members.forEach(assertPartyTutorialComplete);

  const lobbyName = party.mode === 'practice' ? 'Party Practice' : 'Party Custom';
  const room = await matchMaker.createRoom('lobby_room', {
    lobbyName,
    isPrivate: true,
    initialBotCount: 0,
    botFillMode: 'manual',
    defaultBotDifficulty: 'normal',
    gameplayMode: party.selectedGameplayMode,
  });

  await createAcceptedLobbyInvites({
    lobbyId: room.roomId,
    lobbyName,
    matchMode: 'custom',
    leaderUserId: party.leaderId,
    members,
  });

  const payloadsByUserId = new Map<string, PartyLaunchPayload>();
  for (const member of members) {
    payloadsByUserId.set(member.userId, {
      mode: party.mode,
      lobbyId: room.roomId,
      matchMode: 'custom',
      gameplayMode: party.selectedGameplayMode,
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
