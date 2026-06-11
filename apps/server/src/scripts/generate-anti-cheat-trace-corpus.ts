import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { simulateSharedMovement, type MovementTerrainAdapter } from '@voxel-strike/physics';
import {
  ANTI_CHEAT_MOVEMENT_TRACE_VERSION,
  MOVEMENT_BUTTON_CROUCH,
  MOVEMENT_BUTTON_JUMP,
  MOVEMENT_BUTTON_MOVE_FORWARD,
  MOVEMENT_BUTTON_MOVE_RIGHT,
  MOVEMENT_BUTTON_SPRINT,
  MOVEMENT_SUBSTEP_SECONDS,
  PLAYER_HEIGHT,
  getHeroStats,
  movementButtonsToInputState,
  type AntiCheatMovementTrace,
  type AntiCheatMovementTraceFrame,
  type AntiCheatTraceAbilityState,
  type AntiCheatTraceTerrainProfile,
  type HeroId,
  type MovementCommand,
  type MovementCorrectionReason,
  type PlayerMovementState,
  type Vec3,
} from '@voxel-strike/shared';
import { writeMovementTrace } from '../anticheat/trace';

interface LegalStep {
  buttons: number;
  frames: number;
  lookYaw?: number;
  activeSpeedMultiplier?: number;
  flagCarrier?: boolean;
  abilityIds?: string[];
  terrainProfile?: AntiCheatTraceTerrainProfile;
  movementPatch?: Partial<PlayerMovementState>;
  barrier?: {
    reason: MovementCorrectionReason;
    position?: Vec3;
    velocity?: Vec3;
    movementPatch?: Partial<PlayerMovementState>;
  };
}

interface TraceOptions {
  id: string;
  heroId: HeroId;
  movementClass: string;
  smoke?: boolean;
  expectedCorrections?: MovementCorrectionReason[];
  steps: LegalStep[];
}

const TRACE_ROOT = join(__dirname, 'fixtures', 'anti-cheat-traces');
const PRIVACY = {
  excludesNames: true,
  excludesWallets: true,
  excludesRawNetworkIds: true,
  excludesSecrets: true,
} as const;
const PLAYER_HALF_HEIGHT = PLAYER_HEIGHT / 2;
const FLAT_TERRAIN: MovementTerrainAdapter = {
  getGroundY: () => 0,
  clampPosition: (position) => ({ ...position }),
};

function vec(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function defaultMovement(): PlayerMovementState {
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

function cloneMovement(movement: PlayerMovementState): PlayerMovementState {
  return {
    ...movement,
    grapplePoint: movement.grapplePoint ? { ...movement.grapplePoint } : null,
  };
}

function movementBarrier(reason: MovementCorrectionReason | undefined): AntiCheatTraceAbilityState['movementBarrier'] {
  return reason === 'respawn' ||
    reason === 'teleport' ||
    reason === 'knockback' ||
    reason === 'unstuck'
    ? reason
    : null;
}

function frameFromState(input: {
  seq: number;
  heroId: HeroId;
  movementClass: string;
  position: Vec3;
  velocity: Vec3;
  movement: PlayerMovementState;
  buttons: number;
  lookYaw: number;
  activeAbilityState: AntiCheatTraceAbilityState;
  flagCarrier: boolean;
  terrainProfile: AntiCheatTraceTerrainProfile;
  correctionReason?: MovementCorrectionReason;
  objectiveSuppressed?: boolean;
}): AntiCheatMovementTraceFrame {
  const clientTimeMs = input.seq * (1000 / 60);
  const command: MovementCommand = {
    seq: input.seq,
    buttons: input.buttons,
    lookYaw: input.lookYaw,
    lookPitch: 0,
    clientTimeMs,
    movementEpoch: 0,
    collisionRevision: 0,
  };

  return {
    seq: input.seq,
    command,
    clientTimeMs,
    rapierPosition: { ...input.position },
    rapierVelocity: { ...input.velocity },
    movement: cloneMovement(input.movement),
    playerState: 'alive',
    health: 100,
    flagCarrier: input.flagCarrier,
    activeAbilityState: input.activeAbilityState,
    terrainContact: {
      profile: input.terrainProfile,
      isGrounded: input.movement.isGrounded,
      groundY: input.movement.isGrounded ? 0 : null,
      blockedAhead: input.terrainProfile === 'blocked_wall',
      collisionRevision: 0,
      mapSeed: 20260611,
    },
    latestServerAck: {
      ackSeq: Math.max(0, input.seq - 1),
      movementEpoch: 0,
      correctionReason: input.correctionReason,
    },
    movementEpoch: 0,
    objectiveSuppressed: input.objectiveSuppressed ?? false,
    correctionReason: input.correctionReason,
  };
}

function buildLegalTrace(options: TraceOptions): AntiCheatMovementTrace {
  const frames: AntiCheatMovementTraceFrame[] = [];
  let seq = 0;
  let position = vec(0, PLAYER_HALF_HEIGHT, 0);
  let velocity = vec(0, 0, 0);
  let movement = defaultMovement();

  frames.push(frameFromState({
    seq,
    heroId: options.heroId,
    movementClass: options.movementClass,
    position,
    velocity,
    movement,
    buttons: 0,
    lookYaw: 0,
    activeAbilityState: { activeAbilityIds: [], activeSpeedMultiplier: 1, movementBarrier: null },
    flagCarrier: false,
    terrainProfile: 'flat',
  }));

  for (const step of options.steps) {
    for (let index = 0; index < step.frames; index++) {
      seq++;
      const abilityState: AntiCheatTraceAbilityState = {
        activeAbilityIds: step.abilityIds ?? [],
        activeSpeedMultiplier: step.activeSpeedMultiplier ?? 1,
        movementBarrier: movementBarrier(step.barrier?.reason),
      };

      if (step.movementPatch) {
        movement = { ...movement, ...step.movementPatch };
      }

      if (step.barrier && index === 0) {
        position = step.barrier.position ? { ...step.barrier.position } : position;
        velocity = step.barrier.velocity ? { ...step.barrier.velocity } : velocity;
        movement = { ...movement, ...(step.barrier.movementPatch ?? {}) };
        frames.push(frameFromState({
          seq,
          heroId: options.heroId,
          movementClass: options.movementClass,
          position,
          velocity,
          movement,
          buttons: step.buttons,
          lookYaw: step.lookYaw ?? 0,
          activeAbilityState: abilityState,
          flagCarrier: step.flagCarrier ?? false,
          terrainProfile: step.terrainProfile ?? 'flat',
          correctionReason: step.barrier.reason,
        }));
        continue;
      }

      const result = simulateSharedMovement({
        position,
        velocity,
        movement,
        heroStats: getHeroStats(options.heroId),
        input: movementButtonsToInputState(step.buttons),
        lookYaw: step.lookYaw ?? 0,
        deltaTime: MOVEMENT_SUBSTEP_SECONDS,
        terrain: FLAT_TERRAIN,
        flagCarrier: step.flagCarrier ?? false,
        activeSpeedMultiplier: step.activeSpeedMultiplier ?? 1,
      });
      position = result.position;
      velocity = result.velocity;
      movement = result.movement;

      frames.push(frameFromState({
        seq,
        heroId: options.heroId,
        movementClass: options.movementClass,
        position,
        velocity,
        movement,
        buttons: step.buttons,
        lookYaw: step.lookYaw ?? 0,
        activeAbilityState: abilityState,
        flagCarrier: step.flagCarrier ?? false,
        terrainProfile: step.terrainProfile ?? 'flat',
      }));
    }
  }

  return {
    version: ANTI_CHEAT_MOVEMENT_TRACE_VERSION,
    traceId: options.id,
    createdAt: '2026-06-11T12:00:00.000Z',
    kind: 'legal',
    recordedBy: 'fixture_generator',
    heroId: options.heroId,
    matchMode: options.smoke ? 'ranked' : 'custom',
    movementClass: options.movementClass,
    mapSeed: 20260611,
    frameRateBand: '60fps',
    pingBandMs: '0-50',
    privacy: PRIVACY,
    frames,
    expected: {
      maxPositionDriftMeters: 0.002,
      maxVelocityDriftMetersPerSecond: 0.002,
      maxMovementStateMismatches: 0,
      maxUnexpectedCorrections: 0,
      allowedCorrectionReasons: options.expectedCorrections ?? [],
    },
  };
}

function maliciousTrace(input: {
  id: string;
  heroId: HeroId;
  movementClass: string;
  expectedReason: AntiCheatMovementTrace['expected']['maliciousExpectedReason'];
  frame: Partial<AntiCheatMovementTraceFrame> & {
    position: Vec3;
    velocity: Vec3;
    seq?: number;
    movementEpoch?: number;
    terrainProfile?: AntiCheatTraceTerrainProfile;
    objectiveSuppressed?: boolean;
  };
}): AntiCheatMovementTrace {
  const movement = defaultMovement();
  const first = frameFromState({
    seq: 0,
    heroId: input.heroId,
    movementClass: input.movementClass,
    position: vec(0, PLAYER_HALF_HEIGHT, 0),
    velocity: vec(0, 0, 0),
    movement,
    buttons: 0,
    lookYaw: 0,
    activeAbilityState: { activeAbilityIds: [], activeSpeedMultiplier: 1, movementBarrier: null },
    flagCarrier: false,
    terrainProfile: 'flat',
  });
  const second = frameFromState({
    seq: input.frame.seq ?? 1,
    heroId: input.heroId,
    movementClass: input.movementClass,
    position: input.frame.position,
    velocity: input.frame.velocity,
    movement,
    buttons: MOVEMENT_BUTTON_MOVE_FORWARD,
    lookYaw: 0,
    activeAbilityState: { activeAbilityIds: [], activeSpeedMultiplier: 1, movementBarrier: null },
    flagCarrier: false,
    terrainProfile: input.frame.terrainProfile ?? 'flat',
    objectiveSuppressed: input.frame.objectiveSuppressed,
  });
  second.command.seq = input.frame.seq ?? second.command.seq;
  second.command.movementEpoch = input.frame.movementEpoch ?? second.command.movementEpoch;
  second.movementEpoch = second.command.movementEpoch;

  return {
    version: ANTI_CHEAT_MOVEMENT_TRACE_VERSION,
    traceId: input.id,
    createdAt: '2026-06-11T12:00:00.000Z',
    kind: 'malicious',
    recordedBy: 'fixture_generator',
    heroId: input.heroId,
    matchMode: 'ranked',
    movementClass: input.movementClass,
    mapSeed: 20260611,
    frameRateBand: '60fps',
    pingBandMs: '0-50',
    privacy: PRIVACY,
    frames: [first, second],
    expected: {
      maxPositionDriftMeters: 100,
      maxVelocityDriftMetersPerSecond: 100,
      maxMovementStateMismatches: 1,
      maxUnexpectedCorrections: 0,
      allowedCorrectionReasons: [],
      maliciousExpectedReason: input.expectedReason,
    },
  };
}

function writeTrace(group: 'smoke' | 'full' | 'malicious', fileName: string, trace: AntiCheatMovementTrace): void {
  const dir = join(TRACE_ROOT, group);
  mkdirSync(dir, { recursive: true });
  writeMovementTrace(join(dir, fileName), trace);
}

const FORWARD = MOVEMENT_BUTTON_MOVE_FORWARD;
const SPRINT_FORWARD = MOVEMENT_BUTTON_MOVE_FORWARD | MOVEMENT_BUTTON_SPRINT;

const legalTraces: Array<{ group: 'smoke' | 'full'; file: string; trace: AntiCheatMovementTrace }> = [
  {
    group: 'smoke',
    file: 'legal_grapple_flag_route.json',
    trace: buildLegalTrace({
      id: 'legal-grapple-flag-route',
      heroId: 'hookshot',
      movementClass: 'grapple_release_flag_carry',
      smoke: true,
      steps: [
        { buttons: SPRINT_FORWARD, frames: 16 },
        {
          buttons: SPRINT_FORWARD,
          frames: 24,
          flagCarrier: true,
          abilityIds: ['hookshot_grapple'],
        },
        { buttons: SPRINT_FORWARD, frames: 16, flagCarrier: true },
      ],
    }),
  },
  {
    group: 'smoke',
    file: 'legal_blaze_rocket_jump.json',
    trace: buildLegalTrace({
      id: 'legal-blaze-rocket-jump',
      heroId: 'blaze',
      movementClass: 'rocket_jump_knockback',
      smoke: true,
      expectedCorrections: ['knockback'],
      steps: [
        { buttons: SPRINT_FORWARD, frames: 10 },
        {
          buttons: SPRINT_FORWARD | MOVEMENT_BUTTON_JUMP,
          frames: 1,
          abilityIds: ['blaze_rocket_jump'],
          barrier: {
            reason: 'knockback',
            velocity: vec(4, 12, -12),
            movementPatch: { isGrounded: false },
          },
        },
        { buttons: FORWARD, frames: 28, abilityIds: ['blaze_rocket_jump'], movementPatch: { isGrounded: false } },
      ],
    }),
  },
  {
    group: 'smoke',
    file: 'legal_phantom_teleport_flag_route.json',
    trace: buildLegalTrace({
      id: 'legal-phantom-teleport-flag-route',
      heroId: 'phantom',
      movementClass: 'blink_shadow_step_flag_route',
      smoke: true,
      expectedCorrections: ['teleport'],
      steps: [
        { buttons: SPRINT_FORWARD, frames: 12 },
        {
          buttons: FORWARD,
          frames: 1,
          abilityIds: ['phantom_blink'],
          barrier: {
            reason: 'teleport',
            position: vec(2, PLAYER_HALF_HEIGHT, -8),
            velocity: vec(0, 0, 0),
          },
        },
        { buttons: SPRINT_FORWARD, frames: 20, flagCarrier: true },
      ],
    }),
  },
  {
    group: 'full',
    file: 'legal_walk_sprint_crouch.json',
    trace: buildLegalTrace({
      id: 'legal-walk-sprint-crouch',
      heroId: 'chronos',
      movementClass: 'walk_sprint_crouch',
      steps: [
        { buttons: FORWARD, frames: 24 },
        { buttons: SPRINT_FORWARD, frames: 24 },
        { buttons: FORWARD | MOVEMENT_BUTTON_CROUCH, frames: 24 },
        { buttons: 0, frames: 16 },
      ],
    }),
  },
  {
    group: 'full',
    file: 'legal_wallrun_glide_fall.json',
    trace: buildLegalTrace({
      id: 'legal-air-strafe-fall',
      heroId: 'hookshot',
      movementClass: 'air_strafe_fall',
      steps: [
        { buttons: SPRINT_FORWARD, frames: 8 },
        { buttons: SPRINT_FORWARD | MOVEMENT_BUTTON_JUMP, frames: 1 },
        { buttons: SPRINT_FORWARD | MOVEMENT_BUTTON_MOVE_RIGHT, frames: 20 },
        { buttons: FORWARD, frames: 20 },
        { buttons: 0, frames: 20 },
      ],
    }),
  },
  {
    group: 'full',
    file: 'legal_chronos_tempo.json',
    trace: buildLegalTrace({
      id: 'legal-chronos-tempo',
      heroId: 'chronos',
      movementClass: 'timebreak_tempo_shield',
      steps: [
        { buttons: SPRINT_FORWARD, frames: 24, abilityIds: ['chronos_timebreak'], activeSpeedMultiplier: 1.25 },
        { buttons: FORWARD, frames: 18, abilityIds: ['chronos_aegis'], activeSpeedMultiplier: 1 },
        { buttons: FORWARD, frames: 18, abilityIds: ['chronos_lifeline'], activeSpeedMultiplier: 0.95 },
      ],
    }),
  },
  {
    group: 'full',
    file: 'legal_respawn_unstuck.json',
    trace: buildLegalTrace({
      id: 'legal-respawn-unstuck',
      heroId: 'blaze',
      movementClass: 'respawn_unstuck_authority_barriers',
      expectedCorrections: ['respawn', 'unstuck'],
      steps: [
        { buttons: SPRINT_FORWARD, frames: 10 },
        {
          buttons: 0,
          frames: 1,
          barrier: {
            reason: 'respawn',
            position: vec(-6, PLAYER_HALF_HEIGHT, 6),
            velocity: vec(0, 0, 0),
          },
        },
        { buttons: FORWARD, frames: 10 },
        {
          buttons: 0,
          frames: 1,
          barrier: {
            reason: 'unstuck',
            position: vec(-5, PLAYER_HALF_HEIGHT, 5),
            velocity: vec(0, 0, 0),
          },
        },
        { buttons: SPRINT_FORWARD, frames: 10 },
      ],
    }),
  },
  {
    group: 'full',
    file: 'legal_flag_return_capture.json',
    trace: buildLegalTrace({
      id: 'legal-flag-return-capture',
      heroId: 'phantom',
      movementClass: 'flag_pickup_return_capture_route',
      steps: [
        { buttons: SPRINT_FORWARD, frames: 20 },
        { buttons: SPRINT_FORWARD, frames: 30, flagCarrier: true },
        { buttons: 0, frames: 8, flagCarrier: false },
      ],
    }),
  },
];

for (const item of legalTraces) {
  writeTrace(item.group, item.file, item.trace);
}

const maliciousTraces: Array<{ file: string; trace: AntiCheatMovementTrace }> = [
  {
    file: 'malicious_teleport.json',
    trace: maliciousTrace({
      id: 'malicious-teleport',
      heroId: 'phantom',
      movementClass: 'forged_teleport_transform',
      expectedReason: 'speed_limit',
      frame: { position: vec(24, PLAYER_HALF_HEIGHT, 0), velocity: vec(0, 0, 0) },
    }),
  },
  {
    file: 'malicious_speed_spike.json',
    trace: maliciousTrace({
      id: 'malicious-speed-spike',
      heroId: 'blaze',
      movementClass: 'forged_speed_spike',
      expectedReason: 'speed_limit',
      frame: { position: vec(0.2, PLAYER_HALF_HEIGHT, 0), velocity: vec(80, 0, 0) },
    }),
  },
  {
    file: 'malicious_blocked_path.json',
    trace: maliciousTrace({
      id: 'malicious-blocked-path',
      heroId: 'hookshot',
      movementClass: 'blocked_wall_traversal',
      expectedReason: 'blocked_path',
      frame: { position: vec(3.05, PLAYER_HALF_HEIGHT, 0), velocity: vec(1, 0, 0), terrainProfile: 'blocked_wall' },
    }),
  },
  {
    file: 'malicious_bounds_escape.json',
    trace: maliciousTrace({
      id: 'malicious-bounds-escape',
      heroId: 'chronos',
      movementClass: 'map_bounds_escape',
      expectedReason: 'bounds',
      frame: { position: vec(150, PLAYER_HALF_HEIGHT, 0), velocity: vec(0, 0, 0) },
    }),
  },
  {
    file: 'malicious_stale_epoch.json',
    trace: maliciousTrace({
      id: 'malicious-stale-epoch',
      heroId: 'phantom',
      movementClass: 'stale_epoch_spam',
      expectedReason: 'epoch_mismatch',
      frame: { position: vec(0.1, PLAYER_HALF_HEIGHT, 0), velocity: vec(0, 0, 0), movementEpoch: 7 },
    }),
  },
  {
    file: 'malicious_duplicate_command.json',
    trace: maliciousTrace({
      id: 'malicious-duplicate-command',
      heroId: 'blaze',
      movementClass: 'duplicate_command_spam',
      expectedReason: 'duplicate_command',
      frame: { position: vec(0.1, PLAYER_HALF_HEIGHT, 0), velocity: vec(0, 0, 0), seq: 0 },
    }),
  },
  {
    file: 'malicious_objective_after_barrier.json',
    trace: maliciousTrace({
      id: 'malicious-objective-after-barrier',
      heroId: 'hookshot',
      movementClass: 'objective_after_authority_barrier',
      expectedReason: 'objective_suppression',
      frame: { position: vec(0.1, PLAYER_HALF_HEIGHT, 0), velocity: vec(0, 0, 0), objectiveSuppressed: true },
    }),
  },
];

for (const item of maliciousTraces) {
  writeTrace('malicious', item.file, item.trace);
}

console.log(`generated ${legalTraces.length + maliciousTraces.length} anti-cheat movement traces`);
