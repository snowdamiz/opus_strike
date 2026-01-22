---
phase: 01-react-optimization-foundation
plan: 04B
type: execute
wave: 2
depends_on: [01-04A]
files_modified:
  - apps/client/src/components/game/phantom/direBall.tsx
  - apps/client/src/components/game/blaze/rockets.tsx
  - apps/client/src/components/game/blaze/bomb.tsx
  - apps/client/src/components/game/hookshot/dragHook.tsx
autonomous: true
user_setup: []

must_haves:
  truths:
    - "Remaining effect components create zero temporary Vector3/Quaternion objects per frame"
    - "Allocation profiling shows flat memory allocation across all effects during 60fps gameplay"
    - "Garbage collection pauses eliminated during ability usage"
  artifacts:
    - path: "apps/client/src/components/game/phantom/direBall.tsx"
      provides: "DireBall using pooled temp vectors"
      contains: "TEMP_VECTORS\\."
    - path: "apps/client/src/components/game/blaze/rockets.tsx"
      provides: "Rockets using pooled temp vectors"
      contains: "TEMP_VECTORS\\."
    - path: "apps/client/src/components/game/hookshot/dragHook.tsx"
      provides: "DragHook using pooled temp vectors"
      contains: "TEMP_VECTORS\\."
  key_links:
    - from: "useFrame hooks in effect components"
      to: "TEMP_VECTORS pool in effectResources.ts"
      via: "Import and usage of pooled vectors"
      pattern: "from.*effectResources.*TEMP_VECTORS"
    - from: "Vector calculations"
      to: "Pre-allocated temp vectors"
      via: ".set() calls on temp vectors instead of new Vector3()"
      pattern: "\\.set\\("
---

<objective>
Replace all remaining object creation (new Vector3, new Quaternion, etc.) in useFrame hooks across remaining effect components with pre-allocated temp vector reuse.

Purpose: After extending the pool and fixing voidRay.tsx in plan 01-04A, remaining effect components still create temp objects. Completing this work eliminates the remaining GC pressure.

Output: All remaining effect components using pre-allocated temp vectors from shared pool, eliminating per-frame allocations.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-react-optimization-foundation/01-RESEARCH.md
@.planning/phases/01-react-optimization-foundation/01-04A-PLAN.md

@apps/client/src/components/game/effectResources.ts
@apps/client/src/components/game/phantom/direBall.tsx
@apps/client/src/components/game/blaze/rockets.tsx
@apps/client/src/components/game/blaze/bomb.tsx
@apps/client/src/components/game/hookshot/dragHook.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Replace Vector3 creation in remaining effect components (direBall, blaze, hookshot)</name>
  <files>
    apps/client/src/components/game/phantom/direBall.tsx
    apps/client/src/components/game/blaze/rockets.tsx
    apps/client/src/components/game/blaze/bomb.tsx
    apps/client/src/components/game/hookshot/dragHook.tsx
    apps/client/src/components/game/hookshot/swingLine.tsx
    apps/client/src/components/game/hookshot/grappleLine.tsx
  </files>
  <action>
Audit and replace all `new THREE.Vector3`, `new THREE.Quaternion`, `new THREE.Euler` in useFrame hooks across these files:

1. direBall.tsx:
   - Grep for `new THREE.Vector3` inside useFrame blocks
   - Replace with appropriate TEMP_VECTORS pool access (v1-v4)
   - Pattern: `new THREE.Vector3(x, y, z)` -> `TEMP_VECTORS.v1.set(x, y, z)`
   - Pattern: `someVector.clone()` -> `TEMP_VECTORS.v2.copy(someVector)`
   - Import TEMP_VECTORS from effectResources

2. rockets.tsx:
   - Find `new THREE.Vector3` in useFrame, replace with TEMP_VECTORS
   - Common patterns: position interpolation, direction calculations, distance check vectors
   - Use v5-v10 range to avoid conflicts

3. bomb.tsx:
   - Same pattern as rockets
   - Find `new THREE.Vector3` in useFrame, replace with TEMP_VECTORS

4. dragHook.tsx, swingLine.tsx, grappleLine.tsx:
   - Hookshot effects calculate chain segment positions, rope curves
   - Use v5-v10 vectors for chain/rope calculations
   - Multiple segments need multiple vectors - plan accordingly

WHY: Rockets fire rapidly (5-10/sec per player). With 3 players firing, that's 15-30 rockets creating temp vectors per frame. Hookshot chains have 10+ segments updating every frame = 600+ objects/sec GC pressure. Completing this work eliminates the remaining GC sources.

NOTE: TEMP_VECTORS pool was extended in 01-04A with v5-v10 and named vectors (tempPos, tempDir, etc.). Use these for parallel effect execution.
  </action>
  <verify>grep -n "new THREE.Vector3\|new THREE.Quaternion\|new THREE.Euler" apps/client/src/components/game/{phantom/direBall,blaze/{rockets,bomb},hookshot/{dragHook,swingLine,grappleLine}}.tsx returns no matches in useFrame blocks</verify>
  <done>All remaining effect components use pooled temp vectors, zero object creation in useFrame</done>
</task>

</tasks>

<verification>
1. Chrome DevTools Memory profiler: Record 30 seconds of mixed ability usage, check for flat allocation (no sawtooth pattern from GC)
2. Search: `grep -r "new THREE.Vector3\|new THREE.Quaternion\|new THREE.Euler" apps/client/src/components/game/**/*.tsx` inside useFrame blocks returns zero
3. Visual: All effects still animate correctly
</verification>

<success_criteria>
1. Zero `new THREE.Vector3/Quaternion/Euler` in useFrame hooks across all effect components
2. All effect components import and use TEMP_VECTORS from effectResources.ts
3. Memory profiler shows flat allocation during heavy ability usage
4. No visual regressions
</success_criteria>

<output>
After completion, create `.planning/phases/01-react-optimization-foundation/01-04B-SUMMARY.md`
</output>
