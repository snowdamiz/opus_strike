# PlayerController Reorganization And Test Plan

## Reader And Outcome

This plan is for an engineer who needs to reorganize the local player frame loop for performance and maintainability.

After reading it, they should be able to split the frame loop into smaller, testable phases while preserving gameplay feel, prediction correctness, input timing, ability behavior, camera timing, audio timing, and network command semantics.

## Why This Work Exists

The local player frame loop currently acts as the ordering spine for the in-game experience. It does far more than movement:

- Drains server authority corrections.
- Handles hero swaps and inactive/death states.
- Samples input and applies input exclusivity rules.
- Runs local ability prediction and practice-mode ability behavior.
- Builds movement commands and batches them for the server.
- Steps local prediction at fixed movement substeps.
- Updates first-person camera, audio listener, viewmodel signals, slide signals, visual transforms, and anti-cheat trace data.

That makes the loop hard to optimize safely. A direct extraction can reduce frame overhead, but a full reorganization needs test coverage first because many dependencies are order-sensitive and one-frame regressions are easy to introduce.

## Goals

- Keep the local player frame path smooth under normal play, correction-heavy play, and ability-heavy play.
- Reduce per-frame allocations in the local player path.
- Reduce repeated store reads inside one frame.
- Make the frame phases testable without mounting the full React and Three scene.
- Preserve the existing gameplay ordering contract.
- Keep diagnostics available in development while avoiding production measurement overhead.
- Leave no legacy duplicate frame code after each slice lands.

## Non-Goals

- Do not redesign movement physics.
- Do not change hero ability rules.
- Do not alter server authority semantics.
- Do not add browser-based verification to this work. Manual browser playtesting remains user-owned.
- Do not introduce a new state management library.
- Do not move rendering objects into the pure frame pipeline.

## Current Ordering Contract

The reorganized loop must preserve this order:

1. Read the latest local player and frame clock.
2. Drain self movement authority before any new prediction.
3. Apply hard or medium authority corrections before ability and command work.
4. Reset hero-specific local refs immediately on hero swap.
5. Handle disabled, dead, inactive, and death-camera paths before live movement.
6. Normalize raw input into frame input before ability logic.
7. Apply ability locks and input exclusivity before command construction.
8. Flush movement before movement-barrier abilities.
9. Run hero ability prediction before the movement command substep loop when ability state changes movement.
10. Confirm ability-mutated movement transforms before creating new movement commands.
11. Build command input and ability cast hints once for the frame.
12. Step local movement prediction using fixed substeps.
13. Flush pending movement commands after substeps.
14. Update movement refs from the final predicted state.
15. Update slide transitions, movement audio, camera, audio listener, visual movement, visual transform, slide intensity, and trace data after prediction.
16. Keep camera and first-person effects sampling the updated predicted position in the same frame.

Any proposed extraction that changes this order needs a test proving the new order is intentional.

## Target Architecture

### Frame Runner

Create a small local player frame runner that receives a frame context and returns a structured frame result.

The runner should be plain TypeScript wherever possible. It should not import React hooks. It should not directly know about JSX. It should receive imperative dependencies, refs, and store facades from the React component.

Responsibilities:

- Own the high-level phase order.
- Keep production diagnostics out of the hot path unless diagnostics are enabled.
- Maintain one entry point for the React `useFrame` callback.
- Return enough result metadata for tests to assert phase behavior.

### Frame Context

Create a frame context object once per frame. Prefer mutating a reusable context object over allocating a fresh deep object every frame.

Context fields:

- Frame timing: raw delta, clamped delta, epoch time, monotonic time, elapsed scene time.
- Player identity and hero id.
- Control state: enabled, playing/countdown state, pointer/touch control active, death visual state.
- Input state: raw input, inactive input fallback, normalized frame input, command input.
- Local refs: movement refs, ability refs, camera refs, pending command refs.
- Store facade: read methods and write methods grouped by domain.
- Side-effect facade: audio, viewmodel pose, effects, network flush, trace recording.

The frame context should make repeated reads explicit. For example, read `bombTargeting` once for ability input and again only if the design requires a later post-ability sample.

### Store Facade

Introduce a narrow facade around high-frequency store operations used by the frame runner.

Read side:

- Local player.
- Game phase.
- Bomb, air strike, and grapple-trap targeting flags.
- Visual player position for inactive/death paths.
- Chronos Aegis durability.
- Latest local movement for trace data.
- Player ping and map seed for trace data.

Write side:

- Local player updates.
- Local visual transform.
- Local movement and viewmodel movement signals.
- Slide intensity.
- Hero targeting toggles.
- Ultimate effect state.
- Practice-mode projectile/effect state.

This facade is not a new store. It is a seam for tests and a way to avoid scattering `getState()` calls through every phase.

### Phase Modules

Split the frame runner into these phases.

#### 1. Authority Phase

Inputs:

- Local player.
- Monotonic frame time.
- Pending authority queue.

Outputs:

- Possibly corrected local player snapshot.
- Whether the movement command buffer must reset.
- Authority diagnostics.

Performance targets:

- Avoid `map` allocation when recording applied authority metrics. Use a scratch array or add a diagnostics method that accepts authority applications directly.
- Only call high-resolution timing when there is pending authority work.

Tests:

- No pending authority does not touch diagnostics or reset command buffers.
- Normal corrections do not force local reactive updates.
- Medium/hard/non-normal corrections update position, velocity, movement, look yaw, and look pitch before prediction.
- Multiple corrections choose the newest meaningful correction.

#### 2. Lifecycle Phase

Inputs:

- Current local player.
- Hero id.
- Enabled state.
- Game phase.
- Death visual state.

Outputs:

- Early exit type: no player, disabled, inactive/dead, or live.
- Required resets.
- Camera mode for inactive/death paths.

Performance targets:

- Consolidate repeated reset bundles into named reset helpers.
- Avoid repeated object spreads for static inactive movement where mutation-safe shared constants are sufficient.

Tests:

- Missing local player resets input, movement, viewmodel, sounds, action locks, and death camera.
- Disabled state keeps camera and visual transform updated without live prediction.
- Dead or inactive state updates death camera when required and does not create movement commands.
- Hero swap clears hero-specific refs and targeting flags exactly once.

#### 3. Input Phase

Inputs:

- Raw input state.
- Pointer lock and touch control state.
- Hero id.
- Action lock state.
- Targeting flags.
- Chronos Lifeline queue state.
- Previous exclusive hold input.

Outputs:

- Raw frame input.
- Normalized frame input.
- Local ability input.
- Server primary fire, ability, reload, and crouch values.
- Movement barrier flag.

Performance targets:

- Avoid fresh object spreads when converting inactive input or cast action fields where a reusable scratch input can be used.
- Keep frame input immutable for tests, but allow the implementation to use a scratch object internally.

Tests:

- Pointer unlocked with no touch control yields inactive movement input.
- Chronos Lifeline queue transforms primary/secondary commit input correctly.
- Ability locks suppress disallowed actions but preserve allowed continuing holds.
- Phantom reload suppresses non-blink casts.
- Blaze bomb targeting suppresses server primary fire.
- Movement-barrier inputs force a movement flush before ability handling.
- Crouch pressed is edge-triggered once.

#### 4. Ability Phase

Inputs:

- Ability context.
- Hero definition.
- Frame input.
- Practice mode flag.
- Ability system refs and hero ability handlers.

Outputs:

- Updated ability refs.
- Practice-mode predicted state overrides.
- Ability side effects.
- Whether local movement was mutated by ability prediction.

Performance targets:

- Build the ability context once and mutate only the fields that legitimately change.
- Avoid creating short-lived closures inside the frame path for ability callbacks.
- Extract hero-specific ability handlers into per-hero phase functions.

Tests:

- Phantom blink in practice updates predicted position, creates void zone, and starts the expected lock.
- Phantom shield activates practice ability state and local cast feedback.
- Phantom veil consumes ultimate and starts pose lock in practice mode.
- Blaze rocket jump applies predicted movement and cooldown in practice mode.
- Blaze bomb targeting blocks primary fire but not movement.
- Hookshot grapple, earth wall, chain hook, drag hook, and grapple physics preserve existing call order.
- Chronos Lifeline queue, commit, self-heal, ally-heal, Timebreak, Ascendant Paradox, and primary fire keep their current input semantics.

#### 5. Prediction And Command Phase

Inputs:

- Corrected or current predicted state.
- Command input.
- Ability cast hints.
- Movement accumulator.
- Pending command buffer.
- Local prediction API.

Outputs:

- Final predicted state.
- Substeps this frame.
- Pending commands to flush.
- Updated visual interpolation fixed-step samples.
- Movement timing diagnostics.

Performance targets:

- Reuse command input and ability hint scratch structures where possible.
- Avoid allocating visual position objects after every frame by writing into reusable mutable vectors.
- Keep fixed-substep loop bounded by the existing max packet command count.

Tests:

- Accumulator clamps to max packet capacity.
- One frame can produce zero, one, or multiple substeps as expected.
- Command sequence advances once per substep.
- Pending crouch pressed is consumed by the first generated command only.
- Ability cast hints are attached to generated commands.
- Forced flush clears force flag and pending reload state.
- Visual interpolation resets when prediction jumps beyond the configured threshold.

#### 6. Post-Prediction Presentation Phase

Inputs:

- Final predicted state.
- Smoothed visual position.
- Movement refs.
- Camera refs.
- Audio refs.
- Hero stats.
- Frame input.

Outputs:

- Updated movement refs.
- Slide start/stop side effects.
- Walking sound update.
- Camera transform.
- Audio listener transform.
- Viewmodel movement signal.
- Local visual movement signal.
- Local visual transform.
- Slide intensity signal.

Performance targets:

- Reuse mutable vectors for visual position and smoothed visual position.
- Compute horizontal speed once and share it between viewmodel and walking sound.
- Avoid reading the local player from the game store unless trace data needs post-ability movement state.

Tests:

- Slide start triggers only on false-to-true transition.
- Slide stop triggers only on true-to-false transition.
- Hookshot swing terrain contact fires only on landing.
- Camera uses smoothed visual Y and current crouch height.
- Audio listener receives camera position, forward, and up after camera matrix update.
- Visual movement contains updated grounded, sprinting, crouching, sliding, grapple, and slide-time values.
- Slide intensity is zero when not sliding and bounded when sliding.

#### 7. Trace Phase

Inputs:

- Final command input.
- Final movement snapshot.
- Hero id and active ability ids.
- Map seed, ping, tick, collision revision.
- Frame timing.

Outputs:

- Optional trace frame.

Performance targets:

- Run only at the existing trace cadence.
- Reuse ability id arrays and avoid sorting unless the trace will be recorded.

Tests:

- Trace is skipped until cadence elapses.
- Trace includes active ability ids from both active state and current inputs.
- Movement barrier is set for teleport and knockback inputs.
- Ground data is included only when grounded.
- Ping, frame-rate band, tick, collision revision, and map seed are copied from the current frame.

## Implementation Slices

### Slice 1: Add Test Harness And Baseline Tests

Before moving logic, create a frame-runner test harness with fake stores, fake ability handlers, fake camera/audio objects, and fake local prediction methods.

Deliverables:

- A pure TypeScript test helper that can create a local player frame scenario.
- Golden tests for disabled, inactive/dead, normal live movement, authority correction, and one representative ability per hero.
- No production behavior changes except optional export of pure helpers.

Verification:

- Client typecheck.
- Existing local prediction tests.
- Existing visual/performance tests.
- New frame-runner tests.

### Slice 2: Extract Diagnostics-Gated Frame Entry

Move the outer frame body into a named runner while preserving all logic in the same order.

Deliverables:

- A stable production path that calls the runner directly.
- A development path that wraps the runner in frame-work measurement.
- No phase-level logic movement yet.

Verification:

- Frame-runner tests pass.
- Existing movement, visual, and build checks pass.
- Performance diagnostics still report the player controller label in development.

### Slice 3: Extract Authority And Lifecycle Phases

Move authority draining and early-exit lifecycle handling into phase functions.

Deliverables:

- Authority phase with direct tests for correction selection and diagnostics.
- Lifecycle phase with direct tests for reset behavior and early exits.
- Duplicate reset bundles replaced by named reset helpers.

Verification:

- Tests prove no commands are generated on no-player, disabled, or dead/inactive paths.
- Tests prove authority correction happens before live prediction.

### Slice 4: Extract Input Normalization

Move raw input gating, action locks, Chronos Lifeline input rewriting, reload behavior, primary-fire server rules, and crouch edge detection into input phase functions.

Deliverables:

- A tested input phase that returns frame input and command input.
- Scratch input support where safe.
- Fewer object spreads in the live frame path.

Verification:

- Hero-specific input tests pass for Phantom, Blaze, Hookshot, and Chronos.
- Existing local prediction tests pass.

### Slice 5: Extract Hero Ability Phase

Move hero ability execution into per-hero phase functions called from the shared ability phase.

Deliverables:

- Separate per-hero handlers for local frame ability behavior.
- Shared ability context construction.
- Tests for practice-mode prediction and network-mode dispatch decisions.

Verification:

- Per-hero frame tests pass.
- No duplicate old ability blocks remain in the frame runner.

### Slice 6: Extract Prediction And Command Phase

Move movement command construction, fixed substep prediction, command buffering, movement timing diagnostics, and command flushing into a prediction phase.

Deliverables:

- A tested prediction phase.
- Scratch objects for command input and visual interpolation where safe.
- No change to max substep or packet behavior.

Verification:

- Local prediction tests pass.
- Movement harness passes.
- New prediction phase tests cover catchup frames and forced flush.

### Slice 7: Extract Presentation And Trace Phases

Move post-prediction camera/audio/viewmodel/visual updates and trace recording into final phases.

Deliverables:

- Presentation phase tests for camera, audio, slide, and visual store writes.
- Trace phase tests for cadence and trace payload.
- Frame runner now reads like an ordered list of phases.

Verification:

- Client typecheck.
- Client build.
- Existing visual/performance tests.
- Local prediction tests.
- Movement harness.

### Slice 8: Allocation Pass

After behavior is covered, replace safe per-frame allocations with reusable scratch values.

Targets:

- Authority metric arrays.
- Inactive/reset movement snapshots where immutable sharing is safe.
- Ability context and command input objects.
- Visual position and smoothed visual position objects.
- Trace ability id arrays.

Verification:

- Add diagnostics or tests that count avoidable frame allocations in the frame-runner harness.
- Run the full non-browser verification set.

## Test Coverage Matrix

| Area | Unit Tests | Integration-Like Tests | Existing Checks |
| --- | --- | --- | --- |
| Authority correction | Correction selection, update shape, diagnostics | Frame runner with pending authority queue | Local prediction tests |
| Lifecycle exits | No player, disabled, inactive, death camera | Frame runner early-exit scenarios | Visual/performance tests |
| Input normalization | Locks, reload, crouch edge, Lifeline rewrite | Per-hero frame input scenarios | Typecheck |
| Ability behavior | Per-hero ability phase tests | Practice-mode predicted state scenarios | Local prediction tests |
| Prediction commands | Accumulator, substeps, flush, command shape | Frame runner live movement scenario | Movement harness |
| Presentation | Camera/audio/visual writes, slide transitions | Frame runner post-prediction scenario | Visual/performance tests |
| Trace recording | Cadence and payload fields | Frame runner trace scenario | Movement parity and anti-cheat tests where applicable |
| Allocation behavior | Scratch reuse and no diagnostic allocations in production | Frame runner repeated-frame micro test | Client build |

## Required Test Utilities

Create these test utilities before extracting logic:

- Fake local player factory with hero-specific defaults.
- Fake input state builder.
- Fake movement prediction API with deterministic next-state outputs.
- Fake authority queue.
- Fake ability handlers that record calls and optionally mutate predicted state.
- Fake ability system refs for cooldowns, charges, active abilities, and pressed state.
- Fake store facade with explicit read/write logs.
- Fake camera with position, quaternion, matrix update, and world-direction hooks.
- Fake audio facade that records listener and walking-sound calls.
- Fake visual facade that records viewmodel, movement, transform, slide, and Aegis writes.
- Fake trace recorder.

Each fake should record call order. The most important tests are order tests, not only value tests.

## Performance Measurement Plan

Use non-browser checks first:

- Compare frame-runner allocation counts in a repeated-frame test.
- Compare diagnostics sample overhead with diagnostics disabled.
- Compare authority correction handling with zero, one, and many pending corrections.
- Compare command substep loop allocations under catchup frames.

Manual browser playtesting remains outside this task, but the plan should leave clear scenarios for the user:

- Spawn as each hero and hold primary fire for 20 seconds.
- Trigger each movement-barrier ability repeatedly.
- Force server corrections and watch camera jitter.
- Enter and exit death camera.
- Toggle pointer lock/menu while moving.
- Test practice mode and networked mode separately.

## Acceptance Criteria

- The frame runner has named phases and no giant inline frame body remains.
- Each phase can be tested without rendering a Three scene.
- Existing game behavior is preserved by tests before logic is moved.
- Production frame path avoids development-only measurement wrappers.
- Repeated frame tests show fewer avoidable allocations than the baseline.
- Local movement prediction, visual store/performance tests, physics movement harness, client typecheck, and client build all pass.
- No duplicate legacy frame-loop code remains after each slice.

## Recommended Verification Commands

Run these after each slice:

```sh
pnpm --filter @voxel-strike/client typecheck
pnpm --filter @voxel-strike/client test:movement
pnpm --filter @voxel-strike/client test:visual-store
pnpm --filter @voxel-strike/physics test:movement
```

Run this before calling the reorganization complete:

```sh
pnpm --filter @voxel-strike/client build
```

If server movement parity is affected, also run:

```sh
pnpm --filter @voxel-strike/server test:movement-parity
```

## Main Risks And Mitigations

| Risk | Why It Matters | Mitigation |
| --- | --- | --- |
| One-frame camera lag | First-person feel degrades immediately | Preserve prediction-before-camera order and test camera input state |
| Authority correction drift | Local prediction can desync from server | Test correction selection and buffer reset before extraction |
| Ability input regression | Hero abilities have unique lock and hold semantics | Per-hero input and ability tests before moving code |
| Practice-mode divergence | Practice mode mutates predicted state locally | Include practice-mode tests for movement-changing abilities |
| Trace payload drift | Anti-cheat parity depends on trace shape | Test trace cadence and payload fields |
| Hidden allocation increase | More objects can appear while refactoring for cleanliness | Add repeated-frame allocation tests after phase extraction |
| Legacy duplicate logic | Two frame paths can diverge | Delete old blocks in the same slice that introduces the phase |

## Suggested Final Shape

The final frame callback should read like:

```ts
useFrame((frameState, delta) => {
  prepareReusableFrameContext(frameContextRef.current, frameState, delta);

  if (diagnosticsEnabled) {
    measureFrameWork('frame.playerController', () => runLocalPlayerFrame(frameContextRef.current));
    return;
  }

  runLocalPlayerFrame(frameContextRef.current);
}, -100);
```

The runner should read like:

```ts
export function runLocalPlayerFrame(ctx: LocalPlayerFrameContext): LocalPlayerFrameResult {
  const authority = runAuthorityPhase(ctx);
  const lifecycle = runLifecyclePhase(ctx, authority.localPlayer);
  if (lifecycle.exit) return lifecycle.result;

  const input = runInputPhase(ctx, lifecycle.localPlayer);
  const abilities = runAbilityPhase(ctx, input);
  const prediction = runPredictionPhase(ctx, input, abilities);
  runPresentationPhase(ctx, prediction);
  runTracePhase(ctx, input, prediction);

  return { kind: 'live', substeps: prediction.substeps };
}
```

The exact names can change, but the phase order should not change without tests proving the new order.
