import assert from 'node:assert/strict';
import {
  BLAZE_ROCKET_JUMP_VERTICAL_FORCE,
  DEFAULT_GAME_CONFIG,
  MOVEMENT_BUTTON_MOVE_FORWARD,
  parseMovementCommandPayload,
} from '@voxel-strike/shared';
import type { HeroStats, Team, Vec3 } from '@voxel-strike/shared';
import { createGameEntryTicket, verifyGameEntryTicket } from '../security/entryTickets';
import { MessageRateLimiter } from '../rooms/rateLimiter';
import { getCreateBotFailureReason } from '../rooms/LobbyRoom';
import { createTeamSpawnAssignments } from '../rooms/GameRoom';
import { validateMovementProposal, type MovementBounds } from '../rooms/movementValidation';
import { validateTeamPayload } from '../rooms/protocolValidation';
import { shouldResolveGenericSecondaryAttack } from '../rooms/combatInputRouting';
import { Player } from '../rooms/schema/Player';
import { AbilityStateSchema } from '../rooms/schema/Components';
import {
  deactivateActiveAbility,
  executeAbility,
  initializePlayerAbilities,
  tryUseAbility,
  updateActiveAbilities,
} from '../rooms/abilityHandlers';

process.env.ENTRY_TICKET_SECRET = process.env.ENTRY_TICKET_SECRET || 'authority-harness-secret';

const heroStats: HeroStats = {
  maxHealth: 200,
  moveSpeed: 3.63,
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
}

function runCombatInputRoutingTests(): void {
  assert.equal(
    shouldResolveGenericSecondaryAttack('hookshot', { secondaryFire: true }, false, false),
    true,
    'Hookshot RMB should still route through the generic secondary attack resolver'
  );
  assert.equal(
    shouldResolveGenericSecondaryAttack('chronos', { secondaryFire: true }, false, false),
    false,
    'Chronos RMB is Aegis and must not be rejected as a missing secondary attack'
  );
  assert.equal(
    shouldResolveGenericSecondaryAttack('hookshot', { secondaryFire: true }, true, false),
    false,
    'Held generic secondary attacks should resolve on press edge only'
  );
  assert.equal(
    shouldResolveGenericSecondaryAttack('hookshot', { secondaryFire: true }, false, true),
    false,
    'Suppressed secondary input should not resolve as an attack'
  );
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

function runLobbyBotRosterTests(): void {
  const createFailureReason = (options: {
    combatParticipantCount: number;
    requestedTeam: Team | null;
    requestedTeamCount: number;
    wageredLobby?: boolean;
  }) => getCreateBotFailureReason({
    wageredLobby: options.wageredLobby ?? false,
    combatParticipantCount: options.combatParticipantCount,
    maxParticipants: DEFAULT_GAME_CONFIG.maxPlayers,
    requestedTeam: options.requestedTeam,
    requestedTeamCount: options.requestedTeamCount,
  });

  assert.equal(createFailureReason({
    combatParticipantCount: DEFAULT_GAME_CONFIG.maxPlayers - 1,
    requestedTeam: 'red',
    requestedTeamCount: DEFAULT_GAME_CONFIG.teamSize,
  }), 'team_full', 'server must reject a fifth bot on one team before the lobby is globally full');

  assert.equal(createFailureReason({
    combatParticipantCount: DEFAULT_GAME_CONFIG.maxPlayers - 1,
    requestedTeam: 'blue',
    requestedTeamCount: DEFAULT_GAME_CONFIG.teamSize - 1,
  }), null, 'observer-host custom match should still allow the eighth bot on the underfilled team');

  assert.equal(createFailureReason({
    combatParticipantCount: DEFAULT_GAME_CONFIG.maxPlayers,
    requestedTeam: 'blue',
    requestedTeamCount: DEFAULT_GAME_CONFIG.teamSize,
  }), 'team_full', 'team-full failures should stay specific even when the full lobby is also full');

  assert.equal(createFailureReason({
    combatParticipantCount: DEFAULT_GAME_CONFIG.maxPlayers,
    requestedTeam: null,
    requestedTeamCount: 0,
  }), 'lobby_full');

  assert.equal(createFailureReason({
    combatParticipantCount: 0,
    requestedTeam: 'red',
    requestedTeamCount: 0,
    wageredLobby: true,
  }), 'bots_disabled');
}

function runTeamSpawnAssignmentTests(): void {
  const assignments = createTeamSpawnAssignments([
    { playerId: 'red-bot-0', team: 'red' },
    { playerId: 'red-bot-1', team: 'red' },
    { playerId: 'red-bot-2', team: 'red' },
    { playerId: 'blue-bot-0', team: 'blue' },
    { playerId: 'blue-bot-1', team: 'blue' },
    { playerId: 'blue-bot-2', team: 'blue' },
    { playerId: 'blue-bot-3', team: 'blue' },
    { playerId: 'human-red', team: 'red' },
  ], { red: DEFAULT_GAME_CONFIG.teamSize, blue: DEFAULT_GAME_CONFIG.teamSize }, { red: 1, blue: 3 });

  const spawnIndicesByTeam = new Map<Team, number[]>();
  for (const assignment of assignments) {
    const indices = spawnIndicesByTeam.get(assignment.team) ?? [];
    indices.push(assignment.spawnIndex);
    spawnIndicesByTeam.set(assignment.team, indices);
  }

  const redSpawnIndices = spawnIndicesByTeam.get('red') ?? [];
  const blueSpawnIndices = spawnIndicesByTeam.get('blue') ?? [];
  assert.equal(redSpawnIndices.length, DEFAULT_GAME_CONFIG.teamSize);
  assert.equal(blueSpawnIndices.length, DEFAULT_GAME_CONFIG.teamSize);
  assert.equal(new Set(redSpawnIndices).size, DEFAULT_GAME_CONFIG.teamSize, 'full red team must not reuse a spawn point at match start');
  assert.equal(new Set(blueSpawnIndices).size, DEFAULT_GAME_CONFIG.teamSize, 'full blue team must not reuse a spawn point at match start');
  assert.deepEqual([...redSpawnIndices].sort((a, b) => a - b), [0, 1, 2, 3]);
  assert.deepEqual([...blueSpawnIndices].sort((a, b) => a - b), [0, 1, 2, 3]);
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

  const rocketPlayer = createAbilityHarnessPlayer('blaze');
  rocketPlayer.velocity.y = 8.5;
  executeAbility(rocketPlayer, 'blaze_rocketjump', new AbilityStateSchema(), {}, context);
  assert.equal(marks[marks.length - 1]?.reason, 'knockback');
  assert.equal(rocketPlayer.velocity.y, 8.5 + BLAZE_ROCKET_JUMP_VERTICAL_FORCE);
  assert.equal(rocketPlayer.movement.isGrounded, false);
  assert.equal(rocketPlayer.movement.isSliding, false);

  const fallingRocketPlayer = createAbilityHarnessPlayer('blaze');
  fallingRocketPlayer.velocity.y = -6;
  executeAbility(fallingRocketPlayer, 'blaze_rocketjump', new AbilityStateSchema(), {}, context);
  assert.equal(fallingRocketPlayer.velocity.y, BLAZE_ROCKET_JUMP_VERTICAL_FORCE);
}

function runPhantomShieldCooldownTests(): void {
  const context = { createVoidZone: () => undefined };
  const createActiveShield = () => {
    const player = createAbilityHarnessPlayer('phantom');
    initializePlayerAbilities(player, 'phantom');
    const result = tryUseAbility(player, 'ability2');
    assert.equal(result.success, true);
    assert.equal(result.abilityId, 'phantom_personal_shield');
    assert.equal(result.abilityState?.cooldownRemaining, 0, 'shield cooldown should not start on cast');
    executeAbility(player, result.abilityId!, result.abilityState!, result.abilityDef, context);
    assert.equal(result.abilityState?.isActive, true);
    assert.equal(result.abilityState?.cooldownRemaining, 0, 'active shield should show active time, not cooldown');
    return { player, shield: result.abilityState! };
  };

  const { shield: brokenShield } = createActiveShield();
  deactivateActiveAbility(brokenShield);
  assert.equal(brokenShield.isActive, false);
  assert.equal(brokenShield.cooldownRemaining, 10, 'breaking shield should start cooldown');

  const { player: expiringPlayer, shield: expiredShield } = createActiveShield();
  updateActiveAbilities(expiringPlayer, expiredShield.activatedAt + 10_000);
  assert.equal(expiredShield.isActive, false);
  assert.equal(expiredShield.cooldownRemaining, 10, 'expired shield should start cooldown');
}

runMovementTests();
runTicketTests();
runProtocolTests();
runCombatInputRoutingTests();
runMovementCommandPayloadTests();
runRateLimitTests();
runLobbyBotRosterTests();
runTeamSpawnAssignmentTests();
runAbilityBarrierTests();
runPhantomShieldCooldownTests();

console.log('authority hardening harness passed');
