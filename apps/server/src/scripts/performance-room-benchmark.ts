import { performance } from 'node:perf_hooks';
import {
  HERO_DEFINITIONS,
  MOVEMENT_BUTTON_MOVE_FORWARD,
  MOVEMENT_BUTTON_MOVE_LEFT,
  MOVEMENT_BUTTON_SPRINT,
  movementButtonsToInputState,
  type PlayerMovementState,
  type MovementCommand,
} from '@voxel-strike/shared';
import {
  createVoxelCollisionWorld,
  simulateSharedMovement,
  type MovementTerrainAdapter,
  type SharedMovementSimulationResult,
} from '@voxel-strike/physics';
import { MovementCommandQueue } from '../rooms/MovementCommandQueue';
import { PlayerSpatialIndex } from '../rooms/PlayerSpatialIndex';
import { AntiCheatSignalPriorityQueue } from '../anticheat';
import { normalizeAntiCheatSignal } from '../anticheat/signal';
import { Player } from '../rooms/schema/Player';

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

function summarize(name: string, samples: number[]): Record<string, number | string> {
  samples.sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    name,
    iterations: samples.length,
    averageMs: total / Math.max(1, samples.length),
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    p99Ms: percentile(samples, 0.99),
  };
}

function command(seq: number, buttons = MOVEMENT_BUTTON_MOVE_FORWARD | MOVEMENT_BUTTON_SPRINT): MovementCommand {
  return {
    seq,
    buttons,
    lookYaw: Math.sin(seq / 30) * 0.45,
    lookPitch: 0,
    clientTimeMs: seq * (1000 / 60),
    movementEpoch: 0,
    collisionRevision: 1,
  };
}

function runMovementQueueBenchmark(): Record<string, number | string> {
  const samples: number[] = [];
  for (let iteration = 0; iteration < 600; iteration++) {
    const queue = new MovementCommandQueue(128);
    const startedAt = performance.now();
    for (let player = 0; player < 8; player++) {
      const base = player * 10000 + iteration * 128;
      for (let index = 0; index < 96; index++) {
        const jitter = index % 9 === 0 ? 1 : index % 11 === 0 ? -1 : 0;
        queue.push(command(base + index + jitter));
      }
      queue.dropOldest(Math.max(0, queue.length - 96));
      while (queue.pop()) {
        // Drain the queue to exercise head advancement.
      }
    }
    samples.push(performance.now() - startedAt);
  }
  return summarize('movement_queue_8_players_burst', samples);
}

function createMovementState(): PlayerMovementState {
  return {
    isGrounded: true,
    isSprinting: false,
    isCrouching: false,
    isSliding: false,
    slideTimeRemaining: 0,
    isWallRunning: false,
    wallRunSide: null,
    isGrappling: false,
    grapplePoint: null,
    isJetpacking: false,
    jetpackFuel: 100,
    isGliding: false,
  };
}

function runMovementSimulationBenchmark(): Record<string, number | string> {
  const terrain: MovementTerrainAdapter = {
    getGroundY: () => 0,
    clampPosition: (position) => ({
      x: Math.max(-90, Math.min(90, position.x)),
      y: Math.max(-20, Math.min(90, position.y)),
      z: Math.max(-90, Math.min(90, position.z)),
    }),
    getBlockAtWorld: (position) => (Math.abs(position.x - 10) < 0.7 && Math.abs(position.z) < 18 && position.y < 4 ? 1 : 0),
    cacheStaticAabbs: true,
    collisionRevision: 1,
  };
  const world = createVoxelCollisionWorld(terrain);
  const samples: number[] = [];
  const players: SharedMovementSimulationResult[] = Array.from({ length: 8 }, (_, index) => ({
    position: { x: -12 + index * 2, y: 0.9, z: index % 2 },
    velocity: { x: 0, y: 0, z: 0 },
    movement: createMovementState(),
  }));

  for (let iteration = 0; iteration < 420; iteration++) {
    const startedAt = performance.now();
    for (let playerIndex = 0; playerIndex < players.length; playerIndex++) {
      const state = players[playerIndex];
      const input = movementButtonsToInputState(
        MOVEMENT_BUTTON_MOVE_FORWARD |
        MOVEMENT_BUTTON_SPRINT |
        (iteration % 45 < 12 ? MOVEMENT_BUTTON_MOVE_LEFT : 0)
      );
      const result = simulateSharedMovement({
        position: state.position,
        velocity: state.velocity,
        movement: state.movement,
        heroStats: HERO_DEFINITIONS.phantom.stats,
        input,
        lookYaw: Math.sin((iteration + playerIndex) / 45) * 0.8,
        deltaTime: 1 / 60,
        terrain,
        collisionWorld: world,
      });
      players[playerIndex] = result;
    }
    samples.push(performance.now() - startedAt);
  }
  return summarize('shared_movement_8_players', samples);
}

function runSpatialBenchmark(): Record<string, number | string> {
  const index = new PlayerSpatialIndex(8);
  const players = Array.from({ length: 48 }, (_, itemIndex) => {
    const player = new Player();
    player.id = `player-${itemIndex}`;
    player.team = itemIndex % 2 === 0 ? 'red' : 'blue';
    player.state = 'alive';
    player.position.x = Math.cos(itemIndex) * 32;
    player.position.y = 1;
    player.position.z = Math.sin(itemIndex * 1.7) * 32;
    return player;
  });
  const out: Player[] = [];
  const samples: number[] = [];
  for (let iteration = 0; iteration < 800; iteration++) {
    const startedAt = performance.now();
    index.rebuild(players);
    for (let query = 0; query < 24; query++) {
      index.queryRadius({ x: Math.sin(query) * 22, z: Math.cos(query) * 22 }, 16, out, {
        team: query % 2 === 0 ? 'red' : 'blue',
      });
    }
    samples.push(performance.now() - startedAt);
  }
  return summarize('spatial_rebuild_and_queries', samples);
}

function runAntiCheatQueueBenchmark(): Record<string, number | string> {
  const queue = new AntiCheatSignalPriorityQueue();
  const samples: number[] = [];
  const change = {
    userId: null,
    playerSessionId: null,
    scoreBefore: 0,
    scoreAfter: 0,
    scoreDelta: 0,
    integrityStatus: 'clean' as const,
    casePriority: null,
    shouldCreateCase: false,
    affectsRankedOrWager: false,
  };

  for (let iteration = 0; iteration < 600; iteration++) {
    const startedAt = performance.now();
    for (let index = 0; index < 500; index++) {
      const high = index % 97 === 0;
      queue.push({
        signal: normalizeAntiCheatSignal({
          eventType: high ? 'movement.critical' : 'movement.noise',
          category: 'movement',
          source: 'benchmark',
          roomId: 'benchmark-room',
          matchMode: 'ranked',
          severity: high ? 'critical' : 'low',
          confidence: high ? 1 : 0.35,
        }),
        change,
        queuedAt: Date.now(),
        resolve: () => undefined,
      }, high);
    }
    while (queue.shift()) {
      // Drain priority lanes.
    }
    samples.push(performance.now() - startedAt);
  }
  return summarize('anti_cheat_priority_queue_noise', samples);
}

const results = [
  runMovementQueueBenchmark(),
  runMovementSimulationBenchmark(),
  runSpatialBenchmark(),
  runAntiCheatQueueBenchmark(),
];

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  results,
}, null, 2));
