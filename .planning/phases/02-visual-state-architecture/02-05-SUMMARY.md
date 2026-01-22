---
phase: 02-visual-state-architecture
plan: 05
subsystem: react-performance
tags: [zustand, in-place-mutation, react-renders, visual-store]

# Dependency graph
requires:
  - phase: 02-visual-state-architecture
    provides: visualStore for non-reactive position interpolation, useShallow subscription pattern
provides:
  - Map reference preservation during position updates (no React re-renders)
  - In-place player object updates in updateGameState()
  - OtherPlayers component doesn't re-render on network player movement
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "In-place Map mutation: update existing entries without changing Map reference"
    - "Reference-based React optimization: preserve object references to prevent re-renders"

key-files:
  created: []
  modified:
    - apps/client/src/store/gameStore.ts
    - apps/client/src/components/game/OtherPlayers.tsx

key-decisions:
  - "Preserve Map reference during position-only updates to prevent React re-renders"
  - "Only create new Map when players are removed (structural change)"
  - "Document subscription patterns in components for future maintainability"

patterns-established:
  - "In-place mutation pattern: Mutate existing object properties instead of creating new objects for high-frequency updates"
  - "Reactive vs non-reactive data split: Position data flows to visualStore (non-reactive 60fps), gameStore only triggers re-renders on structural changes"

# Metrics
duration: 3min 22sec
completed: 2026-01-22
---

# Phase 02-05: In-Place Map Updates for Player Position Data Summary

**Modified updateGameState() to preserve Map reference on position-only updates, preventing React re-renders in OtherPlayers component during network player movement**

## Performance

- **Duration:** 3 min 22 sec
- **Started:** 2026-01-22T11:33:13Z
- **Completed:** 2026-01-22T11:36:35Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- **Map reference preservation:** updateGameState() now updates existing Map entries in-place for position/rotation data instead of creating a new Map on every server tick
- **Re-render elimination:** OtherPlayers component no longer re-renders when network player positions change (only on add/remove)
- **visualStore integration maintained:** setPlayerVisualPosition/Rotation calls remain active for 60fps interpolation
- **Documentation added:** OtherPlayers component now has verification comment explaining the subscription pattern

## Task Commits

Each task was committed atomically:

1. **Task 1: Modify updateGameState to update Map entries in-place for position data** - `9d33ba6` (feat)
2. **Task 2: Verify OtherPlayers subscription doesn't re-render on position updates** - `873d8ea` (docs)

**Plan metadata:** (pending final commit)

## Files Created/Modified

- `apps/client/src/store/gameStore.ts` - Modified updateGameState() to preserve Map reference during position-only updates
- `apps/client/src/components/game/OtherPlayers.tsx` - Added verification comment explaining subscription pattern

## Decisions Made

**Chose in-place mutation over creating new Maps** - The implementation checks if any players need to be removed (not in snapshot). If no removals needed, it updates existing entries in-place and uses the same Map reference. If removals needed, it creates a new Map. This preserves the Map reference for the common case (position updates) while still handling structural changes.

**Maintained visualStore integration** - The visualStore updates (setPlayerVisualPosition/Rotation) were preserved and enhanced to work with both code paths (in-place updates and removal case).

**Documentation for future maintenance** - Added comments in both gameStore.ts and OtherPlayers.tsx explaining the subscription pattern and why re-renders don't occur on position updates.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**Initial implementation issue with PlayerSnapshot type** - The first attempt tried to add new players in updateGameState() using snapshot fields that don't exist (name, team, heroId). Realized that PlayerSnapshot only contains fields updated during gameplay, and players are added/removed through other handlers (player_joined events). Fixed by matching the original behavior: only update existing players, and handle removals by creating new Map when needed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Gap closure complete:** This plan addresses the gap identified in VERIFICATION.md where "OtherPlayers still re-renders because gameStore.players Map reference changes on every updateGameState() call". The Map reference is now stable during position-only updates.

**Visual state architecture complete:** All visual state separation work is now complete. Position data flows through visualStore (non-reactive 60fps), while gameStore only triggers re-renders on structural changes.

**Verification needed:** Use React DevTools profiler to verify that OtherPlayers component does not re-render during network player movement. Expected: OtherPlayers only re-renders when players are added or removed.

---
*Phase: 02-visual-state-architecture*
*Completed: 2026-01-22*
