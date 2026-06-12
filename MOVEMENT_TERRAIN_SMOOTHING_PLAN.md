# Movement Terrain Smoothing Plan

## Problem

Player movement can reliably step up small voxel terrain, but the motion still feels like stepping up a stair stack instead of walking up a smooth ramp. The current behavior appears to come from discrete voxel ground heights in the shared movement motor, with client-side visual smoothing only masking the resulting vertical jumps after simulation.

## Approach

Solve this in shared movement physics rather than by adding real invisible ramp colliders. Collision should remain voxel-discrete for walls, ceilings, hookshots, projectiles, temporary walls, prediction parity, and anti-cheat validation. Only the player capsule's grounded traversal over walkable, small height changes should receive ramp-like treatment.

The main idea is to add a virtual ground-ramp behavior inside the capsule motor:

- Keep terrain AABBs and block collision discrete.
- Detect walkable height changes within `STEP_HEIGHT`.
- Move the capsule horizontally normally.
- Ease the capsule feet toward the next ground height over travel distance instead of snapping directly to the next voxel top face.
- Preserve grounded state and horizontal velocity while traversing these small rises.
- Continue blocking terrain that exceeds step height or behaves like a wall.

## Implementation Plan

1. Add a targeted regression case in `packages/physics/scripts/movement-prediction-harness.mjs`.
   - Simulate walking and sprinting over repeated 0.25m voxel-height terrain.
   - Assert bounded per-frame vertical movement.
   - Assert continuous grounded state.
   - Assert preserved horizontal velocity.
   - Assert client/server prediction produces no corrections.

2. Update `packages/physics/src/movement/CapsuleMotor.ts`.
   - Keep the existing climbable block filtering for walkable low terrain.
   - Move ramp-feel logic into shared ground resolution or step traversal.
   - For small walkable height changes, compute a target ground height and advance toward it with a slope/rise-rate limit based on horizontal travel.
   - Preserve tall wall, ceiling, and narrow-space rejection behavior.

3. Adjust client visual smoothing in `apps/client/src/components/game/PlayerController.tsx`.
   - Let camera/body smoothing follow the already-smoothed shared physics result.
   - Reset smoothing on jumps, teleports, respawns, or large correction snaps.
   - Avoid using visual smoothing as the primary fix for physical stair-stepping.

4. Verify with non-browser checks.
   - Run the physics movement harness.
   - Run movement parity checks if available/appropriate.
   - Confirm regressions still pass for low voxel step-up, tall wall blocking, low ceilings, slide transitions, jump transitions, and procedural spawn terrain.

## Non-Goals

- Do not add generated invisible ramp colliders unless the shared motor approach proves insufficient.
- Do not make terrain globally smooth for all collision systems.
- Do not browser-test this change; browser validation is left to the user.

## Expected Result

Small voxel terrain remains visually voxel-like and collision-authoritative, but grounded player traversal feels ramp-like. Players should no longer feel sharp vertical pops while climbing normal walkable terrain, and prediction should remain deterministic between client and server.
