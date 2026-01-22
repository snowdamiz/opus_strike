---
phase: 02-visual-state-architecture
plan: 01
subsystem: state-management
tags: zustand, vanilla-store, visual-state, react-three-fiber, performance

# Dependency graph
requires:
  - phase: 01-react-optimization-foundation
    provides: React optimization patterns, useShallow selectors, React.memo wrapping
provides:
  - Vanilla Zustand store (visualStore) for high-frequency visual state
  - VisualState interface with playerPositions, playerRotations, cameraShake, slideFov
  - Non-reactive accessor functions for 60fps updates without React re-renders
  - Type re-export from central types.ts for cross-codebase imports
affects: 02-integrate-visual-state, 02-performance-monitoring

# Tech tracking
tech-stack:
  added: zustand/vanilla (createStore from zustand v5.0.0)
  patterns: vanilla-store-for-visual-state, non-reactive-getState-access, map-based-player-tracking

key-files:
  created:
    - apps/client/src/store/visualStore.ts
  modified:
    - apps/client/src/store/types.ts

key-decisions:
  - "Vanilla Zustand store for visual state - mutations don't trigger React re-renders"
  - "Map-based data structures for player positions/rotations - efficient lookup by playerId"
  - "Plain {x, y, z} objects instead of THREE.Vector3 - simpler, no dependency issues"

patterns-established:
  - "Pattern 1: Import createStore from 'zustand/vanilla' (NOT default zustand create)"
  - "Pattern 2: Access visual state via visualStore.getState() in useFrame hooks"
  - "Pattern 3: Use reactive hook (useVisualStore) only for UI components, not per-frame updates"

# Metrics
duration: 1min
completed: 2026-01-22
---

# Phase 2 Plan 1: VisualStore Creation Summary

**Vanilla Zustand store for high-frequency visual state (player positions, rotations, camera effects) using non-reactive createStore pattern**

## Performance

- **Duration:** 58 seconds
- **Started:** 2026-01-22T11:15:36Z
- **Completed:** 2026-01-22T11:16:34Z
- **Tasks:** 3 completed
- **Files modified:** 2

## Accomplishments

- Created visualStore.ts using Zustand's vanilla `createStore` API for non-reactive state
- Defined VisualState interface with playerPositions, playerRotations, cameraShake, slideFov, and interpolationTargets
- Exported accessor functions (setPlayerVisualPosition, setPlayerVisualRotation, setCameraShake, setSlideFov) for non-reactive updates
- Exported reactive hook (useVisualStore) for optional UI access
- Re-exported VisualState type from central types.ts for cross-codebase imports
- TypeScript compilation passes without errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Create visualStore.ts with vanilla Zustand store** - `029670f` (feat)
2. **Task 2: Export VisualState type from store types.ts** - `9acb556` (feat)
3. **Task 3: Verify visualStore compiles and is importable** - No code changes (verification only)

**Plan metadata:** (will be committed separately)

## Files Created/Modified

- `apps/client/src/store/visualStore.ts` - Vanilla Zustand store with VisualState interface, accessor functions, and reactive hook
- `apps/client/src/store/types.ts` - Added VisualState type re-export for central type access

## Decisions Made

1. **Vanilla Zustand store pattern:** Used `createStore` from `zustand/vanilla` instead of default `create()` hook to avoid React re-renders on every mutation. This is the core pattern that enables 60fps visual updates without routing through React's render cycle.

2. **Map-based data structures:** Used `Map<string, {x, y, z}>` for player positions/rotations instead of arrays. Provides O(1) lookup by playerId and efficient add/remove operations.

3. **Plain objects instead of THREE.Vector3:** Used `{x: number; y: number; z: number}` instead of THREE.Vector3 in the interface. Simpler, no dependency issues, and components can convert to THREE.Vector3 as needed during interpolation.

4. **Separation of concerns:** Visual state (60fps interpolation targets) is separate from authoritative game state (server-synced player data). This aligns with the research finding that visual updates should not trigger game state re-renders.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None encountered.

## Issues Encountered

None - TypeScript compilation passed on first attempt, all imports resolved correctly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for next phase:** visualStore is complete and ready for integration into components.

**What's ready:**
- visualStore can be imported and used in useFrame hooks via `visualStore.getState()`
- VisualState type is exported from central types.ts for use across the codebase
- Accessor functions provide clean API for updating visual state from network messages

**Next steps (Plan 02-02):**
- Integrate visualStore into OtherPlayers component for position interpolation
- Integrate visualStore into PlayerController for local player visual updates
- Update camera controller to use cameraShake and slideFov from visualStore

---
*Phase: 02-visual-state-architecture*
*Plan: 01*
*Completed: 2026-01-22*
