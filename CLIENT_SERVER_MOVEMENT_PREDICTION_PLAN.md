# Client/Server Movement Prediction Plan

## Reader And Goal

This plan is for an internal engineer implementing responsive, server-authoritative player movement for Opus Strike.

After reading this, they should be able to implement client prediction, authoritative server simulation, local reconciliation, and remote interpolation in vertical slices without rewriting the whole multiplayer stack at once.

## Current Architecture Review

The game already has the right broad pieces for prediction, but they are not yet connected into a real reconciliation loop.

The client currently simulates the local player every render frame, updates high-frequency visual state directly, and sends input to the server at the shared tick rate. Those input messages include button state, look direction, a tick value, timestamp, and the client-reported position and velocity.

The server receives the latest input, stores it on the player, updates look direction immediately, and usually accepts the client-reported transform before running its own movement simulation. It then broadcasts quantized player transforms every server tick, vitals at a lower cadence, and match snapshots at an even lower cadence.

The physics package already exposes a shared movement simulator, and the server uses it during its movement update. The client still has a separate movement path with custom frame-rate movement, Rapier queries, step-up logic, wall checks, ceiling checks, and visual smoothing. That split is the main source of future prediction drift.

The client store already has concepts for pending inputs and last processed ticks, but those are not the source of truth for reconciliation. The local transform handler mostly ignores small and medium server corrections; it only accepts local corrections when the visual position is extremely far from the server position or when the player is transitioning between major states.

Remote players already use the high-frequency visual store and per-frame interpolation toward received positions. This is a good foundation, but it needs a snapshot history buffer instead of directly chasing the newest transform.

The server movement terrain adapter uses the deterministic procedural map, heightfield ground checks, and boundary clamping. The client movement path also uses Rapier colliders, temporary wall colliders, and richer body clearance checks. Strict prediction should not be enabled until these queries are made consistent enough for normal play.

## Target State

Movement should become input-authoritative from the client and state-authoritative from the server.

The client predicts the local player immediately from local inputs, stores every movement command in a replay buffer, and sends those commands to the server. The server simulates the same commands in order, owns the authoritative transform, and sends the latest processed command sequence back to that client with an authoritative movement snapshot.

When the client receives an authoritative snapshot, it trims acknowledged commands. If its predicted state at the acknowledged sequence differs from the server state, it rewinds to the server state, replays unacknowledged commands, and smooths any visual error over a short correction window.

Remote players should be rendered from an interpolation history. The renderer should sample remote transforms slightly in the past, interpolate between known snapshots, and only extrapolate briefly when updates are late.

Normal gameplay should stop trusting client-reported positions and velocities. Dev fly and explicit development tools can keep a separate transform override path gated behind development mode.

## Non-Goals

This plan does not require rollback combat or lag-compensated hit validation. Those can be layered on later once movement commands and server snapshots are reliable.

This plan does not require making every ability fully predicted in the first pass. Teleports, knockbacks, grapples, and temporary colliders can start as prediction barriers that snap or strongly correct local state.

This plan does not require browser-based testing. Verification should use typechecks, shared simulator tests, server/client protocol tests, and headless simulation harnesses. Browser playtesting remains the user's lane per the project instruction.

## Design Principles

1. The server owns truth; the client owns immediate feel.
2. The movement simulator must be shared, deterministic, and independent of React, Three, and Colyseus.
3. Client input commands are the movement event log.
4. Sequence acknowledgements are required for reconciliation.
5. Fixed movement substeps should drive prediction and authority; render frame delta should not change gameplay results.
6. Small corrections should be hidden visually; large corrections should be honest snaps.
7. Ability movement that cannot be predicted safely should create an explicit prediction barrier.
8. Metrics should make drift visible before stricter authority is enforced.

## Proposed Simulation Rate

Keep the existing room tick and transform broadcast cadence as the outer networking rate.

Add a movement simulation substep rate of 60 Hz. Each room tick processes three fixed movement substeps per alive player. The client also predicts with the same fixed substep rate, independent of render frame rate.

This gives local input a responsive prediction loop while keeping server broadcasts, vitals, match snapshots, bot thinking, and CTF objective checks near their current cadence.

If server CPU becomes a concern, the first implementation can temporarily run prediction at the current server tick rate. The protocol and buffers should still be designed for a separate movement substep rate so the system does not need another migration later.

## Shared Movement Kernel

The shared movement simulator should become the only gameplay movement implementation for predicted local movement and server-authoritative movement.

Recommended kernel responsibilities:

- Convert button inputs plus look yaw into a wish direction.
- Apply ground friction, air acceleration, sprint, crouch, slide, jump, flag carrier penalties, speed multipliers, and gravity.
- Resolve map boundary constraints.
- Resolve ground snapping, step-up, ceiling, and body clearance in a deterministic adapter.
- Preserve full movement state needed for replay, including grounded state, crouch/sprint/slide state, slide timers, grapple state, jetpack fuel, glide state, wall-run state, and wall-run side.
- Return a plain data result: position, velocity, movement state, and optional collision/correction flags.

The kernel should accept a movement terrain adapter instead of calling client-only or server-only systems directly. The adapter should expose deterministic operations such as:

- `getGroundInfo(position)`
- `sweepBody(from, delta, bodyShape)`
- `hasBodyClearance(position, bodyShape)`
- `clampToPlayableBounds(position)`
- `getCollisionRevision()`

The client adapter can wrap current Rapier and heightfield queries at first. The server adapter can use procedural voxel and heightfield queries. The important goal is to move branching movement rules into the shared kernel and keep environment queries behind the adapter.

Before strict authority is enabled, add parity tests that run the same command buffer against the client adapter approximation and the server adapter approximation on representative map samples. The target is not bit-perfect floating point equality in every corner case; the target is low, bounded drift during ordinary movement.

## Input Command Protocol

Replace normal movement input messages with movement command packets.

Each command should contain:

- `seq`: monotonically increasing client movement sequence.
- `buttons`: compact bitmask for movement, combat, ability, interact, reload, unstuck, and any dev-only controls.
- `lookYaw` and `lookPitch`: finite, clamped look direction values.
- `clientTimeMs`: telemetry only, never trusted for simulation time.
- `movementEpoch`: the client's current prediction epoch, used to detect teleports, respawns, and other server movement barriers.

Commands should not include normal gameplay position or velocity.

Command packets may contain one or more commands:

```ts
type MovementCommandPacket = {
  protocolVersion: number;
  firstSeq: number;
  commands: MovementCommand[];
};
```

The client should generate one command per fixed movement substep. It can send commands immediately or in tiny batches, but batching should stay small enough that it does not add visible input latency.

The existing broad input type can remain during migration, but the normal path should eventually split into:

- `movementCommands`: movement command packets.
- `devTransformOverride`: development-only transform override.
- Ability-specific messages that are not per-frame movement.

## Authoritative Server Pipeline

Each server player needs movement authority state:

- Pending command queue.
- Last processed command sequence.
- Last accepted command.
- Last authoritative movement state.
- Movement epoch.
- Dropped, duplicate, and late command counters.
- Last correction sent time.

On command receipt, the server should:

1. Reject malformed packets and non-finite values.
2. Enforce monotonic sequence ordering, with a defined sequence wrap strategy.
3. Drop duplicate or already processed commands.
4. Clamp look pitch and normalize yaw.
5. Rate-limit command intake.
6. Cap per-player queue length.
7. Store sanitized commands in order.

During each room tick, the server should process a fixed number of movement substeps per alive player:

1. Pop the next queued command if available.
2. If no command is available, hold the last accepted movement command for a short grace window.
3. After the grace window, use neutral movement buttons while preserving latest look direction.
4. Simulate one fixed movement step through the shared kernel.
5. Apply server-owned state changes such as flag carrier speed penalties, active speed multipliers, forced roots, spawn locks, and dev tools.
6. Write the authoritative position, velocity, look direction, and movement state.
7. Record the processed sequence for acknowledgement.

Do not process unlimited catch-up commands after a network stall. If a player's queue is far behind, process up to a small catch-up budget, drop stale backlog if needed, increment the movement epoch, and send a stronger correction.

## Self Correction Message

The broadcast transform stream can stay compact and shared by all clients. Local reconciliation needs a targeted message because the acknowledged input sequence is private to that client.

Add a targeted self-authority message:

```ts
type SelfMovementAuthority = {
  serverTick: number;
  serverTime: number;
  ackSeq: number;
  movementEpoch: number;
  position: Vec3;
  velocity: Vec3;
  lookYaw: number;
  lookPitch: number;
  movement: PlayerMovementState;
  correctionReason?: 'normal' | 'spawn' | 'respawn' | 'teleport' | 'unstuck' | 'knockback' | 'epoch_mismatch';
};
```

Send this to each alive human player after movement simulation. It can be sent every room tick at first. Later, it can be rate-limited when the client is clean and only sent every tick while errors, barriers, or high-risk states are active.

The existing quantized transform broadcast can continue to carry remote positions, velocities, look direction, and movement bits. Local clients should prefer `SelfMovementAuthority` for reconciliation and ignore their own entry in the shared transform broadcast except during migration.

## Client Prediction State

The client needs a non-reactive prediction controller for the local player. It should sit beside the high-frequency visual store rather than inside React render state.

Recommended state:

- Current predicted simulation state.
- Last authoritative base state.
- Command buffer keyed by sequence.
- Per-command predicted post-state for debugging and fast error measurement.
- Last acknowledged sequence.
- Movement epoch.
- Visual correction offset.
- Correction metrics.

On each fixed movement substep, the client should:

1. Sample current input.
2. Create a command with the next sequence.
3. Add it to the command buffer.
4. Simulate one shared movement step locally.
5. Store the predicted post-state for that sequence.
6. Update the visual store and camera from the predicted state.
7. Queue the command for network send.

The command sequence should increment only when a command is generated. It should not increment once per render frame if no fixed movement substep ran.

## Reconciliation Algorithm

When `SelfMovementAuthority` arrives:

1. Ignore it if its movement epoch is older than the client epoch.
2. If its movement epoch is newer, clear the command buffer, apply the server state, snap or strongly smooth, and resume from the new epoch.
3. Find the predicted post-state for `ackSeq`.
4. Measure position, velocity, grounded state, and movement mode error against the server state.
5. Drop all commands with sequence less than or equal to `ackSeq`.
6. If error is under epsilon, keep the current predicted state and only refresh the authoritative base.
7. If error is above epsilon, reset simulation to the server state and replay all unacknowledged commands in order.
8. Preserve the rendered camera position by storing the old rendered position minus the new predicted position as a visual correction offset.
9. Decay the visual correction offset over a short configurable window.

Suggested thresholds:

| Error Type | Behavior |
| --- | --- |
| Position under 3 cm and velocity under 5 cm/s | No visual correction. |
| Position under 35 cm | Rewind/replay, decay visual offset over 80-120 ms. |
| Position under 1.5 m | Rewind/replay, decay over 120-180 ms, record medium correction. |
| Position 1.5 m or larger | Snap or near-snap, record hard correction. |
| Different movement epoch | Snap or strong correction based on reason. |

Do not smooth through a respawn, unstuck, teleport, death, team switch, hero switch, or map load. These are state discontinuities, not drift.

## Remote Player Interpolation

Remote players should not directly chase the newest transform. Give each remote player a transform history buffer.

Each received transform snapshot should store:

- Server tick.
- Server time.
- Position.
- Velocity.
- Look direction.
- Movement bits.
- Wall-run side.

The renderer should estimate server time from recent messages, subtract the existing interpolation delay, and sample the two snapshots around that render timestamp.

Rules:

- Interpolate position and yaw when two snapshots bracket the render timestamp.
- Extrapolate with velocity only when the render timestamp is newer than the latest snapshot.
- Cap extrapolation to a small window, such as 100 ms.
- Freeze or fade intent animation when a remote player is stale beyond the extrapolation cap.
- Snap remote players after teleports, respawns, and movement epoch changes.

Remote animation should continue to use movement bits and velocity, but the visual position should come from the interpolation buffer.

## Ability Movement And Prediction Barriers

Ability movement should be integrated in tiers.

Tier 1: ordinary movement only. Predict walking, sprinting, crouching, sliding, jumping, falling, and flag-carrier speed changes. Treat all server-owned impulses and teleports as barriers.

Tier 2: discrete impulses. Predict safe local impulses that are deterministic and already known to the client, such as a rocket jump impulse. The command or ability event should include enough identity data for the server to validate and acknowledge it.

Tier 3: teleports and displacement. Blink, Shadow Step, unstuck, respawn placement, Timebreak knockback, and similar discontinuities should increment movement epoch until each path has explicit prediction rules.

Tier 4: continuous special movement. Grappling, wall-running, gliding, jetpack movement, and temporary collision objects should move into the shared kernel only when both the client and server can query the same relevant collision state.

Prediction barriers should:

- Increment `movementEpoch` on the server.
- Clear or invalidate older client commands.
- Include a correction reason.
- Send full authoritative movement state.
- Prevent replaying commands across the discontinuity.

## Dynamic Collision And Map Revisions

Prediction must account for collision state.

Temporary movement blockers, player-created walls, and future voxel destruction should each have an authoritative collision revision. Movement commands and self-authority messages should carry the revision the client is predicting against.

If the server simulates a player against a newer collision revision than the client has loaded, send a prediction barrier or hold strict corrections until the client acknowledges the revision. This avoids punishing the client for predicting through geometry it has not received yet.

The first pass can ignore purely visual effects. Only collision-affecting objects need revision tracking.

## Anti-Cheat And Validation

The new system should remove normal client transform trust.

Server validation should include:

- No non-finite numbers.
- Bounded look pitch.
- Monotonic command sequence.
- Command rate cap.
- Queue length cap.
- Per-tick catch-up cap.
- Button bitmask validation.
- Development-only guard for transform overrides.
- Maximum correction and divergence telemetry per player.

The server should not ban or kick during the first rollout. It should log suspicious patterns and force authoritative snaps. Enforcement can come after false positives are understood.

## Observability

Add metrics before making the server strict.

Server metrics:

- Commands received per second.
- Commands processed per tick.
- Input queue length per player.
- Duplicate, dropped, late, and malformed commands.
- Last acknowledged sequence age.
- Movement simulation time.
- Correction reason counts.
- Hard snap counts.

Client metrics:

- Prediction command buffer length.
- Acknowledgement latency in commands and milliseconds.
- Position error at acknowledgement.
- Velocity error at acknowledgement.
- Replay command count.
- Visual correction offset length.
- Hard snap count.
- Remote interpolation buffer depth.
- Remote extrapolation time.

Expose summary counters through the existing performance tooling so divergence can be measured without opening the browser as a required test step.

## Implementation Slices

### Slice 1: Instrument Current Drift

Add lightweight telemetry around current local transform acceptance and server transform broadcasts.

Acceptance criteria:

- The server records how far client-reported positions differ from server-simulated positions before trust is removed.
- The client records how often local server transforms would correct the predicted player if the current large threshold were smaller.
- No gameplay behavior changes yet.

### Slice 2: Formalize Movement Commands

Introduce movement command types, button bitmasks, sequence helpers, and command packet handling.

Acceptance criteria:

- The client can generate fixed-step movement commands with monotonic sequences.
- The server can receive, sanitize, queue, and acknowledge commands without using them for authority yet.
- Existing movement still works through the old path during this slice.

### Slice 3: Build The Prediction Controller

Create the client-side prediction controller and command buffer around the shared movement kernel.

Acceptance criteria:

- The local player can be simulated from command replay in a headless or non-browser harness.
- Commands are stored with predicted post-states.
- The controller can rewind to a supplied authoritative state and replay unacknowledged commands.
- React state is not updated every movement substep.

### Slice 4: Unify Ordinary Movement

Move ordinary walking, sprinting, crouching, sliding, jumping, falling, and flag-carrier modifiers into the shared kernel.

Acceptance criteria:

- Client and server ordinary movement use the same kernel.
- Existing client-only movement helpers either become terrain adapter calls or visual-only helpers.
- Simulator parity tests cover ground movement, air strafing, jumping, sliding, crouch transitions, boundary clamping, and flag speed penalties.

### Slice 5: Server Authoritative Movement Behind A Flag

Make the server simulate queued commands instead of accepting normal client transforms, guarded by a movement authority feature flag.

Acceptance criteria:

- Normal gameplay input no longer needs client position or velocity when the flag is enabled.
- Dev fly keeps an explicit development-only override path.
- The server sends `SelfMovementAuthority` with full movement state and latest acknowledged sequence.
- The client can still run with the old path when the flag is disabled.

### Slice 6: Local Reconciliation And Smoothing

Enable client rewind/replay from `SelfMovementAuthority`.

Acceptance criteria:

- Acknowledged commands are trimmed.
- Small drift is corrected without visible snapping.
- Medium drift decays through a visual offset.
- Large drift snaps with metrics.
- Respawn, unstuck, teleport, and knockback reasons bypass ordinary smoothing.

### Slice 7: Remote Interpolation History

Replace direct remote target chasing with interpolation history buffers.

Acceptance criteria:

- Remote render position samples historical server snapshots with the configured interpolation delay.
- Extrapolation is capped.
- Remote teleport/respawn barriers snap cleanly.
- Remote animation still receives movement bits, velocity, and look direction.

### Slice 8: Ability Barriers And Selected Prediction

Classify each movement-affecting ability as predictable, barrier-only, or later work.

Acceptance criteria:

- Server-owned displacement increments movement epoch.
- Client command replay never crosses an epoch change.
- Rocket-jump-style impulses can be predicted only if server and client share the same event identity and impulse calculation.
- Grapple, wall-run, temporary collider, and map-revision cases are documented before strict prediction applies to them.

### Slice 9: Remove The Old Trust Path

Delete or quarantine normal client transform acceptance.

Acceptance criteria:

- Normal input messages do not carry position or velocity.
- The server ignores position and velocity from non-dev movement messages.
- The local player uses self-authority reconciliation, not the shared remote transform stream.
- Drift and correction metrics stay inside agreed thresholds in automated simulation.

## Verification Plan

Use automated verification first.

Recommended tests:

- Shared simulator deterministic replay from a fixed initial state and fixed command buffer.
- Rewind/replay after an injected authoritative correction.
- Sequence handling for duplicate, old, missing, and wrapped commands.
- Fixed-step accumulator behavior under low, normal, and high render frame rates.
- Server command queue behavior under jitter, bursts, and temporary stalls.
- Movement epoch behavior for respawn, unstuck, teleport, and knockback.
- Remote interpolation sampling, extrapolation cap, and stale snapshot handling.
- Typechecks for all touched packages.

Recommended headless harness:

1. Generate a procedural map from a fixed seed.
2. Spawn one local player state.
3. Generate a deterministic command script with movement, jumps, slides, stops, and look changes.
4. Run the script through the client prediction controller.
5. Run the same commands through the server simulation.
6. Inject packet delay and correction messages.
7. Assert final position, velocity, movement state, replay count, and correction counts.

Do not make browser testing a required completion gate for these slices.

## Rollout Strategy

Ship behind a development feature flag first.

Recommended rollout order:

1. Record current drift metrics.
2. Add command protocol in parallel with the old input path.
3. Add prediction controller and headless tests.
4. Enable shared ordinary movement locally.
5. Enable server authority for one local developer session.
6. Enable reconciliation with permissive smoothing thresholds.
7. Enable remote interpolation history.
8. Classify ability movement and add barriers.
9. Remove normal client transform trust.
10. Tune correction thresholds and packet cadence.

Keep a kill switch until movement authority has survived ordinary movement, CTF flag carrying, respawn, unstuck, and the highest-mobility hero abilities.

## Open Decisions

The recommended target is 60 Hz movement substeps with 20 Hz room broadcasts, but the team should confirm the CPU budget after command queue instrumentation.

The server and client collision adapters need a firm parity target. If the current client Rapier path and server voxel path diverge too much, ordinary movement prediction should use a simpler shared voxel query path first, with Rapier kept as a rendering and effects aid.

Movement-affecting temporary colliders need an authoritative revision strategy before strict prediction applies to them.

Future voxel destruction should integrate through collision revisions and prediction barriers. It should not silently change collision under the client without an epoch or revision acknowledgement.

## Definition Of Done

The implementation is complete when normal gameplay movement no longer trusts client position or velocity, the local player predicts immediately from input commands, the server acknowledges processed command sequences, the client rewinds and replays unacknowledged commands from authoritative snapshots, remote players render from interpolation history, and automated simulation shows bounded correction behavior across ordinary movement, respawn, unstuck, and ability barriers.
