import assert from 'node:assert/strict';
import {
  ROUND_END_INTERMISSION_MS,
  buildBattleRoyalDeploymentPhaseStatePatch,
  buildCountdownPhaseStatePatch,
  buildDevTimeFreezeStatePatch,
  buildGameEndPhaseStatePatch,
  buildHeroSelectPhaseStatePatch,
  buildPhaseChangePayload,
  buildPlayingPhaseStatePatch,
  buildRoundEndPhaseStatePatch,
  buildRoundEndPayload,
  getNextRoundEndPhase,
  getRoomRoundTimeRemaining,
  hasPhaseDeadlineElapsed,
  shouldAutoReadyHeroSelectPhase,
  shouldRunHeroSelectPhaseTransitionCheck,
  shouldStartHeroSelectPhase,
} from '../rooms/roomPhaseRuntime';

{
  assert.equal(hasPhaseDeadlineElapsed(0, 1_000), false);
  assert.equal(hasPhaseDeadlineElapsed(1_001, 1_000), false);
  assert.equal(hasPhaseDeadlineElapsed(1_000, 1_000), true);
  assert.equal(hasPhaseDeadlineElapsed(999, 1_000), true);
}

{
  assert.equal(shouldStartHeroSelectPhase({
    playerCount: 0,
    hasRequiredHumanPlayersConnected: true,
  }), false);
  assert.equal(shouldStartHeroSelectPhase({
    playerCount: 1,
    hasRequiredHumanPlayersConnected: false,
  }), false);
  assert.equal(shouldStartHeroSelectPhase({
    playerCount: 1,
    hasRequiredHumanPlayersConnected: true,
  }), true);

  assert.equal(shouldAutoReadyHeroSelectPhase({
    phaseEndTime: 0,
    now: 1_000,
  }), false);
  assert.equal(shouldAutoReadyHeroSelectPhase({
    phaseEndTime: 1_001,
    now: 1_000,
  }), false);
  assert.equal(shouldAutoReadyHeroSelectPhase({
    phaseEndTime: 1_000,
    now: 1_000,
  }), true);

  assert.equal(shouldRunHeroSelectPhaseTransitionCheck({
    lowFrequencyStateDue: false,
    phaseEndTime: 1_001,
    now: 1_000,
  }), false);
  assert.equal(shouldRunHeroSelectPhaseTransitionCheck({
    lowFrequencyStateDue: true,
    phaseEndTime: 1_001,
    now: 1_000,
  }), false);
  assert.equal(shouldRunHeroSelectPhaseTransitionCheck({
    lowFrequencyStateDue: false,
    phaseEndTime: 1_000,
    now: 1_000,
  }), false);
  assert.equal(shouldRunHeroSelectPhaseTransitionCheck({
    lowFrequencyStateDue: true,
    phaseEndTime: 1_000,
    now: 1_000,
  }), true);
}

{
  assert.equal(
    getRoomRoundTimeRemaining({
      roundStartTime: 0,
      roundTimeRemaining: 42,
      roundTimeSeconds: 300,
      now: 5_000,
    }),
    42
  );
  assert.equal(
    getRoomRoundTimeRemaining({
      roundStartTime: 10_000,
      roundTimeRemaining: 300,
      roundTimeSeconds: 300,
      now: 9_000,
    }),
    300
  );
  assert.equal(
    getRoomRoundTimeRemaining({
      roundStartTime: 10_000,
      roundTimeRemaining: 300,
      roundTimeSeconds: 300,
      now: 70_000,
    }),
    240
  );
  assert.equal(
    getRoomRoundTimeRemaining({
      roundStartTime: 10_000,
      roundTimeRemaining: 300,
      roundTimeSeconds: 300,
      now: 400_000,
    }),
    0
  );
}

{
  assert.deepEqual(
    buildDevTimeFreezeStatePatch({
      enabled: true,
      roundStartTime: 10_000,
      roundTimeRemaining: 300,
      roundTimeSeconds: 300,
      now: 70_000,
    }),
    {
      gameClockFrozen: true,
      roundTimeRemaining: 240,
      phaseEndTime: 310_000,
    }
  );
  assert.deepEqual(
    buildDevTimeFreezeStatePatch({
      enabled: true,
      roundStartTime: 0,
      roundTimeRemaining: 42,
      roundTimeSeconds: 300,
      now: 70_000,
    }),
    {
      gameClockFrozen: true,
      roundTimeRemaining: 42,
    }
  );
  assert.deepEqual(
    buildDevTimeFreezeStatePatch({
      enabled: false,
      roundStartTime: 10_000,
      roundTimeRemaining: 180,
      roundTimeSeconds: 300,
      now: 200_000,
    }),
    {
      gameClockFrozen: false,
      roundStartTime: 80_000,
      phaseEndTime: 380_000,
    }
  );
  assert.deepEqual(
    buildDevTimeFreezeStatePatch({
      enabled: false,
      roundStartTime: 0,
      roundTimeRemaining: 180,
      roundTimeSeconds: 300,
      now: 200_000,
    }),
    {
      gameClockFrozen: false,
    }
  );
}

{
  assert.deepEqual(
    buildHeroSelectPhaseStatePatch({
      now: 10_000,
      durationSeconds: 30,
    }),
    {
      phase: 'hero_select',
      phaseEndTime: 40_000,
    }
  );
  assert.deepEqual(
    buildCountdownPhaseStatePatch({
      now: 20_000,
      durationSeconds: 5,
    }),
    {
      phase: 'countdown',
      phaseEndTime: 25_000,
    }
  );
  assert.deepEqual(
    buildBattleRoyalDeploymentPhaseStatePatch({
      now: 25_000,
      durationMs: 60_000,
    }),
    {
      phase: 'deployment',
      phaseEndTime: 85_000,
    }
  );
  assert.deepEqual(
    buildPlayingPhaseStatePatch({
      now: 30_000,
      roundTimeSeconds: 300,
    }),
    {
      phase: 'playing',
      phaseEndTime: 330_000,
      roundStartTime: 30_000,
      roundTimeRemaining: 300,
    }
  );
  assert.deepEqual(
    buildRoundEndPhaseStatePatch({ now: 40_000 }),
    {
      phase: 'round_end',
      phaseEndTime: 40_000 + ROUND_END_INTERMISSION_MS,
    }
  );
  assert.deepEqual(
    buildRoundEndPhaseStatePatch({ now: 40_000, intermissionMs: 123 }),
    {
      phase: 'round_end',
      phaseEndTime: 40_123,
    }
  );
  assert.deepEqual(buildGameEndPhaseStatePatch(), {
    phase: 'game_end',
    phaseEndTime: 0,
    roundTimeRemaining: 0,
  });
}

{
  assert.deepEqual(
    buildPhaseChangePayload({
      phase: 'countdown',
      endTime: 12_345,
      mapSeed: 99,
      mapThemeId: 'verdant',
      mapSize: 'medium',
    }),
    {
      phase: 'countdown',
      endTime: 12_345,
      mapSeed: 99,
      mapThemeId: 'verdant',
      mapSize: 'medium',
      mapProfileId: 'ctf_arena',
    }
  );
}

{
  assert.equal(getNextRoundEndPhase({
    gameplayMode: 'capture_the_flag',
    redScore: 2,
    blueScore: 1,
    scoreToWin: 3,
  }), 'hero_select');
  assert.equal(getNextRoundEndPhase({
    gameplayMode: 'capture_the_flag',
    redScore: 3,
    blueScore: 1,
    scoreToWin: 3,
  }), 'game_end');
  assert.equal(getNextRoundEndPhase({
    gameplayMode: 'team_deathmatch',
    redScore: 0,
    blueScore: 0,
    scoreToWin: 50,
  }), 'game_end');
}

{
  assert.deepEqual(
    buildRoundEndPayload({
      gameplayMode: 'capture_the_flag',
      redScore: 2,
      blueScore: 3,
      scoreToWin: 5,
    }),
    {
      winningTeam: 'blue',
      redScore: 2,
      blueScore: 3,
      nextPhase: 'hero_select',
    }
  );
  assert.deepEqual(
    buildRoundEndPayload({
      gameplayMode: 'capture_the_flag',
      redScore: 4,
      blueScore: 4,
      scoreToWin: 4,
    }),
    {
      winningTeam: null,
      redScore: 4,
      blueScore: 4,
      nextPhase: 'game_end',
    }
  );
}

console.log('room phase runtime tests passed');
