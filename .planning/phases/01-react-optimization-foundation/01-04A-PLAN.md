---
phase: 01-react-optimization-foundation
plan: 04A
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/client/src/components/game/effectResources.ts
  - apps/client/src/components/game/phantom/voidRay.tsx
autonomous: true
user_setup: []

must_haves:
  truths:
    - "TEMP_VECTORS pool extended with additional vectors for parallel effect use"
    - "voidRay.tsx useFrame creates zero temporary Vector3/Quaternion objects per frame"
    - "Allocation profiling shows flat memory allocation in voidRay during 60fps gameplay"
  artifacts:
    - path: "apps/client/src/components/game/effectResources.ts"
      provides: "Extended TEMP_VECTORS pool for effect use"
      contains: "TEMP_VECTORS.*v[5-9]|TEMP_VECTORS.*v10|TEMP_VECTORS.*temp[A-Z]"
    - path: "apps/client/src/components/game/phantom/voidRay.tsx"
      provides: "VoidRay using pooled temp vectors"
      contains: "TEMP_VECTORS\\."
  key_links:
    - from: "useFrame hooks in voidRay.tsx"
      to: "TEMP_VECTORS pool in effectResources.ts"
      via: "Import and usage of pooled vectors"
      pattern: "from.*effectResources.*TEMP_VECTORS"
    - from: "Vector calculations in voidRay"
      to: "Pre-allocated temp vectors"
      via: ".set() calls on temp vectors instead of new Vector3()"
      pattern: "\\.set\\("
---

<objective>
Extend TEMP_VECTORS pool and replace object creation in voidRay.tsx useFrame with pre-allocated temp vector reuse.

Purpose: Creating new Vector3/Quaternion objects in useFrame (60 times/second) causes massive GC pressure and periodic collection pauses. The existing TEMP_VECTORS pool needs extension and voidRay.tsx is the highest-priority component for this optimization.

Output: Extended TEMP_VECTORS pool and voidRay.tsx using pre-allocated temp vectors, eliminating per-frame allocations in this critical component.
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

@apps/client/src/components/game/effectResources.ts
@apps/client/src/components/game/phantom/voidRay.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend TEMP_VECTORS pool in effectResources.ts</name>
  <files>apps/client/src/components/game/effectResources.ts</files>
  <action>
In effectResources.ts, lines 68-80:
1. Extend the TEMP_VECTORS object with additional temp vectors for parallel use:
```typescript
export const TEMP_VECTORS = {
  // Original vectors (keep for compatibility)
  v1: new THREE.Vector3(),
  v2: new THREE.Vector3(),
  v3: new THREE.Vector3(),
  v4: new THREE.Vector3(),
  quat1: new THREE.Quaternion(),
  quat2: new THREE.Quaternion(),
  euler1: new THREE.Euler(),
  color1: new THREE.Color(),
  forward: new THREE.Vector3(0, 0, -1),
  up: new THREE.Vector3(0, 1, 0),
  right: new THREE.Vector3(1, 0, 0),

  // Additional vectors for effect use (v5-v10 for complex effects)
  v5: new THREE.Vector3(),
  v6: new THREE.Vector3(),
  v7: new THREE.Vector3(),
  v8: new THREE.Vector3(),
  v9: new THREE.Vector3(),
  v10: new THREE.Vector3(),

  // Named temp vectors for specific use cases
  tempPos: new THREE.Vector3(),
  tempDir: new THREE.Vector3(),
  tempScale: new THREE.Vector3(),
  tempRot: new THREE.Quaternion(),
} as const;
```

2. Add comment explaining usage pattern:
```typescript
// USAGE: Always .set() values, never store references
// BAD: const myVec = new THREE.Vector3(x, y, z)
// GOOD: TEMP_VECTORS.v1.set(x, y, z); // use TEMP_VECTORS.v1; // then .set(0,0,0) if needed
```

WHY: Research identified voidRay.tsx lines 537-555 creating new Vector3s in useFrame. We need more temp vectors for multiple effects running simultaneously without conflicts.
  </action>
  <verify>grep "v[5-9]:\|v10:\|tempPos:\|tempDir:\|tempScale:" apps/client/src/components/game/effectResources.ts returns matches</verify>
  <done>TEMP_VECTORS pool extended with 6 additional vectors and 4 named vectors</done>
</task>

<task type="auto">
  <name>Task 2: Replace Vector3 creation in voidRay.tsx useFrame</name>
  <files>apps/client/src/components/game/phantom/voidRay.tsx</files>
  <action>
In voidRay.tsx, lines 526-556 (player collision loop):
1. Add import: `import { TEMP_VECTORS } from '../../effectResources';`
2. Replace object creation with pool usage:

Before (line 537):
```typescript
const playerPos = new THREE.Vector3(player.position.x, player.position.y + 0.9, player.position.z);
const rayStart = new THREE.Vector3(startPosition.x, startPosition.y, startPosition.z);
const rayDir = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
```

After:
```typescript
const playerPos = TEMP_VECTORS.v5.set(player.position.x, player.position.y + 0.9, player.position.z);
const rayStart = TEMP_VECTORS.v6.set(startPosition.x, startPosition.y, startPosition.z);
const rayDir = TEMP_VECTORS.v7.set(direction.x, direction.y, direction.z).normalize();
```

3. Replace line 541-546 (toPlayer calculation):
```typescript
// Before:
const toPlayer = playerPos.clone().sub(rayStart);

// After:
const toPlayer = TEMP_VECTORS.v8.copy(playerPos).sub(rayStart);
```

4. Replace line 546 (closestPoint calculation):
```typescript
// Before:
const closestPoint = rayStart.clone().add(rayDir.clone().multiplyScalar(projectionLength));

// After:
const closestPoint = TEMP_VECTORS.v9.copy(rayStart).add(TEMP_VECTORS.v10.copy(rayDir).multiplyScalar(projectionLength));
```

CRITICAL: Add cleanup at end of useFrame to reset vectors (optional but good practice):
```typescript
// At end of useFrame, after all calculations:
// TEMP_VECTORS.v5.set(0, 0, 0); // Only if needed for next frame
```

WHY: Lines 537-555 create 5+ new Vector3 objects EVERY FRAME (60/sec = 360 objects/sec GC pressure). Using pooled vectors eliminates this allocation entirely.

NOTE: Each VoidRay component has its own useFrame. We use v5-v10 which should be safe since no code path uses all 10 simultaneously in a single component.
  </action>
  <verify>grep -n "new THREE.Vector3\|new THREE.Quaternion" apps/client/src/components/game/phantom/voidRay.tsx returns no matches in useFrame block</verify>
  <done>voidRay.tsx uses pooled temp vectors, zero object creation in useFrame</done>
</task>

</tasks>

<verification>
1. Chrome DevTools Memory profiler: Record 30 seconds focusing on void ray usage, check for flat allocation (no sawtooth pattern from GC)
2. Search: `grep -n "new THREE.Vector3\|new THREE.Quaternion\|new THREE.Euler" apps/client/src/components/game/phantom/voidRay.tsx` inside useFrame blocks returns zero
3. Visual: Void ray effect still animates correctly
</verification>

<success_criteria>
1. TEMP_VECTORS pool extended with v5-v10 and named temp vectors
2. voidRay.tsx uses pooled temp vectors, zero object creation in useFrame
3. Memory profiler shows flat allocation during void ray usage
4. No visual regressions
</success_criteria>

<output>
After completion, create `.planning/phases/01-react-optimization-foundation/01-04A-SUMMARY.md`
</output>
