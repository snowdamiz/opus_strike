---
phase: 01-react-optimization-foundation
plan: 01
subsystem: react-performance
tags: [react-three-fiber, useFrame, useRef, performance, optimization, rendering]

# Dependency graph
requires: []
provides:
  - Ref-based state pattern for high-frequency updates in React Three Fiber components
  - Version counter pattern for controlled re-renders
affects: [all future effect rendering work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Ref-based state for 60fps updates (no setState in useFrame)
    - Version counter for controlled React re-renders
    - Direct ref.current mutations for high-frequency data

key-files:
  modified:
    - apps/client/src/components/game/hookshot/earthWall.tsx
    - apps/client/src/components/game/Effects.tsx
    - apps/client/src/components/game/hookshot/swingLine.tsx
    - apps/client/src/components/game/PhantomEffects.tsx

key-decisions:
  - "Use useRef for high-frequency data instead of useState in useFrame hooks"
  - "Use version counters to trigger re-renders only when data structure changes, not every frame"
  - "Keep setState calls outside useFrame to prevent 60fps re-render cascades"

patterns-established:
  - "Ref-first pattern: Store high-frequency data in refs, mutate directly in useFrame"
  - "Version-trigger pattern: Increment version counter to signal React that data structure changed"
  - "Throttled re-renders: Only trigger re-renders when meaningful state changes occur"

# Metrics
duration: 3min 42s
completed: 2026-01-22
---

# Phase 1 Plan 1: Eliminate useFrame setState Anti-pattern Summary

**Replaced setState calls with useRef mutations in 4 effect components to eliminate 60fps re-render cascades**

## Performance

- **Duration:** 3 min 42s
- **Started:** 2026-01-22T10:07:54Z
- **Completed:** 2026-01-22T10:11:36Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Eliminated `setState` calls from `useFrame` hooks in earthWall.tsx, Effects.tsx, swingLine.tsx, and PhantomEffects.tsx
- Established ref-based pattern for high-frequency updates that bypasses React's render cycle
- Implemented version counter pattern to trigger re-renders only when data structures change
- Prevented cascading re-renders across all effect components during 60fps gameplay

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace setState in earthWall.tsx useFrame** - `dfb6447` (refactor)
2. **Task 2: Replace setState in Effects.tsx useFrame** - `2e2a5d3` (refactor)
3. **Task 3: Audit remaining effect components for setState in useFrame** - `1275b1c`, `5bdb8aa` (refactor)

## Files Created/Modified

- `apps/client/src/components/game/hookshot/earthWall.tsx` - Changed `useState` wallSegments to `useRef` wallSegmentsRef with segmentsVersion counter
- `apps/client/src/components/game/Effects.tsx` - Changed `useState` activeEffects to `useRef` activeEffectsRef with effectsVersion counter
- `apps/client/src/components/game/hookshot/swingLine.tsx` - Changed `useState` ropePoints to `useRef` ropePointsRef with ropeVersion counter
- `apps/client/src/components/game/PhantomEffects.tsx` - Changed `useState` effect arrays to `useRef` with version counters

## Decisions Made

- Used version counters instead of removing setState entirely - this ensures React still re-renders when new segments/effects are added
- Kept version increments conditional (only when data changes) to avoid unnecessary re-renders
- Maintained existing effect behavior - only changed the state management pattern

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Fixed setState in swingLine.tsx (not in original plan)**
- **Found during:** Task 3 (Audit remaining effect components)
- **Issue:** swingLine.tsx had `setRopePoints` called in every frame of useFrame, causing 60fps re-renders
- **Fix:** Replaced with `ropePointsRef` ref mutation and `ropeVersion` counter for throttled re-renders
- **Files modified:** apps/client/src/components/game/hookshot/swingLine.tsx
- **Verification:** No setState calls in useFrame, only ref mutations
- **Committed in:** `1275b1c` (part of Task 3)

**2. [Rule 2 - Missing Critical] Fixed setState in PhantomEffects.tsx (not in original plan)**
- **Found during:** Task 3 (Audit remaining effect components)
- **Issue:** PhantomEffects.tsx had `setActiveBlinkEffects` and `setActiveShadowArrivals` in useFrame
- **Fix:** Replaced with refs and version counters, similar to Effects.tsx pattern
- **Files modified:** apps/client/src/components/game/PhantomEffects.tsx
- **Verification:** No setState calls in useFrame, only ref mutations
- **Committed in:** `5bdb8aa` (part of Task 3)

---

**Total deviations:** 2 auto-fixed (2 missing critical)
**Impact on plan:** Both files identified in original plan for audit, fixing them was necessary to meet success criteria of "zero setState in useFrame across all effect components"

## Issues Encountered

None - all changes were straightforward refactors following the established pattern.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Zero setState calls in useFrame hooks across all effect components
- React DevTools Profiler should show no 60fps re-render pattern during ability use
- All effect visuals still animate correctly (no regressions expected)
- Pattern established for future effect components to follow

---
*Phase: 01-react-optimization-foundation*
*Completed: 2026-01-22*
