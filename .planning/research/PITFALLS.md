# Pitfalls Research

**Domain:** React Three Fiber Performance Optimization
**Researched:** 2026-01-22
**Confidence:** HIGH

> **Current project status:** 39 useFrame hooks across 27 files, 57 console.log occurrences, excessive React re-renders from store updates. This research focuses on avoiding new problems while fixing existing ones.

---

## Critical Pitfalls

### Pitfall 1: setState Inside useFrame

**What goes wrong:**
Calling React state setters (including Zustand store actions) inside useFrame triggers expensive React re-renders on every frame (60+ times per second). This is the #1 cause of performance problems in React Three Fiber applications.

**Why it happens:**
- Developers treat useFrame like a standard animation loop
- React's re-render paradigm conflicts with Three.js's direct mutation model
- Using `useGameStore.getState()` in useFrame still triggers re-renders if the state slice was previously subscribed to

**Consequences:**
- Frame drops from 60 FPS to 30 or lower
- Input lag becomes noticeable
- Battery drain on mobile devices
- Garbage collection pressure from constant re-render allocation

**How to avoid:**
```typescript
// BAD - Triggers re-render every frame
useFrame(() => {
  setPosition(new THREE.Vector3(1, 2, 3)); // React state
  useGameStore.getState().setLocalPlayer({ ... }); // Zustand action
});

// GOOD - Mutates directly, no React re-render
const meshRef = useRef<THREE.Mesh>(null);
useFrame(() => {
  if (meshRef.current) {
    meshRef.current.position.set(1, 2, 3); // Direct mutation
  }
});
```

**Warning signs:**
- React DevTools Profiler shows components rendering 60+ times per second
- Performance monitor shows frame time spiking when certain effects are active
- Store subscribers in components that also have useFrame hooks

**Phase to address:** Phase 1 - Store/useFrame separation (foundation)

---

### Pitfall 2: Creating Objects Inside useFrame

**What goes wrong:**
Creating new THREE.Vector3, THREE.Euler, or other objects inside useFrame causes garbage collection thrashing. At 60 FPS, this can create thousands of objects per second.

**Why it happens:**
- Developer习惯 from non-real-time React code
- Not understanding that Three.js objects are expensive to allocate
- Convenience of `new THREE.Vector3(x, y, z)` syntax

**Consequences:**
- GC pauses causing frame stutter
- Memory leaks if objects accumulate
- Performance degrades over time (gradual slowdown during gameplay)

**How to avoid:**
```typescript
// BAD - Creates new object every frame
useFrame(() => {
  const position = new THREE.Vector3(1, 2, 3);
  mesh.current.position.copy(position);
});

// GOOD - Reuses pre-allocated vectors
const tempPos = useRef(new THREE.Vector3());
useFrame(() => {
  tempPos.current.set(1, 2, 3);
  mesh.current.position.copy(tempPos.current);
});

// BETTER - Use shared temp vectors from effectResources.ts
import { TEMP_VECTORS } from './effectResources';
useFrame(() => {
  TEMP_VECTORS.v1.set(1, 2, 3);
  mesh.current.position.copy(TEMP_VECTORS.v1);
});
```

**Warning signs:**
- Chrome DevTools Memory profiler shows increasing heap allocation
- FPS gradually drops during gameplay sessions
- "Allocation size" in performance timeline shows consistent spikes

**Phase to address:** Phase 1 - Already partially addressed via `effectResources.ts`

---

### Pitfall 3: Over-Memoization (Premature Optimization)

**What goes wrong:**
Wrapping everything in `useMemo`, `useCallback`, and `React.memo` without measuring can actually make performance worse. Memoization has a cost, and React often re-computes anyway.

**Why it happens:**
- Fear of re-renders leads to defensive memoization
- Copy-paste optimization patterns without understanding
- ESLint rules demanding dependencies for every callback

**Consequences:**
- Worse performance due to memoization overhead
- More complex code that's harder to maintain
- False sense of security (memoization doesn't prevent all re-renders)
- Stale closures causing bugs

**How to avoid:**
```typescript
// AVOID - Premature memoization
const expensiveValue = useMemo(() => calculateSomething(a, b), [a, b]);
const handleClick = useCallback(() => doSomething(x), [x]);

// PREFER - Simple until proven otherwise
const expensiveValue = calculateSomething(a, b);
const handleClick = () => doSomething(x);

// ONLY memoize when measurements show it helps:
// - Expensive calculations that run frequently
// - Referential stability required by useEffect/useCallback
// - Props passed to memoized child components
```

**Warning signs:**
- Multiple layers of useMemo/useCallback for trivial operations
- Re-render profiling shows no difference with/without memoization
- ESLint exhaustive-deps causing dependency arrays to grow

**Phase to address:** Phase 2 - Measure first, then optimize

---

### Pitfall 4: Store Subscription Granularity Mismatch

**What goes wrong:**
Subscribing to large state objects (like entire player state) causes re-renders when any nested property changes. This is especially bad with Zustand when not using selectors properly.

**Why it happens:**
- Convenience of `const state = useGameStore()`
- Not understanding how Zustand's shallow comparison works
- Selecting nested objects that are recreated on each update

**Consequences:**
- Components re-render when unrelated state changes
- Multiple useFrame hooks re-register when parent re-renders
- Cascading re-renders through component tree

**How to avoid:**
```typescript
// BAD - Subscribes to entire store
const state = useGameStore();
const { localPlayer, gamePhase, players } = useGameStore();

// BAD - Re-creates object on every call (no selector stability)
const localPlayer = useGameStore(state => state.localPlayer); // Object reference changes

// GOOD - Selects specific primitive values
const localPlayerId = useGameStore(state => state.localPlayer?.id);
const gamePhase = useGameStore(state => state.gamePhase);

// GOOD - Uses shallow comparison for objects
const players = useGameStore(state => state.players, shallow);

// BEST - Uses Zustand's pattern for stable object selection
const localPlayer = useGameStore(
  state => state.localPlayer,
  (a, b) => a?.id === b?.id && a?.position === b?.position // custom equality
);
```

**Warning signs:**
- React DevTools shows components re-rendering when "unrelated" state changes
- Effect cleanup functions running unexpectedly
- Multiple instances of same effect (useFrame registered multiple times)

**Phase to address:** Phase 1 - Store subscription audit

---

### Pitfall 5: Multiple Conflicting useFrame Hooks

**What goes wrong:**
While React Three Fiber handles multiple useFrame hooks efficiently (they're batched), having many useFrame hooks that each access the store or perform similar work causes redundant computations.

**Why it happens:**
- Component-level isolation (each effect component manages its own loop)
- Not consolidating related updates
- Fear of "monolithic" useFrame callbacks

**Note:** This is NOT about the number of useFrame hooks themselves (R3F handles 39 hooks fine), but about what they DO.

**Consequences:**
- Multiple store reads per frame for same data
- Redundant distance calculations, visibility checks
- Harder to reason about frame budget

**How to avoid:**
```typescript
// ACCEPTABLE - Multiple useFrame hooks are fine if they're independent
useFrame(() => updateRockets()); // 3 rockets
useFrame(() => updateBombs()); // 2 bombs
useFrame(() => updateTraps()); // 4 traps

// BETTER - Consolidate when accessing same data
useFrame(() => {
  const now = Date.now();
  updateRockets(now);
  updateBombs(now);
  updateTraps(now);
});

// BEST - Single loop for related effects, but keep components separate
function BlazeEffectsManager() {
  useFrame((state, delta) => {
    const now = state.clock.elapsedTime;
    // Update all blaze-related effects in one loop
  });
  return <Rockets /><Bombs /><Jetpacks />;
}
```

**Warning signs:**
- Multiple effects calculating distance to camera
- Same store slice read in multiple useFrame hooks
- Profiler shows same data accessed multiple times per frame

**Phase to address:** Phase 2 - Effect consolidation

---

## Moderate Pitfalls

### Pitfall 6: console.log in Production Code

**What goes wrong:**
Console.log statements in production cause performance degradation and can expose sensitive information. Current codebase has 57 occurrences.

**Why it happens:**
- Debugging code left in place
- Using console.log as a "poor man's telemetry"
- Not having a build step that removes them

**Consequences:**
- String serialization overhead
- Blocking I/O in some browsers
- Exposed internal state to browser console
- Can cause crashes with circular references

**How to avoid:**
```typescript
// BAD - Production console.logs
console.log('OtherPlayers:', { totalInStore: players.size, otherPlayersToRender: otherPlayers.length });
console.log('OtherPlayer mounted:', player.id.slice(0,6), player.name);

// GOOD - Use conditional logging
const DEBUG = import.meta.env.DEV;
if (DEBUG) {
  console.log('OtherPlayers:', data);
}

// BETTER - Use a proper logging utility
import { logger } from '@/utils/logger';
logger.debug('OtherPlayers', data); // Only logs in dev
```

**Warning signs:**
- Browser console fills up during gameplay
- Console panel shows "object" expanding on every frame

**Phase to address:** Phase 1 - Remove all production console.logs

---

### Pitfall 7: Not Disposing Three.js Resources

**What goes wrong:**
Geometries, materials, and textures created but never disposed cause memory leaks. This is especially problematic for single-page applications with repeated game sessions.

**Why it happens:**
- React's unmount doesn't automatically dispose Three.js resources
- Not tracking created resources
- Assuming garbage collection will handle it

**Consequences:**
- Memory grows with each game session
- Textures accumulate in GPU memory
- Browser tab eventually crashes or becomes sluggish

**How to avoid:**
```typescript
// BAD - Doesn't clean up
function Effect() {
  const material = useMemo(() => new THREE.MeshBasicMaterial(), []);
  return <mesh material={material} />;
}

// GOOD - Disposes on unmount
function Effect() {
  const materialRef = useRef<THREE.Material | null>(null);

  useEffect(() => {
    materialRef.current = new THREE.MeshBasicMaterial();
    return () => {
      materialRef.current?.dispose();
    };
  }, []);

  return <mesh material={materialRef.current} />;
}

// BEST - Use shared resources (like effectResources.ts)
const SHARED_GEOMETRIES = {
  sphere8: new THREE.SphereGeometry(1, 8, 8), // Created once, never disposed
};
```

**Warning signs:**
- Chrome Task Manager shows memory growing during gameplay
- Same material appears multiple times in memory profiler
- Performance degrades after playing multiple matches

**Phase to address:** Phase 2 - Resource audit

---

### Pitfall 8: Key Props Causing Unnecessary Remounts

**What goes wrong:**
Using unstable values as `key` props causes React to unmount and remount components, destroying Three.js resources and re-running effects.

**Why it happens:**
- Using array index as key
- Using object references as keys
- Generating keys from computed values

**Consequences:**
- useFrame cleanup and re-registration every key change
- Visual flickering from remounting
- Lost animation state

**How to avoid:**
```typescript
// BAD - Index as key (causes remounts on reorder)
{players.map((player, index) => (
  <OtherPlayer key={index} player={player} />
))}

// BAD - Object reference as key
{players.map(player => (
  <OtherPlayer key={player} player={player} />
))}

// GOOD - Stable unique identifier
{players.map(player => (
  <OtherPlayer key={player.id} player={player} />
))}

// For temporary effects, use stable ID generator
const effectId = useRef(`effect_${Math.random().toString(36).slice(2)}`);
```

**Warning signs:**
- React DevTools shows components rapidly mounting/unmounting
- useEffect cleanup running frequently
- Visual "pops" when lists change

**Phase to address:** Phase 1 - Key prop audit

---

## Performance Traps

| Trap | Symptoms | Prevention | Breaks At |
|------|----------|------------|-----------|
| Point lights per effect | FPS drops when many active | Use single shared light | 5+ lights |
| Shadow map size too high | Frame time spikes on camera move | Use 1024 or 2048 max | 4096+ |
| Not using InstancedMesh | Draw calls > 1000 | InstancedMesh for repeated geometry | 100+ instances |
| Antialias in post-processing | Double-rendering cost | Choose one or the other | Always |
| Fog with transparency | Sorting artifacts | Use custom shaders | Multiple transparent layers |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Zustand | Subscribing to whole store | Use shallow selectors or specific keys |
| Drei | Not checking if helper is optimized | Read source, check for Instance variants |
| Physics (Cannon/Ammo) | Running physics in React render | Run in useFrame, sync to store on change |
| Post-processing | Creating effect pipeline every render | Create once in useMemo with stable deps |

---

## Technical Debt Patterns

| Shortcut | Benefit | Cost | When Acceptable |
|----------|---------|------|-----------------|
| console.log everywhere | Easy debugging | Production perf hit | Only during initial development |
| Direct store.getState() | No subscription overhead | Can miss updates, timing issues | Inside useFrame only |
| Single large useFrame | Consolidated updates | Hard to maintain, test | MVP only |
| Skipping memoization | Simpler code | Re-renders when complexity grows | Until measurements show need |

---

## "Looks Done But Isn't" Checklist

- [ ] **useFrame hooks actually run:** Some useFrame hooks may be in components that never mount or are conditionally rendered
- [ ] **Store updates batched:** Multiple setState calls per frame should be batched
- [ ] **Materials actually shared:** Verify materials aren't being duplicated (use material.uuid to check)
- [ ] **Effects actually clean up:** Verify useEffect cleanup runs when effects expire
- [ ] **LOD actually works:** Distance-based LOD should disable effects, not just reduce detail

---

## Recovery Strategies

| Pitfall | Cost | Recovery Steps |
|---------|-------|----------------|
| setState in useFrame | HIGH | 1. Move state updates outside useFrame, 2. Use refs for frame-local state, 3. Batch updates via requestAnimationFrame |
| Object creation in useFrame | MEDIUM | 1. Audit useFrame for `new` calls, 2. Create pre-allocated temp vectors, 3. Use shared resource module |
| Over-memoization | LOW | 1. Run React DevTools Profiler, 2. Remove useMemo that doesn't help, 3. Keep only expensive computations |
| Store subscription issues | MEDIUM | 1. Add selector functions, 2. Use shallow comparison, 3. Verify with React DevTools |
| Console logs | LOW | 1. Global search for console.log, 2. Replace with debug logger, 3. Add build-time stripping |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| setState in useFrame | Phase 1 | React Profiler shows < 5 renders/sec during gameplay |
| Object creation in useFrame | Phase 1 | Chrome Memory profiler shows stable allocation rate |
| Over-memoization | Phase 2 | Before/after Profiler measurements show difference |
| Store subscription issues | Phase 1 | React DevTools highlights only changed components |
| Multiple useFrame conflicts | Phase 2 | Single frame shows minimal redundant work |
| console.log in production | Phase 1 | Build output has zero console.log calls |
| Not disposing resources | Phase 2 | Memory stable across 10 game sessions |
| Key prop instability | Phase 1 | No unexpected mount/unmount in DevTools |

---

## Sources

### Official Documentation (HIGH Confidence)
- [React Three Fiber - Performance Pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls) - Official documentation on setState in loops, mount costs
- [React Three Fiber - Scaling Performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance) - Official performance guide
- [Zustand GitHub Repository](https://github.com/pmndrs/zustand) - Official Zustand by pmndrs (same team as R3F)

### Community Discussions (MEDIUM Confidence)
- [How to use state management with R3F without performance issues](https://discourse.threejs.org/t/how-to-use-state-management-with-react-three-fiber-without-performance-issues/61223) - Confirms Zustand + R3F compatibility
- [How to improve three.js performance with R3F](https://discourse.threejs.org/t/how-to-improve-three-js-performance-with-react-three-fiber/69562) - Real-world optimization discussion
- [R3F Instances Performance Issue #3306](https://github.com/pmndrs/react-three-fiber/issues/3306) - Real-world performance problem case study

### Articles (MEDIUM Confidence)
- [100 Three.js Best Practices (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips) - Comprehensive best practices including R3F-specific pitfalls
- [Hacker News - React Re-render Discussion](https://news.ycombinator.com/item?id=23004848) - Notes on premature optimization in React community

### Code Analysis (HIGH Confidence)
- Current codebase: 39 useFrame hooks across 27 files
- Current codebase: 57 console.log occurrences
- Current codebase: Shared resource pattern in `effectResources.ts` (good pattern to follow)
- Current codebase: Store subscription patterns in `gameStore.ts` and components

---

*Pitfalls research for: React Three Fiber Performance Optimization*
*Researched: 2026-01-22*
