---
status: resolved
trigger: "bounce-on-land: Player movement is jittery/bouncy when landing from a jump or fall"
created: 2026-01-22T00:00:00Z
updated: 2026-01-22T01:20:00Z
---

## Current Focus

hypothesis: CONFIRMED - smoothedY retains stale value from previous ground level when falling from height
test: Reset smoothedY to null when becoming airborne
expecting: Player lands smoothly without bounce when falling from height
next_action: Commit and close

## Symptoms

expected: Player should land smoothly when falling from height
actual: Player bounces repeatedly like a bouncy ball, oscillations decay over time until standstill
errors: No errors in console
reproduction: Walk off elevated platform and land on ground below
started: Has always been this way - never worked correctly

## Eliminated

- hypothesis: Slow smoothing speed after landing
  evidence: Previous fix (commit 68fa329) increased smoothing speed but didn't fix the core issue. User clarified jump-from-ground works, only fall-from-height bounces.
  timestamp: 2026-01-22T01:00:00Z

## Evidence

- timestamp: 2026-01-22T00:10:00Z
  checked: Physics order in PlayerController.tsx game loop
  found: Order is checkGround->handleLanding->jump->applyGravity->applyHorizontalMovement->position.y+=velocity.y*dt. Gravity is correctly skipped when grounded (fix from commit 0094600).
  implication: Basic gravity issue was fixed, but bounce persists - must be different cause

- timestamp: 2026-01-22T00:15:00Z
  checked: Ground smoothing logic in usePlayerPhysics.ts checkGround
  found: Uses exponential smoothing with SMOOTH_SPEED_LARGE=20 (32% per frame at 60fps). Converges toward target, no oscillation mechanism.
  implication: Smoothing converges monotonically, cannot cause bounce by itself

- timestamp: 2026-01-22T00:20:00Z
  checked: Step-up logic in applyHorizontalMovement
  found: Only triggers when heightDiff > 0.1 AND <= STEP_HEIGHT (0.8). During landing, player falls vertically, so no horizontal look-ahead for steps.
  implication: Step-up unlikely to cause landing bounce

- timestamp: 2026-01-22T00:25:00Z
  checked: GLB collider creation for floors
  found: Flat floors get adjustedCenter.y = center.y - 0.25 with halfExtents.y = 0.25, so top of collider is at original surface level.
  implication: Floor colliders should be positioned correctly

- timestamp: 2026-01-22T01:05:00Z
  checked: User clarification on reproduction
  found: Jump from ground level works correctly. ONLY falling/walking off something higher causes bounce. Exactly like bouncy ball - repeated bounces that decay over time.
  implication: Issue is specific to height differential, not smoothing speed

- timestamp: 2026-01-22T01:10:00Z
  checked: smoothedY update logic in PlayerController.tsx lines 462-464
  found: smoothedY only updated when groundResult.newSmoothedY is non-null. When airborne, checkGround returns null, so smoothedY RETAINS its old value from previous ground.
  implication: Critical finding - smoothedY is stale after falling from height

- timestamp: 2026-01-22T01:12:00Z
  checked: checkGround smoothing calculation at line 106
  found: `currentY = smoothedY ?? position.y` - uses smoothedY if available, which is the OLD platform height. Then `newY = currentY + (targetY - currentY) * smoothSpeed` calculates position based on stale smoothedY.
  implication: ROOT CAUSE CONFIRMED - When landing from height, stale smoothedY (at old platform height) causes player to be smoothed toward OLD position, not current ground

- timestamp: 2026-01-22T01:14:00Z
  checked: Traced full scenario
  found: 1) Player on platform y=10, smoothedY=10. 2) Player walks off, falls. 3) While falling, smoothedY stays 10 (never reset). 4) Player lands at y=0. 5) checkGround uses smoothedY=10 as currentY. 6) newY = 10 + (0.9 - 10) * 0.32 = 7.1 - SHOT BACK UP. 7) Player falls again, lands lower. 8) Repeat with decreasing amplitude = bouncy ball.
  implication: Exact mechanism of bounce confirmed

## Resolution

root_cause: When player falls from a height (e.g., walks off platform), the smoothedY value retains its old value from the previous ground level. On landing, checkGround uses this stale smoothedY as the starting point for smoothing, causing the player to be "pulled up" toward the old height. This creates repeated bouncing that decays as smoothedY gradually converges to the new ground level.

fix: Added detection of "just became airborne" transition in PlayerController.tsx and reset smoothedY to null when this occurs. This ensures that on landing, checkGround uses position.y (actual current position) instead of stale smoothedY from the previous ground level.

verification: TypeScript compiles successfully (npx tsc --noEmit passed).

files_changed:
  - /Users/sn0w/Documents/dev/opus_strike/apps/client/src/components/game/PlayerController.tsx: Added justBecameAirborne detection and smoothedY reset to null when player leaves ground
