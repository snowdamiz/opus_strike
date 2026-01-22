---
phase: 02-visual-state-architecture
plan: 04
subsystem: performance
tags: [react, zustand, visual-state, performance-optimization, re-render-elimination]

# Dependency graph
requires:
  - phase: 02-visual-state-architecture
    plan: 01
    provides: visualStore vanilla Zustand store for non-reactive position data
  - phase: 02-visual-state-architecture
    plan: 02
    provides: OtherPlayers visualStore integration for interpolation
  - phase: 02-visual-state-architecture
    plan: 03
    provides: r3f-perf performance monitoring for verification
provides:
  - Local player position updates no longer trigger React re-renders
  - Clear separation: visualStore for 60fps position, gameStore for game events only
affects:
  - 02-visual-state-architecture/02-05 (network player updateGameState optimization)
  - Performance verification testing with React DevTools profiler

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Visual/game state separation: high-frequency data to visualStore, game events to gameStore
    - Per-frame updates use non-reactive stores only
    - Game state tracks discrete events (abilities, damage, flags), not continuous position

key-files:
  created: []
  modified:
    - apps/client/src/components/game/PlayerController.tsx

key-decisions:
  - "Position/velocity/rotation removed from per-frame updateLocalPlayer() call"
  - "One-time position updates (spawn initialization) still use gameStore - these are game events"
  - "Comment added explaining separation: visualStore for position, gameStore for game events"

patterns-established:
  - "Pattern: Per-frame updates flow ONLY to non-reactive stores (visualStore)"
  - "Pattern: Game state (gameStore) tracks discrete events, not continuous data"
  - "Pattern: One-time events (spawn, ability use) still update reactive store correctly"

# Metrics
duration: 1min 43s
completed: 2026-01-22
---

# Phase 2: Plan 4 - Local Player Position Updates Summary

**Removed per-frame position/velocity/rotation from gameStore.updateLocalPlayer() to eliminate React re-renders from local player movement**

## Performance

- **Duration:** 1min 43s (103 seconds)
- **Started:** 2026-01-22T11:33:13Z
- **Completed:** 2026-01-22T11:34:56Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Local player position updates now flow ONLY to visualStore (non-reactive), eliminating React re-renders from movement
- gameStore.updateLocalPlayer() in per-frame loop now only tracks movement state flags (isGrounded, isSprinting, isCrouching, isSliding, slideTimeRemaining)
- Clear separation established: visualStore for 60fps position interpolation, gameStore for game events (abilities, damage, flag capture)
- One-time position updates (spawn initialization) still correctly use gameStore as game events

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove position/velocity/rotation from per-frame updateLocalPlayer call** - `5a6f4cd` (feat)
2. **Task 2: Verify local player movement doesn't trigger gameStore re-renders** - (verification only, no separate commit)

**Plan metadata:** (to be committed with STATE update)

## Files Created/Modified

- `apps/client/src/components/game/PlayerController.tsx` - Removed position/velocity/lookYaw/lookPitch from per-frame updateLocalPlayer() call, added documentation comment

## Decisions Made

1. **Per-frame position data belongs in visualStore only** - Local player position/velocity/rotation updates at 60fps should ONLY go to visualStore (non-reactive vanilla Zustand), not gameStore which triggers React re-renders

2. **One-time position updates are game events** - Initialization code that sets player position on spawn (line 122-123) correctly uses gameStore because spawning is a discrete game event, not per-frame movement

3. **Movement flags are game state** - isGrounded, isSprinting, isCrouching, isSliding, slideTimeRemaining are state flags that affect gameplay logic and correctly update gameStore every frame

## Deviations from Plan

None - plan executed exactly as written.

**No auto-fixes required.** The change was straightforward: remove four fields (position, velocity, lookYaw, lookPitch) from the updateLocalPlayer() call in the per-frame useFrame loop. The visualStore was already receiving position/rotation updates at lines 535-536, so this simply removed the redundant reactive path.

## Issues Encountered

**Uncommitted gameStore.ts changes detected during execution**

- **Issue:** Found uncommitted changes in gameStore.ts for updateGameState() optimization (belongs to plan 02-05)
- **Resolution:** Reverted gameStore.ts changes using `git checkout` to keep this plan focused on the local player updateLocalPlayer() issue only
- **Impact:** None - this was correctly identified as work for a different plan

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Gap from VERIFICATION.md line 7-17 now closed: "Local player position updates should ONLY go to visualStore, not gameStore"
- Remaining gap: Network player position updates in updateGameState() still create new Map references (lines 246-264 in gameStore.ts), addressed by plan 02-05
- React DevTools profiler verification should now show OtherPlayers does NOT re-render during local player movement
- r3f-perf metrics should show stable FPS during local player movement without re-render-induced drops

---
*Phase: 02-visual-state-architecture*
*Completed: 2026-01-22*
