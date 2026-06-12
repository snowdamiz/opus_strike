# Network Microstutter Elimination Plan

Reader: internal engineer working on online gameplay smoothness.

Post-read action: implement a deterministic, prediction-owned online movement pipeline that makes a local solo custom match feel as smooth as practice mode, then verify it with instrumentation and targeted non-browser tests.

## Problem Statement

Practice mode is offline and feels smooth. A locally hosted development custom match, even solo, still has fast repeated microstutters that resemble FPS hitching. Because the same renderer is substantially smoother offline, the most likely cause is not raw GPU frame time. The online path is disturbing the local camera or local player state at network cadence.

The fix should not be a single smoothing constant. The code already has prediction, server authority, transform streams, and remote interpolation. The solution should make ownership explicit:

- The local camera is driven by client prediction on the render frame.
- Server authority corrects that prediction only at a deterministic point in the frame.
- Vitals and remote replication cannot replace local simulation state during normal play.
- Server movement drains client commands at a stable cadence instead of reflecting packet arrival jitter.
- Legacy parallel replication paths are confirmed unused and removed.

## Current Evidence

- The client produces fixed 60 Hz movement commands in `PlayerController`, batches them, and sends `movementCommands` through the network context.
- The client applies local movement through `MovementPredictionController` and renders the camera from predicted visual position.
- The server runs gameplay at 20 Hz. Each tick drains queued movement commands, simulates shared movement substeps, and sends a private `selfMovementAuthority` ack to the owning client.
- The server also sends `playerTransformsV2` and `playerVitals`. `playerTransformsV2` is used for remote interpolation. `playerVitals` carries health, abilities, flags, stats, and movement/vital state.
- Colyseus schema intentionally excludes runtime transform and vitals fields, so schema patches are not the main movement overwrite path.
- The local client ignores shared transform entries for self after receiving `selfMovementAuthority`, but those self transforms are still sent and still advance global tick/server time in the client handler.
- The `selfMovementAuthority` handler currently mutates prediction and visual state immediately from the network callback. That callback is not aligned with the render frame.
- `playerVitals` currently replaces the local player object for the owning player. During online play this can re-enter React and can refresh movement/vital fields that the local simulation should own.
- Correction policy treats small position errors, velocity errors, and movement-mode differences as reasons to replay and potentially begin a visual correction. Repeated tiny corrections at 20 Hz are exactly the kind of artifact that feels like FPS microstutter.
- There are apparent legacy or migration paths: `gameState`/`updateGameState`, `playerTransforms` v1, and `buildPlayerTransformsPayload`. These should be confirmed unused and removed during the implementation.

## Working Root Cause

The online local-player path has too many writers and too many clocks.

Even on localhost, messages arrive between render frames. The current path can update prediction, visual transforms, local player objects, tick/server time, and vitals from network callbacks. If authority acks contain small deterministic differences or arrive in a slightly uneven 20 Hz pattern, the camera receives frequent tiny correction offsets. If React state also churns from local vitals or self transform bookkeeping, the symptom can feel like renderer hitching even when GPU frame time is fine.

The intended final shape is not "more smoothing everywhere." It is a stricter ownership boundary plus measured, frame-aligned correction.

## Target Architecture

1. Frame-owned local authority application

Network callbacks should enqueue `selfMovementAuthority` messages into a small non-reactive buffer. `PlayerController` should drain that buffer at the top of its `useFrame` callback, before producing new movement commands, using the frame clock time. This makes prediction correction deterministic relative to rendering.

The network handler should not directly call prediction reconciliation, update visual transforms, or publish local player state during normal movement.

2. Prediction-owned local simulation

During active online play, local position, velocity, look, movement mode, movement epoch, and ack sequence should be owned by the prediction controller plus the non-reactive visual store.

`gameStore.localPlayer` can still exist for UI and gameplay metadata, but local vitals patches must preserve prediction-owned transform and movement fields unless the server sends an explicit authority barrier such as spawn, respawn, teleport, knockback, unstuck, death, hero swap, or collision-revision reset.

3. Remote-only transform replication

`playerTransformsV2` should be remote-player replication. The server should omit the recipient's own transform during normal play because `selfMovementAuthority` is the owner-specific stream. Full snapshots can still include self during join, spectating, countdown bootstrap, or explicit barriers if needed.

On the client, transform messages that contain no actionable remote players should not publish global game-store updates just to advance tick/server time.

4. Stable server command drain

The server should process human movement from a small input jitter buffer. Target a stable number of substeps per server tick, normally 3 commands for 60 Hz movement under a 20 Hz server tick.

Recommended behavior:

- Maintain a small target pending-command buffer, initially 3 to 6 commands.
- Process exactly `SERVER_MOVEMENT_SUBSTEPS_PER_TICK` commands per tick when the buffer is healthy.
- Catch up gradually only when backlog exceeds the target by a real margin.
- Track underflow, catchup, queue length before/after, processed count, and ack interval.
- Keep local prediction immediate; the input buffer only stabilizes server authority and acks.

5. Correction hysteresis

The prediction controller should distinguish correctness from visual presentation.

Recommended policy:

- No visual correction for sub-deadband errors. Update authority-owned resources and keep moving.
- Soft correction only when small errors persist across multiple acks or exceed an integrated error budget.
- Hard snap only for authority barriers or large position errors.
- Do not restart a 100 ms correction every 50 ms. Blend new offsets into an existing correction or let the old correction finish when the new error is smaller.
- Classify movement-mode mismatches. Only position-affecting mismatches should force replay or visual correction.

6. Monotonic timing

Use the frame clock or `performance.now()` for local visual correction timing. Use server epoch time for game events, cooldowns, and authoritative payloads. Do not mix wall-clock `Date.now()` into visual correction start times from asynchronous network callbacks.

Add a lightweight client server-time-offset estimator from existing ping and server-time payloads if event alignment needs it, but local camera smoothing should be monotonic and frame-owned.

## Implementation Phases

### Phase 0: Baseline Instrumentation

Add diagnostics before changing behavior.

Client metrics:

- Commands generated per second, sent per second, commands per packet.
- Pending movement commands before flush.
- Authority acks received per second, ack interval p50/p95, latest ack sequence.
- Authority acks applied per frame, position error, velocity error, replayed commands.
- Visual correction offset magnitude and duration.
- Local player reactive updates per second, split by vitals, transforms, self authority, and local gameplay actions.
- Transform messages received, self-only transform messages, remote transform snapshots added.

Server metrics:

- Per-player command queue length before and after tick.
- Commands processed per tick.
- Underflow ticks, catchup ticks, dropped commands, duplicate commands.
- Self-authority sends per second and ack interval.
- Tick duration and event loop delay p95.

Expose this through a dev-only network diagnostics object, sampled logs, or an existing performance overlay. Keep it disabled or sampled in production.

### Phase 1: Apply Self Authority On The Render Frame

Create a non-reactive pending authority queue for the local player. The network message handler should only validate, record telemetry, and enqueue.

At the start of `PlayerController`'s frame:

- Drain queued self-authority messages in sequence order.
- Drop stale acks already superseded by a newer applied ack unless they carry a barrier.
- Apply reconciliation with the frame clock timestamp.
- Record correction metrics.
- Then generate the frame's local movement commands and prediction substeps.

This phase should be behavior-preserving except for timing. It removes a major source of asynchronous camera mutation.

### Phase 2: Split Local Simulation From Local Vitals

Replace local `playerVitals` handling with a local-vitals patch path.

The patch may update:

- health and max health
- ultimate charge
- ability cooldowns, charges, and active flags
- team, hero, ready state, rank, flags, stats, respawn state

The patch must not update active local position, velocity, look, or movement fields while the local player is alive and prediction-owned. Exceptions must be explicit authority barriers.

Also reduce `PlayerController` subscriptions to stable values and actions. It should avoid subscribing to the entire `localPlayer` object. In-frame reads can use non-reactive snapshots.

### Phase 3: Stop Sending Normal Self Transforms

Change transform replication so normal `playerTransformsV2` payloads exclude the receiving client's own player. Keep self in explicit full/bootstrap payloads only if still needed.

Client-side, retain a guard that ignores self transforms, but after the server omission is confirmed, remove obsolete local self-transform fallback code. Do not keep a second correction path.

### Phase 4: Add Server Input Jitter Buffer

Update the server movement loop to keep a small input buffer and drain a stable command count per tick.

Acceptance behavior:

- Solo localhost should settle into zero underflows after warmup.
- Queue length should hover around the configured target.
- Acks should advance by 3 sequences per 20 Hz tick in steady state.
- Catchup should be rare in local development and gradual under real jitter.

Tune the client flush policy after telemetry. A good starting point is to flush when there are 3 commands ready or a maximum flush age expires, while preserving the existing max packet size for hitches.

### Phase 5: Correction Policy Upgrade

Update the prediction controller with deadband, hysteresis, and non-resetting soft correction.

Suggested starting thresholds:

- Deadband: position error below 0.06 to 0.08 m with low velocity error should not create a visual correction.
- Soft correction: errors below the current medium threshold should correct only after repeated acks or integrated error.
- Hard correction: keep existing large-error and authority-barrier snaps.

Tune these with the new diagnostics. The target is not hiding real divergence; it is avoiding visible camera movement for harmless quantization and tick-cadence noise.

### Phase 6: Confirm And Remove Legacy Paths

Before finishing the implementation, confirm these are legacy:

- `gameState` server message type and `updateGameState` client action.
- `playerTransforms` v1 message type and handler.
- `buildPlayerTransformsPayload`.
- Dev schema fallback polling, unless it is still intentionally used.
- Any local self-transform fallback left after `selfMovementAuthority` is required.

If confirmed unused, remove them in the same change set. Do not leave parallel movement replication paths behind.

## Verification Plan

Non-browser verification:

- `pnpm --filter @voxel-strike/client typecheck`
- `pnpm --filter @voxel-strike/server typecheck`
- `pnpm --filter @voxel-strike/server test:movement-queue`
- `pnpm --filter @voxel-strike/server test:movement-parity`
- `pnpm --filter @voxel-strike/server test:authority`
- Extend `bench:room-load` or add a focused local solo movement harness that feeds 60 Hz commands with jitter patterns and asserts stable ack cadence plus correction budgets.

Manual browser feel testing is intentionally left to the user per project instructions.

Success metrics for a solo local custom match:

- Hard corrections: 0 after spawn warmup.
- Authority barriers: 0 during ordinary walking, jumping, sliding, and hero movement.
- Soft visual corrections: near 0 per second during ordinary movement, with no repeated 20 Hz sawtooth.
- Ack cadence: stable 20 Hz server sends, with ack sequence advancing by 3 in steady state.
- Server queue underflow: 0 after warmup on localhost.
- Local self transform messages: 0 during normal active play.
- Local player reactive updates: no network-cadence updates from transforms or self authority; vitals updates are low frequency and UI-only.
- User feel: online solo local movement and camera should be indistinguishable from practice mode except for intentional server-authority events.

## Risks And Guardrails

- Do not weaken server authority. The client may own prediction presentation, not truth.
- Do not let vitals patches silently stomp movement state.
- Do not hide real corrections from respawn, teleport, knockback, collision revision changes, or anti-cheat barriers.
- Keep remote interpolation separate from local prediction. Remote players need buffered interpolation; the local player needs immediate prediction.
- Keep diagnostics until the fix is proven, then either hide them behind dev flags or keep lightweight counters for future regressions.
