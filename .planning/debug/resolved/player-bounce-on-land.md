---
status: resolved
trigger: "player-bounce-on-land: Player bounces like a bouncy ball after landing from a jump instead of stopping cleanly."
created: 2026-01-22T00:00:00Z
updated: 2026-01-22T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - applyGravity is called every frame even when grounded, adding downward velocity that pushes player through ground
test: Verified physics loop order and applyGravity implementation
expecting: applyGravity should skip when grounded to prevent bounce
next_action: Implement fix - add isGrounded parameter to applyGravity and skip gravity when grounded

## Symptoms

expected: After jumping and landing, player should stop immediately on the ground without bouncing.
actual: Player bounces up and down after landing. Bounce intensity is proportional to jump/fall height. Takes multiple bounces to settle to a standstill.
errors: None reported - behavior issue, not crash/error
reproduction: Jump in the game. Land. Observe bouncing. Higher jumps = more bouncing.
started: Current behavior - needs investigation of when this was introduced

## Eliminated

## Evidence

- timestamp: 2026-01-22T00:01:00Z
  checked: usePlayerPhysics.ts checkGround function (lines 78-153)
  found: When player lands (distToGround <= 0.15 && velocity.y <= 0), position.y is smoothed to target and velocity.y is set to 0
  implication: Ground handling sets velocity.y = 0 on landing, no bounce mechanism here

- timestamp: 2026-01-22T00:01:30Z
  checked: useMovement.ts handleLanding function (lines 352-368)
  found: handleLanding applies BHOP_LANDING_SPEED_RETENTION (0.94) to HORIZONTAL velocity only (x,z). Does NOT modify vertical velocity.
  implication: Landing speed retention is horizontal only, not causing bounce

- timestamp: 2026-01-22T00:02:00Z
  checked: PlayerController.tsx game loop (lines 450-503)
  found: Physics order is: checkGround -> handleLanding -> jump check -> applyGravity -> applyHorizontalMovement -> position.y += velocity.y * dt
  implication: If checkGround sets velocity.y=0, but gravity is applied AFTER, this could add negative velocity to player who just landed

- timestamp: 2026-01-22T00:03:00Z
  checked: applyGravity function in usePlayerPhysics.ts (lines 249-260)
  found: applyGravity does NOT check isGrounded - it always applies GRAVITY * dt to velocity.y (except during swing)
  implication: ROOT CAUSE CONFIRMED - gravity is applied even when grounded, causing downward velocity that pushes player below ground

- timestamp: 2026-01-22T00:03:30Z
  checked: PlayerController.tsx applyGravity call (line 479-484)
  found: applyGravity is called AFTER checkGround sets velocity.y=0, with no isGrounded check
  implication: Every grounded frame, velocity.y goes from 0 to GRAVITY*dt (negative), causing downward push

## Resolution

root_cause: applyGravity is called every frame without checking isGrounded. When grounded, checkGround sets velocity.y=0, but applyGravity immediately adds GRAVITY*dt (negative) to velocity.y. This downward velocity moves the player below ground, and next frame checkGround snaps them back up - creating the bouncing effect.
fix: Added isGrounded parameter to applyGravity function. When isGrounded is true, gravity is skipped entirely (early return). This prevents downward velocity accumulation when player is on the ground.
verification: TypeScript compiles successfully (npx tsc --noEmit passed). Bunny hopping preserved because: jump input sets velocity.y=jumpForce and isGrounded=false BEFORE applyGravity is called, so airborne player still receives gravity normally.
files_changed:
  - /Users/sn0w/Documents/dev/opus_strike/apps/client/src/hooks/player/usePlayerPhysics.ts: Added isGrounded param to applyGravity, skip gravity when grounded
  - /Users/sn0w/Documents/dev/opus_strike/apps/client/src/components/game/PlayerController.tsx: Pass movement.refs.isGrounded.current to applyGravity call
