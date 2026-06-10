# Cheat-Resistant Game Architecture Plan

## Reader And Goal

This plan is for an internal engineer hardening Opus Strike against casual hacked-client cheating before building a full anti-cheat.

After reading this, they should be able to make the game architecture much harder to exploit with protocol edits, scripted clients, or local state tampering, while deliberately stopping short of client attestation, memory inspection, ban automation, or a dedicated anti-cheat product.

## Scope

This plan focuses on server authority, protocol shape, light server-side validation, replayability, and observability.

Movement-specific constraint: this plan should not replace or reimplement the current Rapier/client movement stack. Treat Rapier as the movement-feel implementation for this hardening phase. Server work should wrap the existing movement with plausibility checks, correction policy, objective suppression, and telemetry. Any later server/shared-simulator movement path should be optional, feature-flagged, and introduced only after parity tests prove it does not degrade the current feel.

It is not a plan for:

- Kernel, driver, or process-level anti-cheat.
- Client binary integrity checks.
- Screenshot, memory, or input-device inspection.
- Aimbot or wallhack detection.
- Automatic bans.
- Browser/manual playtesting by the agent. Verification should use typechecks, unit tests, integration tests, and headless simulation harnesses.

## Relevant Code Reviewed

The review focused on the live multiplayer path and the shared logic it depends on:

- The Colyseus game room that owns player state, movement, abilities, combat, CTF objectives, bots, map queries, and broadcasts.
- The server ability helper that initializes cooldowns, charges, active states, teleports, rocket jump movement, and active ability expiration.
- The lobby room that owns host actions, team selection, bots, map voting, and game-room creation.
- The client network provider, game message handlers, local prediction helper, and player controller.
- The shared movement command protocol, player/network types, game constants, hero constants, and physics constants.
- The shared movement simulator, local prediction controller, and hookshot swing simulator as existing helpers and possible validators, not as a mandate to replace Rapier movement.
- The existing auth routes and wallet-signature verification.
- The older game-logic package for CTF, match, spawn, and ability systems.

## Current Architecture Review

The server already owns the important match state: health, damage, kills, respawns, flags, scores, ability cooldowns, ultimate charge, and match phase changes. Damage is mostly resolved by the server from server-side player positions, aim cones, cooldowns, line of sight, and team checks. CTF pickup, return, and capture are also server-derived from the server's player positions.

There is a newer movement command protocol with sequence numbers, movement epochs, command queue limits, button bitmasks, look clamping, server-side movement simulation, and targeted self-authority snapshots. This is the right foundation for cheat resistance.

The main gap is that the active client path still sends legacy `input` messages every server tick with client-reported `position` and `velocity`. The server accepts those transforms whenever the short `authoritativePositionUntil` window has expired, clamps only broad map bounds and finite values, and then uses that position for combat and CTF. A modified client can therefore still produce impossible movement, speed, and objective interactions without touching any future anti-cheat.

The newer `movementCommands` path is currently implemented on the server and exposed by the client network context, but the player controller does not use it. The local prediction helper can create movement commands and packets, but no active gameplay code calls it. This code is useful as future infrastructure and as a source of validation ideas, but the first hardening slice should not depend on replacing Rapier movement with it.

The shared movement simulator can still be useful for cheap limits, test harnesses, and future parity work. It should not be treated as an immediate replacement for the current Rapier movement. The hardening plan should preserve the client movement implementation and make the server validate plausible envelopes around the reported result.

Combat is in better shape than movement. Client-reported damage is not accepted. Blaze rocket impact messages are currently ignored. Blaze bomb drop is client-triggered, but the server derives the target from server position and aim. Hitscan-like attacks use server aim cone plus line of sight. Area damage and damage-over-time use server-side positions. These checks become meaningful once movement can no longer be spoofed.

Ability state is server-owned, but client-side cooldowns and charges are still used heavily for prediction and UI. That is acceptable for feel, but the client must treat server vitals as final. The current local player state handler includes race-protection logic that can ignore large server ultimate-charge jumps or drops. That is a UI consistency concern now and a hardening concern later, because a hardened client should display server resource state honestly.

Developer commands are registered only when the server thinks it is not in production. That protects production if `NODE_ENV` is correct, but `NODE_ENV !== 'production'` is a broad gate. Dev fly, immunity, NPC spawn, NPC damage, bot root, time freeze, and ultimate fill should remain convenient locally while being impossible to expose accidentally in any shared environment.

Room identity is weak. Auth routes exist for wallet login and JWT cookies, but Colyseus room joins currently trust a client-provided name and a localStorage-backed client ID. That client ID is useful for duplicate-tab handling, but it is not identity. A client that knows a game room ID can join directly, request a preferred team, and bypass lobby assignment checks.

The lobby is mostly host-authoritative. Host-only actions are checked on the server for starting games, bot management, map vote finalization, and kicks. Map votes validate option IDs. Team selection checks balance. The remaining issue is identity and game-room entry, not basic lobby command ownership.

Runtime message validation is uneven. Movement commands have real validation. Other messages rely mostly on TypeScript shapes and handler checks. A modified client can send malformed payloads, spam low-cost messages, or probe dev-only names. This is not a full anti-cheat problem; it is protocol hygiene.

The older game-logic package duplicates CTF, match, spawn, and ability concepts but is not the live server authority path. It should not be treated as the source of truth until the live room logic is deliberately extracted into shared modules.

## Threat Model For This Stage

Resist these now:

- Teleporting, speed hacking, flying, or no-clipping by sending transforms.
- Ability, primary-fire, reload, and ultimate spam through edited input.
- Client-forged cooldowns, charges, health, damage, score, flag state, or projectile impact.
- Joining a match as the wrong player/team or bypassing lobby assignment.
- Flooding non-movement messages to degrade a room.
- Accidental exposure of dev tools in a non-local environment.
- Map or collision mismatch once mutable voxel state exists.

Do not try to solve these yet:

- Aimbots that produce plausible aim input.
- Wallhacks based on local knowledge of visible enemy state.
- External overlays or input macros.
- Client binary tampering detection.
- Automated trust scoring that bans players.

## Target Authority Model

| System | Client May Send | Server Must Own |
| --- | --- | --- |
| Movement | Rapier movement samples, input/button state, look yaw/pitch, sequence numbers, client timestamps | Accepted match transform, correction/suppression policy, spawn/teleport/knockback, objective eligibility, coarse collision/limit checks |
| Combat | Fire/hold/reload intent | Hit validation, cooldowns, ammo, damage, falloff, line of sight |
| Abilities | Ability button edges or tightly validated target requests | Charges, cooldowns, ultimate cost, target resolution, movement barriers |
| Projectiles | Optional visual prediction only | Cast IDs, owner, start, aim, impact time, impact validation, damage |
| CTF | No direct objective messages | Pickup, drop, return, capture, score, flag carrier |
| Lobby | Ready/team/vote requests | Host checks, assignment, room creation, game entry tickets |
| Identity | Auth token or guest request | User ID, display name, session ownership, reconnect policy |
| Dev Tools | Local-only requests | Server-side environment and secret-gated enablement |

## Design Principles

1. The client sends intent; the server stores facts.
2. Normal gameplay messages may contain movement samples, but those samples are proposals, not authoritative transforms.
3. Do not rewrite fragile movement during this hardening pass. Wrap current Rapier movement with server plausibility checks first; only move toward server replay after parity is proven.
4. Prediction is allowed only when reconciliation exists.
5. Every teleport, respawn, knockback, grapple attach, or collision-revision change creates an explicit movement epoch barrier.
6. Server checks should first correct or ignore impossible state, not ban.
7. Rejection and correction metrics should be visible before enforcement becomes strict.
8. The room protocol should be small, validated, and rate-limited.
9. Development affordances should be impossible to enable accidentally.
10. Tests and replay harnesses should prove authority rules without browser testing.

## Phase 1: Preserve Rapier And Fence Transforms

### Goal

Remove transform trust from normal gameplay without cutting over to a server-side recreation of Rapier movement.

### Work

- Keep the current Rapier-driven `PlayerController` movement as the first implementation.
- Treat client `position` and `velocity` as proposed movement samples, not authoritative facts.
- Add sequence numbers and timestamps to the existing movement sample path, or wrap those samples in the existing `movementCommands` envelope without requiring the server to replay Rapier exactly.
- Accept a proposed transform only if it passes finite checks, world bounds, phase/state checks, generous horizontal and vertical speed envelopes, path sampling, and recent-correction rules.
- On failure, restore or hold the last safe accepted transform, send a correction, and temporarily suppress objective/combat eligibility for that suspicious movement window.
- Do not make `sharedSimulator` or `predictionController` a required replacement in this slice. Keep them as future tools for parity testing, limit calculation, and eventual server-authoritative movement if the team chooses that path.
- Split dev fly into a separate development-only transform override path, or keep proposed transform acceptance only for `devFly` when development mode and an explicit server dev flag are enabled.
- Keep combat and ability button edges on the existing input path during this phase, but keep cooldowns, damage, captures, and resource effects server-owned.
- Send targeted self-authority snapshots after corrections and use those snapshots for coarse reconciliation.

### Why This Matters

Until this phase is done, every server-side combat or objective check can be fed a cheated position. This is the highest-leverage change in the whole plan, but it should close the easy teleport/speed path without forcing a bit-perfect server recreation of client physics.

### Acceptance Criteria

- Current Rapier movement stays active.
- The server accepts current movement samples only after plausibility validation.
- The server does not need bit-perfect Rapier recreation for this phase.
- A hacked client sending a far-away `position` or impossible `velocity` is ignored, corrected, or temporarily quarantined from objectives.
- Reconciliation remains coarse and conservative enough not to damage normal movement feel.

## Phase 2: Add Lightweight Movement Sanity Checks

### Goal

Use cheap server checks to catch impossible movement even if a protocol bug or future feature reintroduces bad state.

### Work

- Store a last-safe movement state for each alive human player.
- After every proposed movement sample or accepted movement window, assert that position and velocity are finite.
- Assert that the resulting body is inside playable bounds and not inside collision blocks.
- Sweep or sample the segment from previous to next position to catch no-clip through solid voxels.
- Enforce hero-specific horizontal speed envelopes with slack for slide, flag-carrier penalty, Phantom Veil, hookshot swing, and server-applied knockbacks.
- Enforce vertical speed envelopes with slack for jumps, gravity, hookshot swing, rocket jump, and Chronos knockback.
- Suppress CTF objective interactions briefly after a hard movement correction or epoch mismatch.
- On violation, discard the offending step, restore last-safe state, increment correction metrics, send self-authority, and optionally increment a non-punitive suspicion counter.
- Add correction reason values for `invalid_transform`, `speed_limit`, `blocked_path`, `bounds`, and `queue_overflow` if the existing set is too small.
- Promote movement telemetry from dev-only perf snapshots into server logs or room-local diagnostics.

### Enforcement Policy

The first version should correct and log. It should not kick or ban. Repeated violations can trigger stricter server behavior later, such as discarding more commands, forcing neutral movement for a short window, or requiring a fresh movement epoch.

### Acceptance Criteria

- Impossible finite values, out-of-bounds moves, no-clip segments, and speed envelope breaks produce corrections.
- Normal slide, bunny hop, grapple, rocket jump, respawn, blink, and knockback cases do not generate noisy corrections.
- Correction metrics are visible in a debug snapshot or server log.

## Phase 3: Harden Ability And Combat Authority

### Goal

Make every combat-affecting action server-owned, with client prediction reduced to visuals and audio.

### Work

- Drive primary fire, secondary fire, reload, ability 1, ability 2, ultimate, interact, and unstuck from server-validated input or command button edges.
- Keep server cooldowns, charges, ammo, active state, and ultimate cost authoritative.
- Treat client cooldowns and charges as prediction/UI only; overwrite them from server vitals without hiding large server changes.
- Reject ability requests when the player is dead, spawning, selecting, on the wrong hero, out of phase, out of charges, on cooldown, or below ultimate cost.
- Keep the server deriving target positions from server position, server look direction, server map collision, and server line of sight.
- Give every server-created projectile or delayed effect a cast registry entry: owner, ability, start position, aim direction, server time, impact time, target, radius, damage, and consumed state.
- If future features accept client projectile impact reports, validate cast ID ownership, ability type, impact time window, max distance, line segment, and nearest solid/map surface. Keep the current ignored rocket-impact message ignored until that validation exists.
- Validate Blaze bomb drop as an input edge or as a request tied to a recent server-known hold/targeting state. Do not accept arbitrary repeated drops.
- Revalidate delayed Chronos Lifeline targets at release time for alive state, team, range, and line of sight if required by design.
- Ensure every teleport-like ability uses the same server path/blocking resolver as Phantom Blink. If older Shadow Step behavior returns, it must not directly add distance without clamp and body-clearance checks.
- Add damage caps per source, target, ability, and time window. These should catch accidental double-resolution and protocol spam, not replace ability cooldowns.
- Keep friendly-fire and spawn-protection checks centralized inside damage application.

### Acceptance Criteria

- Sending ability buttons faster than intended cannot bypass server cooldowns, charges, ammo, or ultimate cost.
- Sending forged damage, heal, flag, score, or projectile impact messages has no gameplay effect.
- Repeated bomb-drop or projectile-impact messages cannot multiply damage.
- Server vitals are the final client-visible resource truth.

## Phase 4: Harden Objectives And Match Rules

### Goal

Make CTF outcomes resistant to one-frame position abuse, phase abuse, and direct room joins.

### Work

- Run CTF pickup, return, and capture only from server-authoritative positions after movement correction has been applied.
- Suppress objective interaction for a short window after hard correction, respawn, teleport, unstuck, or epoch mismatch.
- Require the carrier to be alive, on a valid team, not in spawn-only transition state, and carrying exactly one enemy flag.
- Keep carried flag positions derived from the carrier only.
- Keep capture requiring own flag at base and carrier inside own base radius.
- Drop carried flags on death and disconnect, as the server already does.
- Add objective-event logging with source player, team, position, server tick, phase, and movement epoch.
- Add tests for pickup, return, capture, disconnect drop, death drop, hard-correction suppression, and team/phase mismatch.

### Acceptance Criteria

- A teleport or speed spike into a flag zone is corrected before objective checks can score.
- Captures cannot be triggered by messages and cannot happen while the player is dead/spawning/selecting.
- Objective event logs are enough to debug a suspicious score without a browser session.

## Phase 5: Bind Identity, Lobby Assignment, And Game Entry

### Goal

Prevent direct game-room joins, team spoofing, duplicate identity spoofing, and name spoofing from becoming gameplay advantages.

### Work

- Connect wallet/JWT auth to room joins. The server should derive user ID and display name from the verified session when auth is required.
- Keep guest play possible only behind an explicit server configuration if desired.
- Treat the localStorage client ID as reconnect convenience only, never as identity.
- When the lobby creates a game room, issue a short-lived signed entry ticket per human player. The ticket should include lobby ID, game room ID, user/session ID, assigned team, optional selected hero, expiry, and nonce.
- Require that ticket when joining a lobby-created game room.
- Reject game-room joins whose requested team does not match the ticket assignment.
- Do not allow a human client to claim bot assignment IDs.
- Keep direct `joinOrCreate('game_room')` available only for local development or explicit test mode.
- On reconnect, bind the reconnect to the same authenticated user/ticket instead of a client-provided arbitrary ID.
- Keep host-only lobby actions server-gated, and add validation/rate limits for host actions.

### Acceptance Criteria

- A client with only a game room ID cannot join a real lobby-created match.
- A client cannot pick a different team than the lobby assignment.
- A client cannot impersonate another player by editing localStorage client ID.
- Authenticated names are server-derived in authenticated mode.

## Phase 6: Validate And Rate-Limit The Protocol

### Goal

Make every room message small, typed at runtime, and bounded.

### Work

- Add runtime validators for every client-to-server message, not just movement commands.
- Reject unknown hero IDs, teams, bot IDs, map option IDs, malformed booleans, non-finite numbers, oversized strings, and unexpected nested payloads.
- Add message-specific rate limits:
  - Movement commands: keep the existing high-frequency cap, queue cap, and malformed counters.
  - Chat: low rate, trim, and optionally cooldown repeated identical messages.
  - Hero/team/ready: low rate, phase-gated.
  - Map voting and lobby host actions: low rate, host/phase-gated.
  - Bomb drop and ability target requests: edge/hold-gated and cooldown-aware.
  - Perf snapshots and dev commands: development-only and low rate.
- Add payload-size limits before parsing or deep validation where possible.
- Do not broadcast detailed validation errors to all clients. Send concise errors to the sender when useful; log details server-side.
- Make dev command registration require both non-production mode and an explicit development-tools flag or local-only secret.

### Acceptance Criteria

- Fuzzed malformed messages do not throw, mutate state, or spam logs.
- Repeated low-value messages are dropped without affecting gameplay.
- Production cannot register NPC, immunity, dev fly, time freeze, or ultimate-fill handlers by environment accident.

## Phase 7: Prepare For Mutable Map And Collision Revisions

### Goal

Make the current architecture ready for later voxel destruction without opening new cheating paths.

### Work

- Use the existing `collisionRevision` field in movement commands.
- Add a server-owned map/collision revision to movement authority snapshots.
- Reject or barrier commands from stale collision revisions once mutable map state exists.
- Tie projectile and ability target validation to the server's current map revision.
- Keep protected zones for spawn pads, flag pads, critical boundary walls, and objective clearance.
- On map revision changes, clear relevant line-of-sight caches and send authority barriers where collision changed near a player.

### Acceptance Criteria

- Movement commands and authority snapshots have a meaningful collision revision.
- A stale client map cannot keep moving through newly solid or newly removed collision without correction.
- Objective-critical map regions remain protected by server rules.

## Phase 8: Observability, Replay, And Triage

### Goal

Make suspicious behavior explainable before building anti-cheat.

### Work

- Add a per-player authority ledger with counters for malformed commands, duplicate commands, late commands, dropped commands, hard corrections, speed violations, blocked-path corrections, objective suppressions, ability rejects, and rate-limit drops.
- Add server logs for high-signal events with player ID, user ID if present, room ID, tick, movement epoch, command sequence, reason, and position.
- Add a private match event log that records command headers, authority snapshots, damage events, ability casts, objective events, and corrections. Do not record raw chat in security logs unless required.
- Add a lightweight replay harness that can feed recorded movement samples, input edges, corrections, and authority snapshots into server validators and assert deterministic outcomes.
- Keep all counters non-punitive for now. The next anti-cheat step can decide thresholds and player-facing consequences.

### Acceptance Criteria

- A suspicious capture, kill, teleport, or ability burst can be investigated from server logs and replay data.
- Normal players have low, explainable correction rates.
- High correction or rejection rates are visible before any automated penalty exists.

## Test And Verification Plan

Do not use browser testing for this hardening work.

Add or extend headless tests for:

- Movement command sanitization, sequence ordering, wrap behavior, duplicate drops, stale epoch drops, queue overflow, malformed values, and command rate caps.
- Shared movement speed envelopes for sprint, crouch, slide, air acceleration, flag carrier movement, Phantom Veil, rocket jump, hookshot swing, knockback, and map clamping.
- Server rejection or correction of impossible proposed position and velocity input in normal gameplay.
- Server correction of out-of-bounds, blocked-path, non-finite, and speed-envelope violations.
- Ability spam against cooldowns, charges, ammo, ultimate cost, phase, dead state, and wrong hero.
- Forged damage, heal, score, flag, and projectile impact messages.
- CTF pickup, return, capture, death drop, disconnect drop, and objective suppression after hard correction.
- Lobby ticket validation, team assignment enforcement, direct game-room join rejection, and reconnect behavior.
- Dev command absence in hardened/production mode.
- Replay harness cases for normal movement and intentional cheat attempts.

Useful existing starting points:

- The shared movement simulator and prediction controller are useful for focused limit and parity tests, but should not replace Rapier movement in the first hardening slice.
- The movement prediction harness can become the seed for replay-style movement cases.
- The room-level handlers are currently large, so integration tests should start with a small fake-room or extracted authority helper before broad Colyseus tests.

## Recommended Work Order

1. Keep Rapier movement, but add server-owned acceptance around client movement samples.
2. Add headless tests that prove impossible transform proposals fail.
3. Add movement sanity checks and correction telemetry with generous thresholds.
4. Move combat and ability checks fully onto server-owned button edges and cooldown ledgers.
5. Add runtime message validators and rate limits.
6. Bind lobby-created game rooms to signed entry tickets.
7. Add objective suppression after hard movement corrections.
8. Add replayable authority logs.
9. Revisit thresholds and player consequences in the full anti-cheat phase.

## First Vertical Slice

The first slice should be intentionally narrow:

1. Add a hardened movement mode flag that defaults to on outside local development.
2. Keep `PlayerController` on the current Rapier movement path.
3. Add sequencing and timestamps to the current movement sample path.
4. Make `GameRoom` treat `input.position` and `input.velocity` as proposals and accept them only if they pass bounds, speed, vertical, path, phase, and recent-correction checks.
5. Keep self-authority reconciliation active for corrections.
6. Add tests for:
   - a normal Rapier-like movement sample is accepted,
   - a legacy teleport input is corrected,
   - a speed-hack sample is corrected or rejected,
   - objective interaction is suppressed during suspicious movement windows,
   - dev fly still works only when development tools are enabled.

That slice closes the largest cheat surface without requiring the whole plan at once.

## Full Hardening Acceptance Criteria

The architecture is ready for the next anti-cheat step when:

- Normal gameplay may use client movement samples only as proposals, with server-owned acceptance, correction, and objective eligibility.
- Combat, objectives, match state, cooldowns, resources, team assignment, and accepted transforms are server-owned. Rapier movement feel remains client-owned until deliberate server-authoritative movement work is introduced.
- All client messages have runtime validation and rate limits.
- Room entry is bound to authenticated identity or an explicit guest mode plus signed lobby assignment.
- Dev tools cannot be exposed accidentally in shared environments.
- Server logs and replay data can explain suspicious movement, combat, and objective events.
- Headless tests cover common hacked-client attempts.
- No browser verification is required from the agent side.
