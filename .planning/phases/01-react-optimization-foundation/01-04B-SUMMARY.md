---
phase: 01-react-optimization-foundation
plan: 04B
subsystem: performance, rendering
tags: threejs, vector-pooling, zero-allocation, temp-vectors, react-fiber, useframe

# Dependency graph
requires:
  - phase: 01-04A
    provides: Extended TEMP_VECTORS pool (v5-v10), established zero-allocation pattern
provides:
  - All remaining effect components using TEMP_VECTORS for zero per-frame allocations
  - Complete elimination of GC pressure from effect component useFrame hooks
affects: future effect development (must use TEMP_VECTORS pattern)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Zero-allocation useFrame: All vector math uses pre-allocated TEMP_VECTORS pool
    - Module-level pre-allocation: Vectors created once at module scope for parallel-safe reuse
    - useMemo for rotation: Initial orientation computed once, not per-frame

key-files:
  created: []
  modified:
    - apps/client/src/components/game/hookshot/swingLine.tsx
    - apps/client/src/components/game/effectResources.ts (reference for TEMP_VECTORS pool)

key-decisions:
  - "Module-level vectors accepted for rockets/bomb (not per-frame allocations)"
  - "useMemo object creation acceptable for static rotation (only runs on dependency change)"
  - "Zero-allocation pattern now enforced across all effect components"

patterns-established:
  - "Per-frame vector math: Always use TEMP_VECTORS.v1-v10 or named vectors (tempPos, tempDir)"
  - "useFrame allocations prohibited: No 'new THREE.Vector3/Quaternion/Euler' in useFrame callbacks"
  - "Module-level vectors acceptable: Created once at module load, reused across instances"

# Metrics
duration: 2min
completed: 2026-01-22
---

# Phase 1: Plan 04B Summary

**Eliminated remaining per-frame vector allocations in effect components by migrating swingLine.tsx to TEMP_VECTORS pool, completing zero-allocation pattern across all hooks**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-22T10:20:44Z
- **Completed:** 2026-01-22T10:22:44Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Fixed `swingLine.tsx` to use TEMP_VECTORS instead of creating Quaternion/Vector3 in useFrame
- Verified all target effect components (direBall, blaze, hookshot) have zero per-frame allocations
- Completed zero-allocation pattern established in 01-04A across remaining effect components

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace Vector3 creation in remaining effect components** - `bae006d` (perf)

**Plan metadata:** N/A (no separate metadata commit - single task plan)

## Files Created/Modified

- `apps/client/src/components/game/hookshot/swingLine.tsx` - Replaced `new THREE.Quaternion()` and `new THREE.Vector3()` in useFrame with TEMP_VECTORS.v1, TEMP_VECTORS.quat1, and TEMP_VECTORS.forward

## Decisions Made

- **Module-level vectors acceptable for rockets/bomb**: The `rockets.tsx` and `bomb.tsx` files use module-level `_rocketPos`, `_rocketDir`, etc. vectors (created once at module load, not per frame). This is an acceptable zero-allocation pattern distinct from per-frame allocations in useFrame.
- **useMemo object creation acceptable**: `direBall.tsx` creates vectors in `useMemo` for initial rotation calculation. This only runs when velocity dependencies change, not every frame, so it doesn't contribute to GC pressure.
- **Zero GC pressure from effect components**: All `new THREE.Vector3/Quaternion/Euler` instances in target files are either module-level (created once) or in useMemo (cached). None are in useFrame callbacks.

## Deviations from Plan

None - plan executed exactly as written.

**Analysis Summary:**
- `swingLine.tsx`: Fixed (was creating objects in useFrame, now uses TEMP_VECTORS)
- `grappleLine.tsx`: Already using TEMP_VECTORS (no change needed)
- `dragHook.tsx`: Already using TEMP_VECTORS (no change needed)
- `hookProjectile.tsx`: Already using TEMP_VECTORS (no change needed)
- `grappleTrap.tsx`: Already using TEMP_VECTORS (no change needed)
- `direBall.tsx`: useMemo allocations only (acceptable - not per-frame)
- `rockets.tsx`: Module-level vectors only (acceptable - created once)
- `bomb.tsx`: Module-level vectors only (acceptable - created once)

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Zero-allocation pattern now complete across all effect components
- TEMP_VECTORS pool (v1-v10, named vectors) available for future effect development
- Future effect components must follow established pattern: no `new THREE.Vector3/Quaternion/Euler` in useFrame

---
*Phase: 01-react-optimization-foundation*
*Completed: 2026-01-22*
