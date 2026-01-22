# Phase 01: React Optimization Foundation - Research

**Researched:** 2026-01-22
**Domain:** React Performance + React Three Fiber + Zustand
**Confidence:** HIGH

## Summary

This phase targets React-level performance anti-patterns that cause cascading re-renders and frame time spikes in a React Three Fiber game. The codebase already demonstrates awareness of some performance patterns (shared geometries in `effectResources.ts`, temp vector reuse in some files) but has significant gaps:

1. **setState in useFrame hooks**: Found in `earthWall.tsx` line 218, causing React render cycles at 60fps
2. **Broad Zustand subscriptions**: Most components use `useGameStore()` without shallow comparison, subscribing to entire store
3. **Missing React.memo**: Effect components like `RocketEffect`, `VoidRay`, `DireBall` have no memoization
4. **Object creation in useFrame**: New THREE objects created per-frame in multiple components
5. **57 console.log statements**: Execute in production builds with no stripping configured

The codebase uses React 18.3.1, @react-three/fiber 8.17.10, Zustand 5.0.0, and Three.js 0.169.0.

**Primary recommendation:** Follow React Three Fiber's official performance guidance - mutate refs in useFrame, never setState; use Zustand's `useShallow` for multi-property selectors; add React.memo to effect components; configure Vite esbuild to drop console in production.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @react-three/fiber | 8.17.10 | React renderer for Three.js | Official React bridge for Three.js |
| zustand | 5.0.0 | State management | Lightweight, built-in selector optimization |
| React | 18.3.1 | UI framework | Current stable, Concurrent Mode by default in R3F v8+ |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zustand/shallow | bundled | Selector optimization | Selecting multiple state properties |
| vite/esbuild | bundled | Build-time console stripping | Production builds only |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| zustand/shallow | Manual shallow compare function | More boilerplate, same performance |
| esbuild drop console | babel-plugin-transform-remove-console | Extra dependency, slower |
| React.memo | useMemo for entire JSX | Less flexible, can't skip render completely |

**Installation:**
```bash
# Already installed
# zustand/shallow is bundled with zustand 5.0.0
import { useShallow } from 'zustand/react/shallow' // or 'zustand/shallow'
```

## Architecture Patterns

### Recommended Project Structure

```
src/
├── components/game/
│   ├── effects/          # All effect components (memoized)
│   ├── effectResources.ts# Shared geometries/materials (already exists)
│   └── [hero]/           # Hero-specific effects
├── hooks/
│   └── useTempVectors.ts # Temp vector allocation utilities
└── store/
    └── gameStore.ts      # Zustand store with optimized selectors
```

### Pattern 1: useFrame with Ref Mutation (No setState)

**What:** In React Three Fiber, useFrame runs 60fps. Calling setState triggers React reconciliation - completely unnecessary for visual updates.

**When to use:** All per-frame animation in R3F components.

**Example:**

```typescript
// Source: https://r3f.docs.pmnd.rs/advanced/pitfalls

// BAD - setState triggers React render cycle every frame
const [x, setX] = useState(0)
useFrame(() => setX((x) => x + 0.1))
return <mesh position-x={x} />

// GOOD - Direct mutation, no React overhead
const meshRef = useRef()
useFrame((state, delta) => (meshRef.current.position.x += delta))
return <mesh ref={meshRef} />
```

### Pattern 2: Zustand Selectors with useShallow

**What:** Selecting multiple properties without shallow comparison causes re-render on ANY store change.

**When to use:** Any component subscribing to 2+ store properties.

**Example:**

```typescript
// Source: https://zustand.docs.pmnd.rs/hooks/use-shallow

// BAD - Re-renders on ANY state change
const { players, playerId, gamePhase } = useGameStore();

// GOOD - Only re-renders when selected properties change
import { useShallow } from 'zustand/shallow';

const { players, playerId, gamePhase } = useGameStore(
  useShallow((state) => ({
    players: state.players,
    playerId: state.playerId,
    gamePhase: state.gamePhase,
  }))
);
```

### Pattern 3: React.memo for Effect Components

**What:** Wrap effect components so they only re-render when props actually change.

**When to use:** All effect components that receive props (RocketEffect, VoidRay, DireBall, etc.).

**Example:**

```typescript
// BAD - Re-renders when parent re-renders
function RocketEffect({ rocket }: RocketEffectProps) {
  // ...
}

// GOOD - Only re-renders when rocket prop changes
const RocketEffect = React.memo(function RocketEffect({ rocket }: RocketEffectProps) {
  // ...
});
```

### Anti-Patterns to Avoid

- **setState in useFrame**: Triggers React reconciliation at 60fps. Use ref mutations instead.
- **Broad Zustand subscriptions**: `useGameStore()` subscribes to entire store. Use narrow selectors.
- **Effect components without memo**: Parent re-renders cascade to all children. Wrap with React.memo.
- **Creating THREE objects in useFrame**: `new THREE.Vector3()` 60 times/sec = GC pressure. Use pre-allocated temps.
- **console.log in production**: No current stripping configured in vite.config.ts.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Shallow comparison | Custom shallow equal | `zustand/shallow` | Built-in, battle-tested |
| Console stripping | Custom logger wrapper | esbuild.drop | Compile-time elimination |
| Temp vector pool | Custom object pool | Module-level consts | Simpler, no ref tracking overhead |
| Selector memoization | Custom memo cache | useShallow hook | Handles dependency tracking |

**Key insight:** Zustand 5.0 includes optimized shallow comparison. Building custom solutions adds complexity without performance benefit.

## Common Pitfalls

### Pitfall 1: setState in useFrame for Dynamic Content

**What goes wrong:** In `earthWall.tsx:218`, `setWallSegments` is called during useFrame when new wall segments are created. This triggers React re-renders for the entire component tree at 60fps during ability execution.

**Why it happens:** Developer thinking in "React state" mindset rather than "R3F render loop" mindset.

**How to avoid:** Use ref to track wall segments array, mutate directly. Only call setState if truly needed (rare in R3F).

**Warning signs:** Frame time spikes in profiler correlate with ability activation; DevTools shows component highlighting every frame.

### Pitfall 2: Console.log in Production

**What goes wrong:** 57 console.log statements found across codebase execute in production, adding frame time overhead.

**Why it happens:** No esbuild configuration to strip console in vite.config.ts.

**How to avoid:** Add `esbuild: { drop: ['console', 'debugger'] }` to build config.

**Warning signs:** Performance profiles show console.log time; build output unchanged from dev.

### Pitfall 3: Broad Zustand Subscriptions

**What goes wrong:** Components like `OtherPlayers.tsx:13` use `const { players, playerId, gamePhase } = useGameStore()` - this subscribes to ALL state changes. When ANY property updates (e.g., slideIntensity), component re-renders.

**Why it happens:** Default Zustand behavior without selector optimization.

**How to avoid:** Always use narrow selectors or useShallow for multi-property selection.

**Warning signs:** React DevTools Profiler shows components re-rendering when unrelated state changes.

### Pitfall 4: Creating THREE Objects in useFrame

**What goes wrong:** Code like `new THREE.Vector3(x, y, z)` inside useFrame allocates 60 objects per second. GC pressure causes frame hitches.

**Why it happens:** Developer doesn't realize THREE object allocation is expensive.

**How to avoid:** Use pre-allocated module-level vectors (already exists in `effectResources.ts` as `TEMP_VECTORS`).

**Warning signs:** Chrome DevTools Memory profile shows increasing allocation rate; GC pauses correlate with stuttering.

### Pitfall 5: Missing React.memo on Effect Components

**What goes wrong:** Parent re-render (e.g., PlayerController) cascades to ALL effect components. During ability use with 10+ effects, this means 10+ unnecessary component renders per frame.

**Why it happens:** React's default behavior is to re-render all children when parent renders.

**How to avoid:** Wrap effect components with React.memo, ensure props are primitive or stable references.

**Warning signs:** React DevTools Profiler shows effect components highlighted when parent re-renders but props unchanged.

## Code Examples

### Verified Pattern: Temp Vector Reuse

```typescript
// Source: apps/client/src/components/game/effectResources.ts (lines 68-80)

export const TEMP_VECTORS = {
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
} as const;

// Usage in component:
import { TEMP_VECTORS } from '../effectResources';

useFrame(() => {
  TEMP_VECTORS.v1.set(x, y, z);
  TEMP_VECTORS.v2.addVectors(TEMP_VECTORS.v1, other);
  // No allocations!
});
```

### Verified Pattern: Zustand Narrow Selector

```typescript
// Source: https://zustand.docs.pmnd.rs/apis/shallow

// Import from zustand (bundled in v5.0.0)
import { useShallow } from 'zustand/shallow';

// Component only re-renders when these specific values change
function PlayerController() {
  const updateLocalPlayer = useGameStore(state => state.updateLocalPlayer);
  const shadowStepTargeting = useGameStore(
    useShallow((state) => state.shadowStepTargeting)
  );
  // ...
}
```

### Verified Pattern: React.memo for Effects

```typescript
// Source: React official docs

const RocketEffect = React.memo(function RocketEffect({ rocket }: RocketEffectProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    // Animation code here
  });

  return <group ref={groupRef}>...</group>;
});

// For components with custom comparison:
const VoidRay = React.memo(function VoidRay({ ray }: VoidRayProps) {
  // ...
}, (prevProps, nextProps) => {
  // Custom comparison for complex props
  return prevProps.ray.id === nextProps.ray.id &&
         prevProps.ray.startTime === nextProps.ray.startTime;
});
```

### Verified Pattern: Vite Console Stripping

```typescript
// Source: Vite docs + https://github.com/vitejs/vite/discussions/7920

export default defineConfig({
  // ... existing config
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| setState in useFrame | Ref mutations | R3F v1+ | Eliminates React reconciliation overhead |
| Manual shallow compare | zustand/useShallow | Zustand v4+ | Cleaner API, same performance |
| No console stripping | esbuild.drop | Vite v2+ | Zero-cost logging removal |
| Per-component materials | Shared material cache | R3F best practices | Reduced memory, shader compilation |

**Deprecated/outdated:**
- setState in useFrame: Officially discouraged in R3F docs since v1
- Unscoped Zustand selectors: Causes cascading re-renders
- Manual console.log wrapping: esbuild.drop is compile-time zero-cost

## Open Questions

1. **React.memo with custom comparison for complex props**: Effect components receive complex objects (RocketData, VoidRayData). Need to determine if default shallow comparison is sufficient or if custom comparison functions are needed. Default shallow compare should work if object references are stable.

2. **setState for dynamic content**: EarthWall creates wall segments dynamically. Converting to ref-based approach means manual rendering. Need to decide if this is worth the complexity or if rare setState is acceptable. Recommendation: Convert to ref-based, use map to render from ref.

3. **Profiler verification**: Need to establish baseline with React DevTools Profiler before optimizations to measure impact. Success criteria includes "no component re-rendering more than once per frame during ability use."

## Sources

### Primary (HIGH confidence)

- [Performance pitfalls - React Three Fiber](https://r3f.docs.pmnd.rs/advanced/pitfalls) - Official R3F docs on setState in useFrame, object allocation
- [useShallow - Zustand](https://zustand.docs.pmnd.rs/hooks/use-shallow) - Official Zustand docs on selector optimization
- [Vite esbuild.drop discussion](https://github.com/vitejs/vite/discussions/7920) - Official guidance on console removal

### Secondary (MEDIUM confidence)

- [Avoid performance issues with Zustand](https://dev.to/devgrana/avoid-performance-issues-when-using-zustand-12ee) - Community-verified patterns
- [Optimize React App Performance in 2026](https://trio.dev/optimize-react-app-performance/) - Modern React optimization context
- [React.memo: Optimizing Performance](https://dev.to/engrsakib/reactmemo-optimizing-performance-in-react-applications-5hmf) - Memoization patterns

### Tertiary (LOW confidence)

- [Zustand vs Redux in 2026](https://javascript.plainenglish.io/zustand-vs-redux-in-2026-why-i-switched-and-you-should-too-c119dd840ddb) - Comparison article, confirms Zustand approach
- [React DevTools Profiler](https://www.reddit.com/r/reactjs/comments/1jf8ivq/react_developer_tools_tools_falsely_showing/) - Community discussion on profiler accuracy

### Codebase Analysis (HIGH confidence)

- `/apps/client/src/components/game/PlayerController.tsx` - Main player controller, 54-70: broad store subscriptions
- `/apps/client/src/components/game/hookshot/earthWall.tsx` - Line 218: setState in useFrame
- `/apps/client/src/components/game/OtherPlayers.tsx` - Line 13: broad store subscription, lines 30-42: console.log
- `/apps/client/src/components/game/blaze/rockets.tsx` - Effect component without memo
- `/apps/client/src/components/game/phantom/voidRay.tsx` - Effect component without memo, lines 537-555: object creation in useFrame
- `/apps/client/src/store/gameStore.ts` - Zustand store structure
- `/apps/client/src/components/game/effectResources.ts` - TEMP_VECTORS pattern (good example)
- `/apps/client/vite.config.ts` - Missing console stripping config

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Verified via package.json and official docs
- Architecture: HIGH - Verified via official R3F and Zustand documentation
- Pitfalls: HIGH - Found in codebase analysis + verified against official guidance

**Research date:** 2026-01-22
**Valid until:** 2026-03-01 (30 days - R3F and Zustand are stable, but check for minor version updates)

**Current stack versions:**
- react: 18.3.1
- @react-three/fiber: 8.17.10
- @react-three/drei: 9.114.3
- zustand: 5.0.0
- three: 0.169.0
- vite: 5.4.10
