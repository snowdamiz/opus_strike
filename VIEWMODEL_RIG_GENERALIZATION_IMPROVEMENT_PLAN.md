# Viewmodel Rig Generalization Improvement Plan

## Reader And Outcome

Reader: an engineer extracting and generalizing first-person viewmodel animation logic.

Post-read action: refactor the current Phantom first-person viewmodel into reusable viewmodel rig, action, and socket primitives while proving the current behavior remains identical with automated tests.

## Goal

The current Phantom first-person model has the right gameplay contract: successful local actions drive the animation, the animated palm socket is the projectile source, and pose sampling can happen synchronously when an ability fires. The goal is to keep that behavior exactly the same while moving the logic into reusable pieces for Hookshot, Blaze, Glacier, and future heroes.

This is not a plan to build a full inverse-kinematics system. The first step should be a tested, pose-driven viewmodel rig layer. Add small analytic reach helpers later only when a specific hero needs a hand or weapon to hit an exact target.

## Current State

Phantom now has a procedural first-person rig with separate forearm, wrist, palm, thumb, finger, socket, reload, charge, locomotion, and shot-pulse logic. It also has a socket registry and a synchronous pose sampler so ability code can launch from the same pose the rendered hand uses.

Hookshot and Blaze still use simpler static viewmodel geometry and player-relative projectile offsets. They have some useful metadata, such as launch side, but they do not share Phantom's tested socket-sampling pattern yet.

There are no dedicated unit tests around the viewmodel pose math, socket registry, or local ability launch contracts. That makes a direct extraction risky because a visually small math change can move projectile origins, alter hand alternation, or desync local visuals from authoritative gameplay.

## Refactor Principle

Capture behavior first, then extract. Each extraction should have tests that prove the new shared code produces the same positions, rotations, action events, and launch metadata as the current Phantom implementation.

Do not tune animation curves during the extraction. Any visual polish or IK-style reach solving should be a separate change after behavior parity is proven.

## Functional Invariants To Preserve

- Phantom primary only creates a local projectile after reload, ammo, fire-rate, and hand-ready gates pass.
- Missed, rate-limited, reloading, or not-ready inputs do not trigger a fake first-person shot animation.
- Successful Phantom primary shots alternate hands from the same source of truth that creates the projectile.
- The projectile start position equals the sampled animated palm socket position when a sampler is available.
- The fallback launch path remains available when the viewmodel sampler is absent.
- Aim direction continues to use the camera look ray and terrain-adjusted aim point, while launch origin comes from the hand socket.
- The socket registry returns cloned poses and unregisters stale sockets or samplers safely.
- Existing idle, locomotion, targeting, reload, charge, and shot-pulse blends keep their current timing and curve outputs.
- Hookshot and Blaze behavior remains unchanged until each hero is intentionally migrated to the shared viewmodel action layer.
- No browser verification is required from the agent side; browser/manual visual checks remain user-owned.

## Test Strategy

### 1. Add A Client Unit Test Harness

Add a lightweight client-side unit test runner for pure TypeScript tests. Prefer testing pure math, pose composition, socket registry behavior, and ability launch helpers without rendering a browser canvas.

The test harness should support:

- deterministic fake time
- Three.js vector, quaternion, matrix, and camera objects
- module-level reset helpers for registries and hold-state singletons
- numeric matchers for vectors, quaternions, and matrices with small epsilons

### 2. Golden Tests For Existing Phantom Pose Math

Before extracting code, write tests around the current Phantom pose outputs. These tests should freeze representative values for:

- primary hold blend over time
- primary shot pulse over time
- left and right palm world poses at idle
- left and right palm world poses at held-ready
- left and right palm world poses at fire pose
- palm poses with action, targeting, and locomotion blends

The purpose is not to assert that the poses are artistically perfect. The purpose is to make accidental movement obvious when the code is split apart.

### 3. Socket Registry Tests

Test the viewmodel socket registry independently:

- registered object sockets can be read in world space
- unregister only removes the matching registration
- newer registrations win over older registrations with the same name
- pose samplers can be registered, sampled, and unregistered
- sampled positions and quaternions are cloned so callers cannot mutate registry internals
- launch-position assertions warn only when sampled and actual launch positions differ beyond tolerance

### 4. Phantom Launch Contract Tests

Extract enough Phantom launch logic into pure functions to test it without React hooks. Tests should cover:

- primary fire refuses to launch while reloading
- primary fire refuses to launch with no ammo
- primary fire refuses to launch while the hand-ready blend is below the gate
- primary fire refuses to launch during the fire-rate interval
- successful fire decrements ammo
- successful fire alternates launch side
- successful fire stores launch metadata and event id
- successful fire uses the sampled palm position when available
- successful fire falls back to the player-relative socket when no sample is available
- velocity is computed from the chosen launch origin toward the aim point

This extraction should be mechanical: move existing calculations into testable helpers, wire the hook back to those helpers, and keep hook behavior unchanged.

### 5. Server And Client Timing Parity Tests

Add tests or shared-constant checks for Phantom primary timing so local projectile creation and authoritative attack resolution cannot drift silently.

The tests should catch:

- client and server primary fire cadence disagreement
- client primary input being sent to the server before the local hand-ready gate allows a shot
- magazine reload duration mismatch
- ammo consumption mismatch between local visual projectiles and authoritative attack handling

If the current behavior is intentionally asymmetric, document that decision explicitly and test the chosen contract.

### 6. Refactor Parity Tests

After introducing shared viewmodel rig/action modules, keep the golden tests running against both the legacy-adapter path and the new shared path until the old implementation is removed.

For each extracted function, prove:

- same input context
- same transform output
- same event output
- same socket name
- same launch side
- same timing decision

Only remove the legacy code once the new shared path passes the same golden cases.

## Proposed Architecture

### 1. Shared Viewmodel Action Model

Create a small action model that represents successful local gameplay actions rather than raw inputs. Each action should carry:

- hero id
- action id
- event id
- socket name or side
- start time
- action pose time
- optional charge, reload, or release metadata

The viewmodel should animate from these successful events. It should not infer hand alternation or action success independently.

### 2. Shared Pose Layers

Split first-person pose composition into layers:

- root camera-relative sway
- idle breathing
- locomotion
- targeting
- charge
- reload
- shot pulse
- hero-specific pose offsets

Each layer should be a pure function that mutates or returns a small transform target. Shared code owns layer composition; hero modules provide constants and hero-specific offsets.

### 3. Shared Rig Description

Represent first-person rigs with named transforms instead of hero-specific component state:

- root
- left forearm
- right forearm
- left wrist
- right wrist
- left palm
- right palm
- optional fingers and thumb
- named sockets

Phantom can remain blocky and procedural, but the rig names should be reusable by Hookshot, Blaze, and Glacier.

### 4. Shared Socket Sampling

Keep synchronous pose sampling as a first-class feature. Ability code must be able to ask for the pose that corresponds to a specific action moment before it creates a projectile.

Rendered sockets are still useful for debugging and live attachments, but local fire events should not rely on one-frame-old rendered object matrices.

### 5. Optional Future IK Helper

After the shared rig layer exists, add a very small analytic two-bone helper only if needed. It should solve a constrained arm reach target for blocky first-person models, not become a full body IK framework.

This helper should be opt-in per pose layer and covered by numeric tests.

## Implementation Order

1. Add the client unit test harness and numeric Three.js matchers.
2. Add reset helpers for viewmodel singletons so tests are isolated.
3. Write golden tests for current Phantom hold, shot pulse, socket sampling, and palm pose composition.
4. Extract Phantom pose composition into pure functions without changing constants or outputs.
5. Write Phantom launch contract tests around pure launch helpers.
6. Extract Phantom primary launch decisions into those helpers and wire the hook back to them.
7. Fix or explicitly document client/server Phantom primary timing parity, then add tests to lock the decision.
8. Introduce shared action event types and migrate Phantom to use them through an adapter.
9. Introduce shared rig transform names and migrate Phantom pose functions to the shared rig layer.
10. Keep all golden tests passing while deleting duplicated Phantom-only plumbing.
11. Migrate Hookshot or Blaze as the first non-Phantom proof that the shared layer generalizes.
12. Run typecheck, unit tests, and production build.

## Acceptance Criteria

- Client unit tests cover Phantom pose math, socket registry behavior, and Phantom primary launch contracts.
- Tests prove extracted Phantom pose functions produce the same outputs as the pre-extraction implementation.
- Tests prove successful Phantom primary launches still use the animated palm socket when available.
- Tests prove fallback launch behavior still works when no sampler exists.
- Tests prove rate-limit, reload, ammo, and hand-ready gates do not trigger local fake shot animations.
- Client/server Phantom primary timing is either made consistent or documented as intentionally asymmetric with tests.
- Hookshot and Blaze remain behaviorally unchanged until explicitly migrated.
- Typecheck passes.
- Production build passes.
- No browser test is required from the agent side.

## Non-Goals

- Do not tune Phantom animation curves during the extraction.
- Do not replace the current procedural blocky models with imported skeletal assets.
- Do not build a full IK system in this pass.
- Do not migrate every hero at once.
- Do not change gameplay balance unless required to resolve an existing client/server timing mismatch.
