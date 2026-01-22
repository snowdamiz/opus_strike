# Phase 02: Visual State Architecture - Research

**Researched:** 2026-01-22
**Domain:** React Three Fiber performance optimization, visual state separation
**Confidence:** HIGH

## Summary

This phase researches how to separate high-frequency visual updates (60fps) from authoritative game state in a React Three Fiber application. The current codebase uses Zustand with 77+ useFrame hooks that update visual state through React re-renders, causing performance issues.

**Key findings:**
1. React Three Fiber's official documentation explicitly recommends **mutation in useFrame** for high-frequency updates, not setState/store updates
2. Zustand supports **vanilla stores** (`createStore`) for non-reactive state mutations
3. Multiple useFrame hooks are acceptable and don't create additional render calls
4. r3f-perf is the standard performance monitoring tool for React Three Fiber

**Primary recommendation:** Create a separate visualStore using Zustand's vanilla store pattern, accessed via `getState()` mutations in useFrame hooks, eliminating React re-renders for 60fps visual updates.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **@react-three/fiber** | ^8.17.10 | React renderer for Three.js | Project already uses this version; provides useFrame hook for render loop |
| **zustand** | ^5.0.0 | State management | Current store; vanilla store API perfect for non-reactive visual state |
| **r3f-perf** | latest | Performance monitoring | Official recommendation for R3F performance metrics; replaces stats.js |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@react-three/drei** | ^9.114.3 | Helper components | Already in use; provides PerformanceMonitor component |
| **three** | ^0.169.0 | 3D graphics library | Current version; required for Vector3, lerp utilities |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zustand vanilla store | Redux Toolkit vanilla | Redux is heavier; Zustand already in project |
| r3f-perf | stats.js | r3f-perf provides R3F-specific metrics (GPU calls, triangles) |
| Mutation in useFrame | react-spring | react-spring good for tweens, but overkill for continuous position updates |

**Installation:**
```bash
npm install --save-dev r3f-perf
```

## Architecture Patterns

### Recommended Project Structure
```
apps/client/src/
├── store/
│   ├── gameStore.ts           # Existing authoritative game state
│   ├── visualStore.ts         # NEW: High-frequency visual state (vanilla)
│   ├── slices/                # Existing game state slices
│   └── types.ts               # Existing type definitions
├── components/
│   └── game/
│       ├── PerfMonitor.tsx    # NEW: r3f-perf integration
│       └── ...
├── hooks/
│   ├── useVisualState.ts      # NEW: Hook for accessing visual state
│   └── ...
```

### Pattern 1: Zustand Vanilla Store for Visual State

**What:** Create a Zustand store without React hooks using `createStore` from `zustand/vanilla`. This provides non-reactive state that can be mutated without triggering React re-renders.

**When to use:** High-frequency updates (60fps) for positions, rotations, animations that don't need to trigger React component updates.

**Why:**
- Vanilla stores don't trigger React re-renders
- Can be accessed via `getState()` for direct mutations
- Can be subscribed to with `subscribe()` for selective reactivity
- Same API as regular Zustand stores, just without the hook

**Example:**
```typescript
// Source: https://github.com/pmndrs/zustand
import { createStore } from 'zustand/vanilla'

// Visual state interface
interface VisualState {
  playerPositions: Map<string, { x: number; y: number; z: number }>
  playerRotations: Map<string, number>
  cameraShake: { intensity: number; duration: number }
  // ... other high-frequency visual data
}

// Create vanilla store (NOT a hook)
const visualStore = createStore<VisualState>(() => ({
  playerPositions: new Map(),
  playerRotations: new Map(),
  cameraShake: { intensity: 0, duration: 0 },
}))

// Export store instance
export { visualStore }

// Export typed hook for optional reactive access
import { useStore } from 'zustand'
export const useVisualStore = (selector: (state: VisualState) => T) =>
  useStore(visualStore, selector)
```

### Pattern 2: Mutation in useFrame (Official R3F Pattern)

**What:** Use React Three Fiber's `useFrame` hook to directly mutate Three.js objects and visual state, bypassing React's render cycle entirely.

**When to use:** All high-frequency updates in Three.js objects (positions, rotations, animations).

**Why:**
- useFrame runs once per render loop iteration (60fps)
- Multiple useFrame hooks don't create additional render calls
- Mutations are invisible to React DevTools
- Officially recommended pattern in R3F docs

**Example:**
```typescript
// Source: https://r3f.docs.pmnd.rs/advanced/pitfalls
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { visualStore } from '../../store/visualStore'

function OtherPlayer({ playerId }: { playerId: string }) {
  const groupRef = useRef<THREE.Group>(null)
  const currentPos = useRef(new THREE.Vector3())
  const targetPos = useRef(new THREE.Vector3())

  useFrame((state, delta) => {
    if (!groupRef.current) return

    // Get target position from visual store (non-reactive)
    const target = visualStore.getState().playerPositions.get(playerId)
    if (!target) return

    // Lerp toward target (smooth interpolation)
    targetPos.current.set(target.x, target.y, target.z)
    currentPos.current.lerp(targetPos.current, Math.min(1, delta * 15))

    // Directly mutate Three.js object (no re-render)
    groupRef.current.position.copy(currentPos.current)
  })

  return <group ref={groupRef}>{/* ... */}</group>
}
```

### Pattern 3: Centralized Animation Loop (Priority-Based)

**What:** Consolidate multiple useFrame hooks into a single, priority-based animation loop system for better organization and profiling.

**When to use:** When 77+ useFrame hooks become difficult to manage and profile; complex animation dependencies.

**Why:**
- Single point of entry for frame updates
- Easier to profile and debug
- Priority system ensures critical updates happen first
- Can be enabled/disabled per system

**Example:**
```typescript
// Source: Community pattern for consolidating useFrame hooks
import { useFrame } from '@react-three/fiber'

type FrameCallback = (state: RootState, delta: number) => void

class AnimationLoop {
  private callbacks: Map<string, { fn: FrameCallback; priority: number }> = new Map()

  register(id: string, fn: FrameCallback, priority: number = 0) {
    this.callbacks.set(id, { fn, priority })
  }

  unregister(id: string) {
    this.callbacks.delete(id)
  }

  update(state: RootState, delta: number) {
    // Sort by priority (higher = first)
    const sorted = Array.from(this.callbacks.values())
      .sort((a, b) => b.priority - a.priority)

    sorted.forEach(({ fn }) => fn(state, delta))
  }
}

const animationLoop = new AnimationLoop()

// Use in components
function useAnimation(id: string, fn: FrameCallback, priority?: number) {
  useEffect(() => {
    animationLoop.register(id, fn, priority)
    return () => animationLoop.unregister(id)
  }, [id, fn, priority])
}

// Root component runs the loop
function AnimationRoot() {
  useFrame((state, delta) => animationLoop.update(state, delta))
  return null
}
```

### Anti-Patterns to Avoid

- **❌ setState in useFrame:** Never call `setState` or store update functions inside useFrame. This routes updates through React's scheduler, causing unnecessary re-renders.
  ```typescript
  // BAD
  useFrame(() => setX(x => x + 0.1))

  // GOOD
  useFrame((state, delta) => { ref.current.position.x += delta })
  ```

- **❌ Creating new objects in loops:** Allocating new Vector3/objects every frame triggers GC. Reuse objects.
  ```typescript
  // BAD - Creates 60 new vectors per second
  useFrame(() => ref.current.position.lerp(new THREE.Vector3(x, y, z), 0.1))

  // GOOD - Reuses vector
  const vec = new THREE.Vector3()
  useFrame(() => ref.current.position.lerp(vec.set(x, y, z), 0.1))
  ```

- **❌ Reactive bindings for fast state:** Don't use `useStore` selector for 60fps updates.
  ```typescript
  // BAD - Re-renders 60fps
  const position = useVisualStore(state => state.playerPositions.get(id))

  // GOOD - Non-reactive access
  useFrame(() => {
    const position = visualStore.getState().playerPositions.get(id)
  })
  ```

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Performance monitoring | Custom FPS counter | r3f-perf | Provides GPU metrics, draw calls, triangle count; battle-tested |
| Non-reactive state | Custom ref-based system | Zustand vanilla store | Same API, tested, supports subscriptions |
| Animation loop | Custom frame scheduler | useFrame (R3F built-in) | Official pattern, handles frame timing correctly |
| Interpolation | Custom lerp logic | THREE.MathUtils.lerp | Optimized, handles edge cases |

**Key insight:** The React Three Fiber team has already solved these problems. Their recommended patterns (mutation in useFrame, non-reactive state access) are battle-tested across thousands of 3D applications.

## Common Pitfalls

### Pitfall 1: Store Updates in useFrame
**What goes wrong:** Calling `updateLocalPlayer` or other store update functions in useFrame triggers React re-renders at 60fps, killing performance and making React DevTools unusable.

**Why it happens:** Developers are trained to "never mutate directly" and use state setters. In R3F, this rule is inverted for frame updates.

**How to avoid:** Use vanilla store pattern. Only call store updates when authoritative state changes (network messages, user input), not per-frame visual updates.

**Warning signs:** React DevTools showing 60+ updates per second, profiler showing "committed" every frame.

### Pitfall 2: Memory Leaks from Object Creation
**What goes wrong:** Creating `new THREE.Vector3()`, `new THREE.Euler()`, or other Three.js objects in useFrame causes GC pressure, leading to frame drops.

**Why it happens:** JavaScript's garbage collector has to clean up 60+ objects per second, causing stuttering.

**How to avoid:** Create reusable objects in component scope or module scope, use `.set()` to update values.

**Warning signs:** Chrome DevTools Memory profiler shows increasing allocation rate, FPS drops periodically.

### Pitfall 3: Over-Centralization
**What goes wrong:** Trying to consolidate all 77+ useFrame hooks into a single system before understanding which ones are actually problematic.

**Why it happens:** Premature optimization based on "too many hooks" without profiling.

**How to avoid:** Profile with r3f-perf first. Only consolidate hooks that:
1. Update at 60fps
2. Cause measurable performance issues
3. Have complex dependencies

**Warning signs:** Spending more time on architecture than measuring actual impact.

## Code Examples

Verified patterns from official sources:

### Visual Store Creation (Zustand Vanilla)
```typescript
// Source: https://github.com/pmndrs/zustand
import { createStore } from 'zustand/vanilla'

interface VisualState {
  // Player visual positions (60fps updates)
  playerPositions: Map<string, THREE.Vector3>
  playerRotations: Map<number> // playerId -> lookYaw

  // Camera effects
  cameraShake: { intensity: number; time: number }
  slideFov: number

  // Interpolation targets
  interpolationTargets: Map<string, THREE.Vector3>
}

const initialVisualState: VisualState = {
  playerPositions: new Map(),
  playerRotations: new Map(),
  cameraShake: { intensity: 0, time: 0 },
  slideFov: 0,
  interpolationTargets: new Map(),
}

export const visualStore = createStore<VisualState>(() => initialVisualState)

// Non-reactive updates (for useFrame)
export const updatePlayerVisualPosition = (playerId: string, position: THREE.Vector3) => {
  visualStore.setState(state => {
    const newPositions = new Map(state.playerPositions)
    newPositions.set(playerId, position.clone())
    return { playerPositions: newPositions }
  })
}

// Reactive access (for UI components that need it)
import { useStore } from 'zustand'
export const useVisualStore = <T>(selector: (state: VisualState) => T) =>
  useStore(visualStore, selector)
```

### Non-Reactive Position Updates in useFrame
```typescript
// Source: https://r3f.docs.pmnd.rs/advanced/pitfalls
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { visualStore } from '../../store/visualStore'

function PlayerModel({ playerId }: { playerId: string }) {
  const groupRef = useRef<THREE.Group>(null)

  // Reusable vector to avoid GC
  const tempVec = useRef(new THREE.Vector3())
  const currentPos = useRef(new THREE.Vector3())
  const targetPos = useRef(new THREE.Vector3())

  useFrame((state, delta) => {
    if (!groupRef.current) return

    // Get target position from visual store (non-reactive, no re-render)
    const visualState = visualStore.getState()
    const target = visualState.playerPositions.get(playerId)

    if (!target) return

    // Lerp toward target for smooth interpolation
    tempVec.current.copy(target)
    currentPos.current.lerp(tempVec.current, Math.min(1, delta * 15))

    // Directly mutate Three.js object (invisible to React)
    groupRef.current.position.copy(currentPos.current)
    groupRef.current.rotation.y = visualState.playerRotations.get(playerId) ?? 0
  })

  return <group ref={groupRef}>{/* Player model */}</group>
}
```

### r3f-perf Integration
```typescript
// Source: https://github.com/utsuboco/r3f-perf
import { Perf } from 'r3f-perf'

export function PerformanceMonitor() {
  return (
    <Perf
      position="top-left"
      minimal={false}  // Show detailed metrics
      styleChartSize={200}
    />
  )
}

// In Canvas:
import { Canvas } from '@react-three/fiber'
import { PerformanceMonitor } from './PerformanceMonitor'

function App() {
  return (
    <Canvas>
      <PerformanceMonitor />
      {/* Scene content */}
    </Canvas>
  )
}
```

### Migrating from Store Updates to Visual Store
```typescript
// BEFORE (BAD - 60fps re-renders):
function OtherPlayer({ player }: { player: Player }) {
  useFrame((_, delta) => {
    // This triggers React re-render every frame!
    updateLocalPlayer({
      position: {
        x: player.position.x + delta,
        y: player.position.y,
        z: player.position.z
      }
    })
  })
  return <mesh position={[player.position.x, player.position.y, player.position.z]} />
}

// AFTER (GOOD - no re-renders):
import { visualStore } from '../../store/visualStore'

function OtherPlayer({ playerId }: { playerId: string }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const currentPos = useRef(new THREE.Vector3())

  useFrame((_, delta) => {
    if (!meshRef.current) return

    // Get visual position from store (non-reactive)
    const visualState = visualStore.getState()
    const target = visualState.playerPositions.get(playerId)

    if (target) {
      // Interpolate toward target
      currentPos.current.lerp(target, delta * 15)

      // Direct mutation (no re-render)
      meshRef.current.position.copy(currentPos.current)
    }
  })

  return <mesh ref={meshRef} />
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| setState in useFrame | Direct mutation in useFrame | R3F v8+ | Eliminates 60fps React re-renders |
| React-only state | Zustand vanilla store for visual state | Zustand v4+ | Non-reactive state access pattern |
| stats.js | r3f-perf | 2022+ | R3F-specific performance metrics |

**Deprecated/outdated:**
- **stats.js**: Replaced by r3f-perf for R3F applications. r3f-perf provides GPU-specific metrics (draw calls, triangles, geometries) that stats.js doesn't track.
- **React DevTools for performance profiling**: Not suitable for 60fps updates. Use r3f-perf or React Profiler sparingly. The "Highlight updates when components render" feature will flood with updates if using store updates in useFrame.

## Open Questions

1. **Centralized Animation Loop Priority System**
   - What we know: Multiple useFrame hooks are acceptable and don't create render calls
   - What's unclear: Whether consolidating 77+ hooks provides measurable benefit vs. complexity cost
   - Recommendation: Profile with r3f-perf first to identify actual bottlenecks. Only consolidate if specific hooks show performance issues.

2. **Visual State Synchronization**
   - What we know: Visual state should update via vanilla store mutations in useFrame
   - What's unclear: How to handle edge cases where visual state diverges significantly from authoritative state (network lag, extrapolation)
   - Recommendation: Keep visual and authoritative state separate. Reconcile visual state to authoritative state on network updates, not every frame.

## Sources

### Primary (HIGH confidence)
- [React Three Fiber Performance Pitfalls - Official Documentation](https://r3f.docs.pmnd.rs/advanced/pitfalls) - Authoritative source for useFrame mutation patterns, setState avoidance
- [Zustand GitHub Repository](https://github.com/pmndrs/zustand) - Official documentation for vanilla store API (`createStore`)
- [r3f-perf GitHub Repository](https://github.com/utsuboco/r3f-perf) - Source of truth for r3f-perf usage and API

### Secondary (MEDIUM confidence)
- [R3F-Perf Tutorial - sbcode.net](https://sbcode.net/react-three-fiber/r3f-perf/) - Verified usage patterns and configuration options for r3f-perf
- [React Three Fiber useFrame performance Discussion - three.js Discourse](https://discourse.threejs.org/t/react-three-fiber-useframe-performance/79423) - Community confirmation that multiple useFrame hooks are safe
- [Best Practices for Non-Reactive State in Zustand - GitHub Discussion](https://github.com/pmndrs/zustand/discussions/2886) - Community discussion confirming vanilla store pattern for non-reactive state

### Tertiary (LOW confidence)
- [100 Three.js Best Practices (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips) - General Three.js optimization patterns, not R3F-specific
- [State Management in 2026: Redux, Context API, and Modern Patterns - Nucamp Blog](https://www.nucamp.co/blog/state-management-in-2026-redux-context-api-and-modern-patterns) - General state management trends, not game-specific

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified via official docs/repositories
- Architecture patterns: HIGH - Patterns from official R3F and Zustand documentation
- Pitfalls: HIGH - Documented in official R3F performance pitfalls guide
- Code examples: HIGH - Based on official documentation patterns

**Research date:** 2026-01-22
**Valid until:** 2026-02-22 (30 days - React Three Fiber and Zustand are stable, but verify r3f-perf API hasn't changed)

**Current project dependencies verified:**
- @react-three/fiber: ^8.17.10
- @react-three/drei: ^9.114.3
- three: ^0.169.0
- zustand: ^5.0.0
