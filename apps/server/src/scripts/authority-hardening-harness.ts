import assert from 'node:assert/strict';
import { MOVEMENT_BUTTON_MOVE_FORWARD, parseMovementCommandPayload } from '@voxel-strike/shared';
import type { HeroStats, Vec3 } from '@voxel-strike/shared';
import { createGameEntryTicket, verifyGameEntryTicket } from '../security/entryTickets';
import { MessageRateLimiter } from '../rooms/rateLimiter';
import { validateMovementProposal, type MovementBounds } from '../rooms/movementValidation';
import { parsePlayerInputPayload, validatePlayerInputPayload, validateTeamPayload } from '../rooms/protocolValidation';
import { Player } from '../rooms/schema/Player';
import { AbilityStateSchema } from '../rooms/schema/Components';
import { executeAbility } from '../rooms/abilityHandlers';

process.env.ENTRY_TICKET_SECRET = process.env.ENTRY_TICKET_SECRET || 'authority-harness-secret';

const heroStats: HeroStats = {
  maxHealth: 200,
  moveSpeed: 4.54,
  jumpForce: 8.3,
  size: { width: 0.8, height: 1.8, depth: 0.8 },
};

const bounds: MovementBounds = {
  minX: -100,
  maxX: 100,
  minY: -20,
  maxY: 120,
  minZ: -100,
  maxZ: 100,
};

const previous = {
  position: { x: 0, y: 5, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  acceptedAt: 10_000,
  sequence: 1,
};

function movementContext(position: Vec3, velocity: Vec3, receivedAt = 10_200) {
  return {
    previous,
    proposedPosition: position,
    proposedVelocity: velocity,
    inputSequence: 2,
    receivedAt,
    heroStats,
    movement: {
      isSliding: false,
      isGrappling: false,
      isJetpacking: false,
      isGliding: false,
    },
    activeSpeedMultiplier: 1,
    flagCarrier: false,
    bounds,
    isInsidePlayableArea: () => true,
    isSpaceBlocked: () => false,
    isPathBlocked: () => false,
  };
}

function runMovementTests(): void {
  assert.equal(
    validateMovementProposal(movementContext(
      { x: 1.5, y: 5, z: 0 },
      { x: 7.5, y: 0, z: 0 }
    )).accepted,
    true,
    'normal Rapier-like sample should be accepted'
  );

  const teleport = validateMovementProposal(movementContext(
    { x: 80, y: 5, z: 0 },
    { x: 400, y: 0, z: 0 },
    10_100
  ));
  assert.equal(teleport.accepted, false, 'teleport sample should be rejected');
  assert.equal(teleport.reason, 'speed_limit');

  const invalid = validateMovementProposal(movementContext(
    { x: Number.NaN, y: 5, z: 0 },
    { x: 0, y: 0, z: 0 }
  ));
  assert.equal(invalid.accepted, false);
  assert.equal(invalid.reason, 'invalid_transform');

  const outOfBounds = validateMovementProposal(movementContext(
    { x: 120, y: 5, z: 0 },
    { x: 0, y: 0, z: 0 }
  ));
  assert.equal(outOfBounds.accepted, false);
  assert.equal(outOfBounds.reason, 'bounds');

  const blocked = validateMovementProposal({
    ...movementContext({ x: 1, y: 5, z: 0 }, { x: 3, y: 0, z: 0 }),
    isPathBlocked: () => true,
  });
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.reason, 'blocked_path');
}

function runTicketTests(): void {
  const ticket = createGameEntryTicket({
    lobbyId: 'lobby-a',
    gameRoomId: 'game-a',
    lobbyPlayerId: 'lobby-session-a',
    userId: 'user-a',
    displayName: 'Player A',
    assignedTeam: 'red',
    selectedHero: 'phantom',
    ttlMs: 5_000,
  });

  const claims = verifyGameEntryTicket(ticket, { lobbyId: 'lobby-a', gameRoomId: 'game-a' });
  assert.equal(claims?.assignedTeam, 'red');
  assert.equal(claims?.selectedHero, 'phantom');
  assert.equal(claims?.userId, 'user-a');

  assert.equal(
    verifyGameEntryTicket(ticket, { lobbyId: 'lobby-a', gameRoomId: 'game-b' }),
    null,
    'ticket must be bound to the game room'
  );

  const expired = createGameEntryTicket({
    lobbyId: 'lobby-a',
    gameRoomId: 'game-a',
    lobbyPlayerId: 'lobby-session-a',
    userId: 'user-a',
    displayName: 'Player A',
    assignedTeam: 'blue',
    ttlMs: -1,
  });
  assert.equal(verifyGameEntryTicket(expired, { lobbyId: 'lobby-a', gameRoomId: 'game-a' }), null);
}

function runProtocolTests(): void {
  assert.equal(validateTeamPayload({ team: 'green' }), null);
  assert.deepEqual(validateTeamPayload({ team: 'blue' }), 'blue');

  const validInput = validatePlayerInputPayload({
    tick: 1,
    moveForward: true,
    moveBackward: false,
    moveLeft: false,
    moveRight: false,
    jump: false,
    crouch: false,
    sprint: true,
    primaryFire: false,
    secondaryFire: false,
    reload: false,
    ability1: false,
    ability2: false,
    ultimate: false,
    interact: false,
    lookYaw: 0,
    lookPitch: 0,
    timestamp: 123,
    position: { x: 0, y: 5, z: 0 },
    velocity: { x: 1, y: 0, z: 0 },
  });
  assert.equal(validInput?.sprint, true);
  assert.equal(validatePlayerInputPayload({ ...validInput, position: { x: Infinity, y: 0, z: 0 } }), null);

  const tolerantInput = parsePlayerInputPayload({
    tick: 2,
    moveForward: 1,
    moveBackward: 0,
    moveLeft: false,
    moveRight: false,
    jump: false,
    crouch: false,
    sprint: false,
    primaryFire: false,
    secondaryFire: false,
    reload: false,
    ability1: false,
    ability2: false,
    ultimate: false,
    lookYaw: 0,
    lookPitch: 0,
    timestamp: null,
    unstuck: null,
    position: null,
  }, 124);
  if (!tolerantInput.ok) throw new Error(`expected tolerant input to parse: ${tolerantInput.reason}`);
  assert.equal(tolerantInput.input.moveForward, true);
  assert.equal(tolerantInput.input.moveBackward, false);
  assert.equal(tolerantInput.input.interact, false);
  assert.equal(tolerantInput.input.timestamp, 124);
  assert.equal(tolerantInput.input.unstuck, undefined);
  assert.equal(tolerantInput.input.position, undefined);

  const bigintTimestampInput = parsePlayerInputPayload({ ...validInput, timestamp: 1781072315413n }, 125);
  if (!bigintTimestampInput.ok) throw new Error(`expected bigint timestamp to parse: ${bigintTimestampInput.reason}`);
  assert.equal(bigintTimestampInput.input.timestamp, 1781072315413);

  const stringTimestampInput = parsePlayerInputPayload({ ...validInput, timestamp: '1781072315414' }, 126);
  if (!stringTimestampInput.ok) throw new Error(`expected string timestamp to parse: ${stringTimestampInput.reason}`);
  assert.equal(stringTimestampInput.input.timestamp, 1781072315414);

  const invalidTimestampInput = parsePlayerInputPayload({ ...validInput, timestamp: { value: 1 } }, 127);
  if (!invalidTimestampInput.ok) throw new Error(`expected invalid timestamp to fall back: ${invalidTimestampInput.reason}`);
  assert.equal(invalidTimestampInput.input.timestamp, 127);

  const invalidInput = parsePlayerInputPayload({ ...validInput, reload: 'yes' });
  assert.equal(invalidInput.ok, false);
  if (!invalidInput.ok) {
    assert.equal(invalidInput.reason, 'reload');
  }
}

function runMovementCommandPayloadTests(): void {
  const parsed = parseMovementCommandPayload({
    seq: '7',
    buttons: String(MOVEMENT_BUTTON_MOVE_FORWARD),
    lookYaw: '0.25',
    lookPitch: '-0.1',
    clientTimeMs: '1781195891144',
    movementEpoch: '2',
    collisionRevision: '3',
  });
  assert.ok(parsed);
  assert.equal(parsed.seq, 7);
  assert.equal(parsed.buttons, MOVEMENT_BUTTON_MOVE_FORWARD);
  assert.equal(parsed.lookYaw, 0.25);
  assert.equal(parsed.lookPitch, -0.1);
  assert.equal(parsed.clientTimeMs, 1781195891144);
  assert.equal(parsed.movementEpoch, 2);
  assert.equal(parsed.collisionRevision, 3);

  assert.equal(
    parseMovementCommandPayload({ ...parsed, seq: 'not-a-sequence' }),
    null,
    'malformed sequence must be rejected'
  );
  assert.equal(
    parseMovementCommandPayload({ ...parsed, seq: '4294967296' }),
    null,
    'out-of-range sequence must be rejected before normalization'
  );
  assert.equal(
    parseMovementCommandPayload({ ...parsed, collisionRevision: { value: 3 } }),
    null,
    'malformed collision revision must be rejected when present'
  );
}

function runRateLimitTests(): void {
  const limiter = new MessageRateLimiter();
  assert.equal(limiter.consume('player-a', 'chat', { limit: 2, intervalMs: 1000 }, 0), true);
  assert.equal(limiter.consume('player-a', 'chat', { limit: 2, intervalMs: 1000 }, 10), true);
  assert.equal(limiter.consume('player-a', 'chat', { limit: 2, intervalMs: 1000 }, 20), false);
  assert.equal(limiter.consume('player-a', 'chat', { limit: 2, intervalMs: 1000 }, 1100), true);
}

function createAbilityHarnessPlayer(heroId: 'phantom' | 'blaze'): Player {
  const player = new Player();
  player.id = `${heroId}-harness`;
  player.team = 'red';
  player.heroId = heroId;
  player.lookYaw = 0;
  player.lookPitch = 0;
  player.position.x = 1;
  player.position.y = 5;
  player.position.z = 2;
  player.velocity.x = 0;
  player.velocity.y = 0;
  player.velocity.z = 0;
  player.movement.isGrounded = true;
  player.movement.isSliding = true;
  player.movement.slideTimeRemaining = 0.4;
  return player;
}

function runAbilityBarrierTests(): void {
  const marks: Array<{ playerId: string; durationMs: number; reason?: 'teleport' | 'knockback' }> = [];
  const context = {
    createVoidZone: () => undefined,
    resolvePhantomBlinkDestination: () => ({ x: 7, y: 6, z: 8 }),
    resolvePhantomShadowStepDestination: () => ({ x: 3, y: 5, z: 4 }),
    markAuthoritativePosition: (playerId: string, durationMs: number, reason?: 'teleport' | 'knockback') => {
      marks.push({ playerId, durationMs, reason });
    },
  };

  const blinkPlayer = createAbilityHarnessPlayer('phantom');
  executeAbility(blinkPlayer, 'phantom_blink', new AbilityStateSchema(), {}, context);
  assert.deepEqual(
    { x: blinkPlayer.position.x, y: blinkPlayer.position.y, z: blinkPlayer.position.z },
    { x: 7, y: 6, z: 8 },
    'blink should use capsule-validated resolver destination'
  );
  assert.equal(marks[marks.length - 1]?.reason, 'teleport');
  assert.equal(blinkPlayer.movement.isSliding, false);

  const shadowPlayer = createAbilityHarnessPlayer('phantom');
  executeAbility(shadowPlayer, 'phantom_shadowstep', new AbilityStateSchema(), {}, context);
  assert.deepEqual(
    { x: shadowPlayer.position.x, y: shadowPlayer.position.y, z: shadowPlayer.position.z },
    { x: 3, y: 5, z: 4 },
    'shadow-step should use capsule-validated resolver destination'
  );
  assert.equal(marks[marks.length - 1]?.reason, 'teleport');

  const rocketPlayer = createAbilityHarnessPlayer('blaze');
  executeAbility(rocketPlayer, 'blaze_rocketjump', new AbilityStateSchema(), {}, context);
  assert.equal(marks[marks.length - 1]?.reason, 'knockback');
  assert.equal(rocketPlayer.movement.isGrounded, false);
  assert.equal(rocketPlayer.movement.isSliding, false);
}

runMovementTests();
runTicketTests();
runProtocolTests();
runMovementCommandPayloadTests();
runRateLimitTests();
runAbilityBarrierTests();

console.log('authority hardening harness passed');
