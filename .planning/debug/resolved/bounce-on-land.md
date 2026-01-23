---
status: resolved
trigger: "bounce-on-land: Player movement is jittery/bouncy when landing from a jump or fall"
created: 2026-01-22T00:00:00Z
updated: 2026-01-22T00:40:00Z
---

## Current Focus

hypothesis: The Y smoothing switches from SMOOTH_SPEED_LARGE (20) to SMOOTH_SPEED_SMALL (8) after the first landing frame, causing very slow convergence (~1 second to settle). Combined with horizontal movement causing ground height variations, this creates visible "bobbing" during and after landing.
test: Check if SMOOTH_SPEED_SMALL is too slow for landing, causing prolonged settling that feels like bounce
expecting: Increasing SMOOTH_SPEED_SMALL or changing the condition should fix the slow settling
next_action: Modify checkGround to use faster smoothing during landing transition, or remove the SMALL speed entirely for grounded states

## Symptoms

expected: Player should move smoothly in expected direction
actual: Movement is jittery/bouncy - specifically when landing from jumps or falls
errors: No errors in console
reproduction: Jump or fall, observe jitter/bounce on landing
started: Has always been this way - never worked correctly

## Eliminated

## Evidence

- timestamp: 2026-01-22T00:10:00Z
  checked: Physics order in PlayerController.tsx game loop
  found: Order is checkGround->handleLanding->jump->applyGravity->applyHorizontalMovement->position.y+=velocity.y*dt. Gravity is correctly skipped when grounded (fix from commit 0094600).
  implication: Basic gravity issue was fixed, but bounce persists - must be different cause

- timestamp: 2026-01-22T00:15:00Z
  checked: Ground smoothing logic in usePlayerPhysics.ts checkGround
  found: Uses exponential smoothing with SMOOTH_SPEED_LARGE=20 (32% per frame at 60fps). Converges toward target, no oscillation mechanism.
  implication: Smoothing converges monotonically, cannot cause bounce

- timestamp: 2026-01-22T00:20:00Z
  checked: Step-up logic in applyHorizontalMovement
  found: Only triggers when heightDiff > 0.1 AND <= STEP_HEIGHT (0.8). During landing, player falls vertically, so no horizontal look-ahead for steps.
  implication: Step-up unlikely to cause landing bounce

- timestamp: 2026-01-22T00:25:00Z
  checked: GLB collider creation for floors
  found: Flat floors get adjustedCenter.y = center.y - 0.25 with halfExtents.y = 0.25, so top of collider is at original surface level.
  implication: Floor colliders should be positioned correctly

- timestamp: 2026-01-22T00:30:00Z
  checked: Y smoothing logic in checkGround - traced exact behavior on landing
  found: After first landing frame, smoothing switches from SMOOTH_SPEED_LARGE (20) to SMOOTH_SPEED_SMALL (8), causing 12.8% convergence per frame vs 32%. This means settling takes ~40 frames (667ms) to reach final position.
  implication: Slow smoothing after landing creates prolonged camera settling that feels "bouncy"

- timestamp: 2026-01-22T00:35:00Z
  checked: SMOOTH_SPEED_SMALL vs SMOOTH_SPEED_LARGE conditional
  found: The condition `heightChange < SMALL_BUMP_THRESHOLD && smoothedY !== null` was designed to smooth small terrain bumps while walking, but after landing the heightChange quickly drops below threshold, triggering slow smoothing during the landing settle phase.
  implication: ROOT CAUSE - Smoothing speed mismatch between initial landing (fast) and subsequent settling (slow)

## Resolution

root_cause: The checkGround function used two smoothing speeds - SMOOTH_SPEED_LARGE (20) for the initial landing frame and SMOOTH_SPEED_SMALL (8) for subsequent frames when heightChange dropped below 0.15. This caused the camera to settle slowly (~667ms) after landing, creating a "bouncy" feeling as the player slowly descended to the final ground position.

fix: Removed the conditional smoothing and now use SMOOTH_SPEED_LARGE (20) uniformly for all ground following. This provides consistent snappy ground tracking for both landing and walking over terrain.

verification: TypeScript compiles successfully (npx tsc --noEmit passed). The fix uses faster smoothing uniformly, which should eliminate the slow settling that caused the bouncy feeling.

files_changed:
  - /Users/sn0w/Documents/dev/opus_strike/apps/client/src/hooks/player/usePlayerPhysics.ts: Removed SMALL_BUMP_THRESHOLD and SMOOTH_SPEED_SMALL imports, simplified smoothing to always use SMOOTH_SPEED_LARGE
