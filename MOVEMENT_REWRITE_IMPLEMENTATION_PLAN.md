# Movement Rewrite Implementation Plan

## Reader And Goal

This plan is for an internal engineer implementing the next movement system. After reading it, they should be able to replace the fragile client-side Rapier movement path with a single shared, server-authoritative capsule motor that works consistently against the voxel world.

The goal is not to tune the current movement implementation. The goal is to replace the movement strategy so terrain holes, edge slides, falls, and server reconciliation behave predictably.

## Problems To Solve

The current system has multiple movement models:

- The local player is moved by a client-side controller that mixes Quake-style acceleration, ground probes, wall rays, capsule shape checks, step-up heuristics, corner recovery, and visual smoothing.
- The server can run command-based authoritative movement, but the live client still sends legacy position and velocity proposals.
- The shared simulator already exists, but it approximates capsule collision with voxel samples and axis-separated movement.
- Map generation seals unsafe grooves and repairs terrain, but movement correctness should not depend on the generator avoiding bad geometry.

The largest player-facing symptoms are:

- The capsule can get stuck inside or against small terrain holes and voxel corner details.
- Falling off ledges loses momentum or feels sticky.
- Sliding off terrain can feel like the player is being caught by the edge instead of moving cleanly into the air.
- Client and server authority are hard to reason about because movement input, predicted transforms, server validation, and authoritative commands coexist.

## Design Direction

Implement one canonical movement motor in the shared physics package and use it everywhere:

- Client prediction uses the shared motor.
- Server authority uses the shared motor.
- Bots and NPCs use the shared motor where possible.
- Rapier may still be used for projectiles, combat traces, temporary wall colliders, and visual queries.
- Movement no longer depends on the live client submitting position and velocity proposals, except for development-only fly mode.

The motor should be a kinematic capsule controller, not a dynamic rigid body. The game wants authored movement: air-strafing, slides, crouch, jumps, hook movement, and strict ability state. Dynamic rigid bodies would make authority and feel harder to control.

## Core Invariants

- The player capsule must never end a simulation step inside collision geometry.
- A movement step must preserve tangential velocity when it hits walls, corners, ledges, or slopes.
- Collision response must project velocity along contact planes instead of zeroing whole axes.
- Grounded state must come from the motor's contact result, not from unrelated ray or heightfield checks.
- Step-up and snap-down must be explicit motor features with narrow eligibility rules.
- Client prediction and server authority must run the same deterministic code for normal movement.
- Ability movement must enter the same motor as impulses, state barriers, or constrained modes.
- Map generation repairs are allowed as quality improvements but are not movement correctness guarantees.

## Target Architecture

### Shared Capsule Motor

Create a shared `CapsuleMotor` module in the physics package. It owns normal player movement simulation.

Suggested public API:

```ts
interface CapsuleMotorInput {
  state: MovementSimulationState;
  command: MovementCommandInput;
  terrain: MovementCollisionWorld;
  heroStats: HeroStats;
  modifiers: MovementModifiers;
  dt: number;
}

interface CapsuleMotorResult {
  state: MovementSimulationState;
  contacts: MovementContact[];
  correction: MovementCorrectionSummary;
}
```

The exact names can change, but the boundaries should stay clear:

- Input is state, command, terrain/collision world, hero stats, modifiers, and fixed delta time.
- Output is next state plus contact/correction metadata.
- The motor has no React, Colyseus, audio, camera, or store dependencies.

### Collision World Abstraction

Replace point-sampled terrain adapters with a collision world that can answer capsule queries:

- `testCapsule(position, height, radius)` returns overlap information.
- `sweepCapsule(position, delta, height, radius)` returns time of impact and contact normal.
- `findGround(position, snapDistance, radius)` returns ground hit, normal, distance, and walkability.
- `clampToPlayableArea(position)` handles map boundary constraints.

The first implementation can be voxel-native. Rapier-specific query implementations can remain client-only for effects, but normal movement should be deterministic and shared.

### Voxel Collision Representation

Use voxel AABBs as collision primitives, but query them through broadphase candidates around the capsule sweep:

1. Compute the swept capsule AABB for the desired delta.
2. Convert that AABB to voxel grid bounds with a small skin.
3. Gather solid collision cells and merged static cuboids in that region.
4. Sweep capsule against those AABBs.
5. Resolve the earliest hit, project remaining motion along the contact plane, and iterate.

The motor does not need to inspect the entire map. It only needs nearby solids around the capsule path.

### Move-And-Slide Loop

Each fixed step should follow one flow:

1. Read previous state.
2. Determine current ground state using a capsule-aware ground query.
3. Apply movement intent to velocity.
4. Apply jump, slide, crouch, gravity, and ability modifiers.
5. Build desired delta from velocity and delta time.
6. Move the capsule with iterative sweep-and-slide.
7. Apply step-up only when grounded and blocked by a valid low obstacle.
8. Apply snap-down only when previously grounded, moving slightly downward, and within snap distance.
9. Run final depenetration if needed.
10. Derive final grounded state, slope state, and movement flags from contacts.

Suggested iteration budget:

- 3 to 5 slide iterations per step.
- 4 to 8 depenetration iterations only when overlap is detected.
- Fixed skin width around 0.02 to 0.05 meters.

### Velocity Response

When a sweep hits geometry:

- Move to time of impact minus skin.
- Remove velocity into the contact normal.
- Keep tangential velocity.
- Continue with remaining delta projected along the contact plane.

This is the key change for the reported sliding/falling issues. Edge contact should not erase all horizontal speed. Only motion into the blocker should be removed.

### Grounding Rules

Grounding should be a motor result, not a precondition from the previous frame.

Grounded if:

- The capsule has a walkable contact below it, or
- A snap-down query finds walkable ground within snap distance and snap eligibility is true.

Not grounded if:

- Jump was consumed this step.
- Ground normal is too steep.
- Ground is farther than snap distance.
- The character left a ledge and has no downward snap eligibility.
- The character is in a movement mode that intentionally detaches from ground.

This should fix ledge exits where the old frame's grounded state causes extra friction or sticky snap.

### Step-Up Rules

Autostep should be a motor feature, not separate terrain following:

1. Only attempt when grounded before the obstacle.
2. Only attempt if the blocking normal is mostly horizontal.
3. Sweep the capsule upward by max step height.
4. Sweep forward by the desired horizontal delta.
5. Sweep downward to find a landing surface.
6. Require enough horizontal landing width for the capsule.
7. Reject if headroom is blocked.

No step-up should happen while falling, sliding off an edge, or airborne except for a very small jump-edge grace if deliberately retained.

### Crouch And Slide Shape

The motor should support two capsule heights:

- Standing height.
- Crouched/sliding height.

When trying to stand:

- Test standing capsule clearance.
- If blocked, remain crouched.

Slide should affect acceleration, camera, and capsule height, but collision remains the same motor. Sliding into an obstacle should slide along it when possible, not kill both axes.

## Server Authority Plan

### Command-Only Movement

Move normal gameplay to command-only movement:

- Client sends compact movement commands with sequence, buttons, yaw, pitch, time, epoch, and collision revision.
- Client does not send normal position or velocity proposals.
- Server processes commands in order at the fixed movement substep rate.
- Server sends authoritative acknowledgements with position, velocity, movement state, epoch, and last processed sequence.
- Client reconciles by replaying unacknowledged commands.

Legacy transform proposal handling should remain only for:

- Development fly mode.
- A short compatibility period behind a server flag.
- Explicit migration fallback while command authority is being verified.

### Epoch Barriers

Use movement epoch barriers for state changes that cannot be replayed as ordinary input:

- Spawn and respawn.
- Unstuck.
- Teleport and blink.
- Rocket jump if applied as an authoritative impulse.
- Hookshot attach and detach.
- Large server corrections.

After an epoch barrier, the client discards old commands and starts prediction from the authoritative state.

### Ability Integration

Normal movement abilities should become motor inputs or authoritative state changes:

- Blink: server validates destination with capsule clearance and path sweep, applies position barrier, then client reconciles.
- Rocket jump: server applies impulse to velocity, increments epoch only if the impulse is not represented as an input command.
- Hookshot swing: either remains a shared deterministic movement mode or becomes a constrained motor modifier that feeds velocity into the capsule move.
- Crouch and slide: ordinary movement command buttons.
- Temporary walls: included in the collision world with a revision number.

## Client Integration Plan

The local player controller should stop being the movement authority.

Target responsibilities:

- Gather input.
- Create movement commands at fixed substep cadence.
- Predict with the shared motor.
- Send command packets to the server.
- Render predicted visual position.
- Smooth authoritative corrections.
- Drive camera, audio, animation, and effects from predicted state.

Remove or bypass the current local movement stack for normal gameplay:

- Manual ground check.
- Manual horizontal move/axis fallback.
- Manual vertical movement and corner recovery.
- Client-side normal position/velocity proposals.

Camera smoothing should become visual-only. It must not change physics position.

## Implementation Phases

### Phase 0: Baseline And Test Fixtures

Purpose: lock down the behaviors the rewrite must fix before changing the runtime path.

Tasks:

- Add movement harness fixtures for narrow terrain holes smaller than capsule diameter.
- Add fixtures for diagonal voxel corners and wall-edge glancing movement.
- Add fixtures for sprinting off ledges with retained momentum.
- Add fixtures for sliding off ledges with retained momentum.
- Add fixtures for slide into wall, slide along wall, and slide jump.
- Add fixtures for step-up, step-down, low ceiling, crouch stand-blocked, and landing.
- Add command replay parity tests for client and server simulation.

Acceptance:

- The new fixtures can fail against the current simulator where it is known fragile.
- The tests run without browser automation.

### Phase 1: Collision World And Query API

Purpose: create a deterministic shared collision surface for the motor.

Tasks:

- Define the collision world interface.
- Implement voxel block lookup with swept local candidate gathering.
- Implement capsule overlap against nearby voxel AABBs.
- Implement capsule sweep against nearby voxel AABBs.
- Implement playable boundary clamping as a collision constraint or final clamp.
- Add collision revision plumbing for temporary colliders.

Acceptance:

- Unit tests can query capsule overlap, sweep hits, ground hits, and clearance.
- Narrow holes that cannot contain the capsule report blocked before the center enters them.

### Phase 2: Capsule Motor Core

Purpose: build the replacement motor with no client or server integration yet.

Tasks:

- Implement fixed-step input acceleration.
- Implement gravity, jump, coyote time if retained, and jump buffering if retained.
- Implement iterative sweep-and-slide.
- Implement final depenetration.
- Implement ground classification.
- Implement snap-down.
- Implement autostep.
- Implement crouch/stand shape switching.
- Implement slide movement and slide exit rules.

Acceptance:

- The motor passes flat ground, wall, step, ledge, slide, and crouch fixtures.
- Horizontal velocity is projected along walls instead of zeroed unless fully blocked.
- Falling off a ledge preserves horizontal velocity unless a real collision blocks it.

### Phase 3: Replace Shared Simulator Internals

Purpose: make existing prediction and server command systems use the new motor.

Tasks:

- Keep the public simulation function stable if possible.
- Swap its internals from point-sampled movement to the capsule motor.
- Preserve existing movement state shape for network compatibility.
- Update deterministic replay harness expected behavior.
- Expand movement parity corpus around terrain hazards.

Acceptance:

- Existing command replay and correction tests pass.
- New terrain hazard tests pass.
- No browser verification is required.

### Phase 4: Client Command Prediction

Purpose: make the live client use the existing command pipeline.

Tasks:

- Generate movement commands from local input at the fixed substep rate.
- Step local prediction with the shared motor.
- Send command packets through the movement command channel.
- Update local visual state from predicted state.
- Keep camera, audio, viewmodel, and ability prediction reading from predicted state.
- Stop sending normal position and velocity proposals in gameplay input packets.

Acceptance:

- The client can move using predicted command state.
- Server acknowledgements reconcile through existing prediction controller.
- Local transform entries from shared transform broadcasts are ignored once private movement authority is active.

### Phase 5: Server Strict Authority

Purpose: make the server the movement source of truth.

Tasks:

- Process movement commands for all human players in normal gameplay.
- Use the new motor for authoritative simulation.
- Send self authority acknowledgements every processed command batch.
- Reject stale collision revisions.
- Disable normal client transform proposals by default outside development.
- Keep hardened validation only as compatibility fallback.

Acceptance:

- Server state advances without client-submitted transforms.
- Corrections are rare in healthy network conditions.
- Objective interactions use authoritative server position only.

### Phase 6: Ability And Special Movement Unification

Purpose: bring movement-affecting abilities into the same authority model.

Tasks:

- Validate blink and shadow-step with capsule sweep and clearance.
- Convert rocket jump to authoritative impulse or command-mode event.
- Ensure hookshot swing feeds through capsule move so terrain contacts never tunnel.
- Include temporary walls in both client and server collision worlds.
- Increment movement epoch for non-replayable state changes.

Acceptance:

- Ability movement cannot place the player inside geometry.
- Ability movement reconciles cleanly after server acknowledgement.
- Hookshot, blink, slide, and rocket jump have deterministic tests.

### Phase 7: Remove Legacy Movement Paths

Purpose: reduce future fragility by deleting or isolating old logic.

Tasks:

- Remove normal gameplay dependency on manual client collision helpers.
- Remove local position/velocity proposal sending for normal gameplay.
- Remove unused old movement controller exports if no consumers remain.
- Keep projectile and combat Rapier queries separate from player movement.
- Keep dev fly clearly marked as development-only.

Acceptance:

- There is one normal movement source: the shared capsule motor.
- Legacy code cannot silently re-enter normal movement.

### Phase 8: Tuning And Feel Pass

Purpose: tune movement after correctness is stable.

Tasks:

- Tune skin width.
- Tune snap distance.
- Tune step height and landing width.
- Tune slide friction and steering.
- Tune ground friction transition when leaving ledges.
- Tune correction smoothing duration.

Acceptance:

- Movement feels smooth on ledges, slopes, stairs, tunnels, and generated terrain.
- No tuning reintroduces map-generation dependence for basic collision safety.

## Verification Strategy

Do not rely on browser testing for this work. Use deterministic harnesses and server/client simulation tests.

Required checks:

- Physics movement harness.
- Server authority harness.
- Movement parity gate.
- Typecheck for shared, physics, client, and server packages.
- Focused tests for ability movement state barriers.

Suggested new fixture groups:

- `capsule_hole_rejection`
- `ledge_exit_momentum`
- `slide_ledge_exit`
- `diagonal_corner_slide`
- `step_up_landing_width`
- `snap_down_no_sticky_edge`
- `temporary_wall_revision`
- `blink_capsule_clearance`
- `hookshot_terrain_contact`

## Rollout Plan

Use a feature flag during migration:

- `legacy`: current client movement and transform proposals.
- `shadow`: client still uses legacy movement, server also simulates command motor and records drift.
- `predict`: client predicts with command motor, server still accepts transform fallback.
- `strict`: command-only authority for normal gameplay.

Recommended rollout:

1. Land motor and tests with no runtime behavior change.
2. Enable shadow simulation locally and in development.
3. Enable prediction for local development.
4. Enable strict mode for non-ranked/custom test rooms.
5. Enable strict mode everywhere once drift and correction rates are acceptable.

## Risks And Mitigations

- Risk: voxel capsule sweep is hard to get correct.
  - Mitigation: build collision tests first and keep the broadphase local to nearby cells.

- Risk: movement feel changes too much.
  - Mitigation: preserve acceleration constants initially, then tune after correctness.

- Risk: ability prediction diverges from server.
  - Mitigation: treat ability transforms as epoch barriers until they are fully deterministic.

- Risk: temporary walls desync collision worlds.
  - Mitigation: add collision revisions and reject commands against stale revisions.

- Risk: old client path keeps influencing position.
  - Mitigation: make predicted state the only source for local visual position during command mode.

## Non-Goals

- Do not optimize the existing manual Rapier movement path.
- Do not depend on procedural map repairs as the primary fix.
- Do not use browser testing as the verification method for this plan.
- Do not change combat hit detection unless movement state requires it.
- Do not rewrite all abilities at once; integrate movement-affecting pieces incrementally.

## Definition Of Done

The rewrite is complete when:

- Normal movement is simulated by one shared capsule motor.
- The client sends movement commands, not normal transform proposals.
- The server is authoritative for normal movement.
- The client predicts locally and reconciles against server acknowledgements.
- The player cannot enter narrow terrain holes smaller than the capsule.
- Falling and sliding off ledges preserve horizontal momentum.
- Sliding into terrain projects along contacts instead of hard-stopping unless fully blocked.
- All required movement harnesses pass without browser testing.
- Legacy movement code is removed or isolated behind explicit compatibility flags.
