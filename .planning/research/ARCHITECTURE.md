# Architecture Research

**Domain:** React Three Fiber Performance Optimization for Real-Time Multiplayer Games
**Researched:** 2026-01-22
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
+-----------------------------------------------------------------------------+
|                         PRESENTATION LAYER (React)                          |
+-----------------------------------------------------------------------------+
|  +-------------+  +-------------+  +-------------+  +-------------+         |
|  |   UI Layer  |  | 3D Canvas   |  |  HUD/Overlay|  |    Effects  |         |
|  | (HTML/CSS)  |  |   (R3F)     |  |  Components |  |  Components |         |
|  +------+------+  +------+------+  +------+------+  +------+------+         |
|         |                    |                    |              |           |
+---------+--------------------+--------------------+--------------+-----------+
|                          VISUAL STATE LAYER                             |
|  +-------------+  +-------------+  +-------------+  +-------------+         |
|  |Visual Store |  |   Effect    |  |  Animation  |  |  Particle   |         |
|  | (High-freq) |  |  Managers   |  |    Loop     |  |    Pool     |         |
|  +------+------+  +------+------+  +------+------+  +------+------+         |
|         |                    |                    |              |           |
+---------+--------------------+--------------------+--------------+-----------+
|                          GAME STATE LAYER                              |
|  +-------------+  +-------------+  +-------------+  +-------------+         |
|  | Game Store  |  | Projectile  |  |   Player    |  |    Ability  |         |
|  |  (Zustand)  |  |   Slice     |  |    Slice    |  |   Systems  |         |
|  +------+------+  +------+------+  +------+------+  +------+------+         |
|         |                                                               |
+---------+---------------------------------------------------------------+
|                          NETWORK LAYER                                  |
|  +-------------+  +-------------+                                       |
|  |   Colyseus  |  |  WebSocket  |                                       |
|  |   Client    |  |   Messages  |                                       |
|  +------+------+  +------+------+                                       |
+-----------------------------------------------------------------------------+
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **UI Components** | HUD, menus, overlays that display game state | React components, subscribe to low-frequency state |
| **Canvas Layer** | Container for 3D scene, handles render loop | `<Canvas>` from @react-three/fiber |
| **Effect Managers** | Coordinate high-frequency visual updates | Custom components with centralized `useFrame` |
| **Visual Store** | Separate store for 60fps+ visual data | Zustand slice or `useRef`-based state |
| **Game Store** | Authoritative game state (player data, scores) | Zustand with selective subscriptions |
| **Network Layer** | WebSocket communication, message parsing | Colyseus client, message handlers |
| **Particle Pool** | Reusable effect objects (rockets, explosions) | Object pool pattern with pre-allocated resources |

## Recommended Project Structure

```
apps/client/src/
├── components/
│   ├── game/                      # 3D rendering components
│   │   ├── core/                  # NEW: Centralized rendering systems
│   │   │   ├── AnimationLoop.tsx  # Single useFrame entry point
│   │   │   ├── VisualStateManager.tsx # High-freq visual state
│   │   │   └── EffectObjectPool.tsx # Object pooling for effects
│   │   ├── players/               # Player rendering components
│   │   ├── effects/               # Ability effect components
│   │   │   ├── blaze/             # Blaze-specific effects
│   │   │   ├── hookshot/          # Hookshot-specific effects
│   │   │   └── shared/            # Shared effect utilities
│   │   └── GameCanvas.tsx         # Main canvas container
│   ├── ui/                        # 2D UI components
│   └── shared/                    # Shared UI/game components
├── store/
│   ├── gameStore.ts               # Game state (low-freq updates)
│   ├── visualStore.ts             # NEW: Visual state (high-freq updates)
│   └── slices/
│       ├── projectiles.ts         # Projectile data
│       └── ...
├── hooks/
│   ├── useVisualState.ts          # NEW: Hook for accessing visual state
│   └── ...
├── systems/                       # NEW: Game systems for decoupled logic
│   ├── projectileSystem.ts        # Projectile movement/collision
│   ├── effectSystem.ts            # Effect lifecycle management
│   └── animationSystem.ts         # Centralized animation updates
└── utils/
    └── objectPool.ts              # Generic object pool implementation
```

### Structure Rationale

- **core/**: Centralizes animation loop to reduce useFrame explosion from 80+ hooks to single loop
- **visualStore.ts**: Separates 60fps visual updates from game state, preventing cascading re-renders
- **systems/**: Decouples game logic from React components, enables entity-component patterns
- **objectPool.ts**: Reuses expensive objects (rockets, particles) instead of creating/destroying

## Architectural Patterns

### Pattern 1: Visual State Separation

**What:** Separate high-frequency visual data (positions, animation states) from authoritative game state (health, scores)

**When to use:** When rendering 60fps animations with React state management causing re-renders

**Trade-offs:**
- **Pros:** Eliminates cascading re-renders, keeps game state pure
- **Cons:** Requires synchronization between visual and game state

**Example:**
```typescript
// visualStore.ts - High-frequency visual data, no React re-renders
interface VisualState {
  projectiles: Map<string, VisualProjectile>;
  effects: Map<string, VisualEffect>;
  playerVisuals: Map<string, PlayerVisual>;
}

// Update visual state via direct mutation in useFrame
useFrame(() => {
  const visuals = useVisualStore.getState();
  visuals.projectiles.forEach(proj => {
    proj.position.addScaledVector(proj.velocity, delta);
    // Direct mutation - no React re-render
  });
});

// Subscribe only to game state for UI components
const score = useGameStore(state => state.blueScore);
```

**Sources:**
- [Performance pitfalls - React Three Fiber](https://r3f.docs.pmnd.rs/advanced/pitfalls) - "Do not bind to fast state reactively"
- [How to use state management with R3F without performance issues](https://discourse.threejs.org/t/how-to-use-state-management-with-react-three-fiber-without-performance-issues/61223)

### Pattern 2: Centralized Animation Loop

**What:** Consolidate all `useFrame` hooks into a single animation coordinator that manages updates

**When to use:** When 80+ separate `useFrame` hooks cause scheduler overhead

**Trade-offs:**
- **Pros:** Reduces scheduler overhead, easier to coordinate animations, can batch updates
- **Cons:** More complex coordination, potential for single point of failure

**Example:**
```typescript
// AnimationLoop.tsx - Single useFrame entry point
interface AnimationSystem {
  id: string;
  priority: number; // Higher = earlier in frame
  update: (delta: number, time: number) => void;
}

export function AnimationLoop() {
  const systemsRef = useRef<AnimationSystem[]>([]);

  const registerSystem = useCallback((system: AnimationSystem) => {
    systemsRef.current.push(system);
    return () => {
      systemsRef.current = systemsRef.current.filter(s => s.id !== system.id);
    };
  }, []);

  // Provide registration context
  return (
    <AnimationLoopContext.Provider value={{ registerSystem }}>
      <LoopRunner systems={systemsRef} />
      {children}
    </AnimationLoopContext.Provider>
  );
}

function LoopRunner({ systems }: { systems: RefObject<AnimationSystem[]> }) {
  useFrame((state, delta) => {
    // Sort by priority and execute in order
    const sorted = [...systems.current].sort((a, b) => b.priority - a.priority);
    sorted.forEach(sys => sys.update(delta, state.clock.elapsedTime));
  });
  return null;
}

// Usage in effect components
function RocketEffect() {
  const { registerSystem } = useAnimationLoop();
  const rocketData = useRef<RocketData>();

  useEffect(() => {
    return registerSystem({
      id: `rocket-${rocketData.current.id}`,
      priority: 10,
      update: (delta) => {
        // Update rocket position
      },
    });
  }, []);
}
```

**Sources:**
- [Scaling performance - React Three Fiber](https://r3f.docs.pmnd.rs/advanced/scaling-performance) - "Threejs has a render-loop, it does not work like the DOM does"
- [Performance pitfalls - React Three Fiber](https://r3f.docs.pmnd.rs/advanced/pitfalls) - "Fast updates are carried out in useFrame by mutation"

### Pattern 3: Object Pooling

**What:** Pre-allocate a fixed pool of reusable objects instead of creating/destroying

**When to use:** For frequently created/destroyed objects (projectiles, particles, explosions)

**Trade-offs:**
- **Pros:** Eliminates GC pressure, predictable memory usage, faster allocations
- **Cons:** Fixed pool size, more complex lifecycle management

**Example:**
```typescript
// objectPool.ts - Generic object pool
export class ObjectPool<T> {
  private available: T[] = [];
  private active: Set<T> = new Set();

  constructor(
    private factory: () => T,
    private reset: (obj: T) => void,
    initialSize: number
  ) {
    for (let i = 0; i < initialSize; i++) {
      this.available.push(factory());
    }
  }

  acquire(): T {
    const obj = this.available.pop() ?? this.factory();
    this.active.add(obj);
    return obj;
  }

  release(obj: T): void {
    if (this.active.delete(obj)) {
      this.reset(obj);
      this.available.push(obj);
    }
  }

  updateAll(updateFn: (obj: T) => void): void {
    this.active.forEach(updateFn);
  }
}

// Usage for rockets
const rocketPool = new ObjectPool(
  () => ({ position: new THREE.Vector3(), velocity: new THREE.Vector3() }),
  (rocket) => rocket.position.set(0, 0, 0),
  50 // Pre-allocate 50 rockets
);

// In animation loop
useFrame(() => {
  rocketPool.updateAll((rocket) => {
    rocket.position.addScaledVector(rocket.velocity, delta);
  });
});
```

**Sources:**
- [100 Three.js Best Practices (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips) - "Use object pooling for spawned entities"
- [Introduction to Object Pooling in Three.js](https://kingdavvid.hashnode.dev/introduction-to-object-pooling-in-threejs)

### Pattern 4: Selective Subscription

**What:** Subscribe to minimal slices of state to prevent unnecessary re-renders

**When to use:** When store updates trigger component re-renders for unrelated data

**Trade-offs:**
- **Pros:** Each component only re-renders when its specific data changes
- **Cons:** More boilerplate, need to carefully manage subscriptions

**Example:**
```typescript
// BAD: Subscribes to entire store, re-renders on any change
const RocketsManager() {
  const { rockets, bombs, jetpackActive } = useGameStore();
  // Re-renders when bombs change, even though we only render rockets
}

// GOOD: Subscribe only to what's needed
const RocketsManager() {
  const rockets = useGameStore(state => state.rockets);
  // Only re-renders when rockets array changes
}

// BETTER: Use shallow comparison for arrays
import { shallow } from 'zustand/shallow';

const RocketsManager() {
  const { rockets, addRocket } = useGameStore(
    state => ({ rockets: state.rockets, addRocket: state.addRocket }),
    shallow
  );
  // Only re-renders when rockets reference changes, not on individual rocket updates
}
```

**Sources:**
- [Optimizing Zustand - Preventing Unnecessary Re-renders](https://dev.to/eraywebdev/optimizing-zustand-how-to-prevent-unnecessary-re-renders-in-your-react-app-59do)
- [How to Stop Unnecessary Re-Renders with Zustand](https://www.linkedin.com/posts/osimfavour_most-people-struggle-to-fix-react-performance-activity-7367202121374490624-u5mH)

### Pattern 5: Direct Mutation in useFrame

**What:** Update Three.js object properties directly in useFrame, not via React state

**When to use:** For 60fps animations, position updates, visual effects

**Trade-offs:**
- **Pros:** Bypasses React scheduler, frame-rate independent, no re-renders
- **Cons:** Mutation can be confusing, component must "own" the mutated objects

**Example:**
```typescript
// BAD: setState in useFrame causes re-renders
const [position, setPosition] = useState([0, 0, 0]);
useFrame(() => {
  setPosition(p => [p[0] + 0.1, p[1], p[2]]);
});
return <mesh position={position} />

// GOOD: Direct mutation, no re-render
const meshRef = useRef<THREE.Mesh>();
const direction = useRef(new THREE.Vector3(1, 0, 0));

useFrame((_, delta) => {
  if (meshRef.current) {
    meshRef.current.position.addScaledVector(direction.current, delta);
  }
});
return <mesh ref={meshRef} />

// EXCELLENT: Reuse Vector3 objects to avoid GC
const _tempVec = new THREE.Vector3();
useFrame((_, delta) => {
  if (meshRef.current) {
    _tempVec.copy(direction.current).multiplyScalar(delta);
    meshRef.current.position.add(_tempVec);
  }
});
```

**Sources:**
- [Performance pitfalls - React Three Fiber](https://r3f.docs.pmnd.rs/advanced/pitfalls) - "Avoid setState in loops"

## Data Flow

### Current Flow (Problematic)

```
Server Update (20 tick)
    |
    v
Colyseus Message
    |
    v
Zustand GameStore.set() <-- TRIGGERS ALL SUBSCRIBERS
    |
    +---> BlazeEffectsManager (re-render)
    +---> HookshotEffectsManager (re-render)
    +---> GlacierEffectsManager (re-render)
    +---> UI Components (re-render)
    +---> Other effect components (re-render)
    |
    v
React Reconciliation (cascading)
    |
    v
Three.js renders (may drop frames if reconciliation takes too long)
```

### Recommended Flow (Optimized)

```
Server Update (20 tick)
    |
    v
Colyseus Message
    |
    +-----------------------+
    |                       |
    v                       v
GameStore (low-freq)   VisualStore (high-freq)
    |                       |
    |                       +---> Direct mutations in useFrame
    |                       |    (no React re-renders)
    |                       |
    v                       v
UI Components          Three.js objects
(React re-render)     (direct updates)
    |                       |
    +----------+------------+
               |
               v
        Three.js renders (smooth, no reconciliation stalls)
```

### Key Data Flows

1. **Game State (low-frequency, < 20Hz):** Server -> GameStore -> UI Components
2. **Visual Data (high-frequency, 60Hz):** VisualStore mutations -> Three.js objects (direct)
3. **Player Input:** Event -> Client prediction -> VisualStore -> Server
4. **Effect Lifecycle:** Effect spawned -> ObjectPool acquire -> Animation update -> ObjectPool release

### State Management

```
+------------------+                    +------------------+
|   GameStore      |                    |   VisualStore    |
|  (Zustand)       |                    |  (Zustand/Refs)  |
+------------------+                    +------------------+
| Players          |                    | Projectiles      |
| Health           |                    | Particle effects |
| Scores           |                    | Animation states |
| Flags            |                    | Interpolated pos |
| Cooldowns        |                    |                  |
+------------------+                    +------------------+
         ^                                        ^
         | (subscribe)                            | (direct access)
         |                                        |
+---------+----------+                  +---------+----------+
| UI Components      |                  | Effect Components  |
| (React)            |                  | (useFrame)         |
+---------------------+                  +--------------------+
```

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-10 players | Monolithic visual store, basic object pooling |
| 10-50 players | InstancedMesh for projectiles, LOD for distant effects |
| 50+ players | Spatial partitioning, culling, worker threads for physics |

### Scaling Priorities

1. **First bottleneck:** React reconciliation overhead during projectile spam
   - **Fix:** Visual state separation + selective subscription

2. **Second bottleneck:** GC pressure from creating/destroying effect objects
   - **Fix:** Object pooling for projectiles, particles, explosions

3. **Third bottleneck:** 80+ useFrame scheduler overhead
   - **Fix:** Centralized animation loop with priority system

## Anti-Patterns

### Anti-Pattern 1: setState in useFrame

**What people do:**
```typescript
useFrame(() => {
  setPosition(p => [p[0] + 0.1, p[1], p[2]]); // Triggers re-render every frame!
});
```

**Why it's wrong:** Forces React reconciliation 60 times per second, completely defeating React Three Fiber's design

**Do this instead:**
```typescript
const ref = useRef();
useFrame((_, delta) => {
  ref.current.position.x += delta; // Direct mutation, no re-render
});
```

### Anti-Pattern 2: Subscribing to Entire Store Slices

**What people do:**
```typescript
const EffectManager() {
  const store = useGameStore(); // Re-renders on ANY store change
  // ...
}
```

**Why it's wrong:** Every projectile add/remove triggers all effect managers to re-render

**Do this instead:**
```typescript
const EffectManager() {
  const rockets = useGameStore(s => s.rockets); // Only rockets
  // Or use shallow comparison
}
```

### Anti-Pattern 3: Creating Objects in Render Loop

**What people do:**
```typescript
useFrame(() => {
  mesh.position.lerp(new THREE.Vector3(x, y, z), 0.1); // New Vector3 every frame!
});
```

**Why it's wrong:** Allocates 60 objects per second, triggers GC pauses

**Do this instead:**
```typescript
const _temp = new THREE.Vector3(); // Reuse
useFrame(() => {
  _temp.set(x, y, z);
  mesh.position.lerp(_temp, 0.1);
});
```

### Anti-Pattern 4: Indiscriminate Mounting/Unmounting

**What people do:**
```typescript
{shouldShow && <ExpensiveEffect />} // Mount/unmount frequently
```

**Why it's wrong:** Materials/geometries get re-initialized on each mount

**Do this instead:**
```typescript
<ExpensiveEffect visible={shouldShow} /> // Just hide, don't unmount
```

### Anti-Pattern 5: Reactive Binding to Fast State

**What people do:**
```typescript
const position = useSelector(state => state.playerPosition); // 60fps updates
return <mesh position={position} />
```

**Why it's wrong:** React has to reconcile on every position change

**Do this instead:**
```typescript
const ref = useRef();
useFrame(() => {
  ref.current.position.copy(api.getState().playerPosition);
});
```

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Colyseus Server | WebSocket via `@colyseus/schema` | Keep game state sync separate from visual updates |
| Three.js | Direct manipulation via refs | Prefer useFrame mutations over React state for animations |
| Zustand | Slices with selective subscription | Use shallow comparison for arrays |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| GameStore -> VisualStore | Copy on sync, mutate in useFrame | Visual state is derived, not source of truth |
| Effect Components -> AnimationLoop | Registration via context | Components register callbacks, don't own useFrame |
| ProjectileSystem -> ObjectPool | acquire/release pattern | System doesn't know about pool implementation |

## Build Order Implications

### Phase 1: Visual State Separation (Foundation)
**Prerequisites:** None
**Effort:** Medium
**Impact:** HIGH

1. Create `visualStore.ts` separate from `gameStore.ts`
2. Move high-frequency data (projectile positions, effect states) to visual store
3. Update effect components to mutate visual state in useFrame

**Why first:** This is the foundation. Without separating visual from game state, other optimizations have limited impact.

### Phase 2: Selective Subscriptions (Quick Win)
**Prerequisites:** Phase 1
**Effort:** Low
**Impact:** MEDIUM

1. Audit all store subscriptions for broad selectors
2. Convert to narrow selectors with shallow comparison
3. Add React.memo to effect components

**Why second:** Easy win with low risk, reduces immediate re-render cascade.

### Phase 3: Centralized Animation Loop (Medium Effort)
**Prerequisites:** Phase 1
**Effort:** Medium
**Impact:** MEDIUM

1. Create `AnimationLoop.tsx` coordinator
2. Create registration context
3. Migrate effect components to register systems instead of individual useFrame

**Why third:** Reduces scheduler overhead but requires careful coordination.

### Phase 4: Object Pooling (Optimization)
**Prerequisites:** Phase 1
**Effort:** High
**Impact:** MEDIUM

1. Create generic `ObjectPool` utility
2. Pre-allocate pools for rockets, projectiles, particles
3. Update effect components to acquire/release from pool

**Why fourth:** GC pressure is secondary to re-render overhead. Pooling adds complexity.

### Phase 5: Instancing (Advanced)
**Prerequisites:** Phase 1, Phase 4
**Effort:** High
**Impact:** LOW-MEDIUM

1. Convert projectile rendering to InstancedMesh
2. Update animation loop to set instance matrices
3. Maintain fallback for small counts

**Why last:** Instancing adds significant complexity and R3F has reported issues. Only after other optimizations are exhausted.

## Sources

- [Scaling performance - React Three Fiber](https://r3f.docs.pmnd.rs/advanced/scaling-performance) - Official R3F performance documentation (HIGH confidence)
- [Performance pitfalls - React Three Fiber](https://r3f.docs.pmnd.rs/advanced/pitfalls) - Official R3F anti-patterns guide (HIGH confidence)
- [How to use state management with R3F without performance issues](https://discourse.threejs.org/t/how-to-use-state-management-with-react-three-fiber-without-performance-issues/61223) - Three.js community discussion (MEDIUM confidence)
- [Zustand causing more re-renders than expected](https://github.com/pmndrs/zustand/discussions/2642) - GitHub discussion (MEDIUM confidence)
- [Optimizing Zustand - Preventing Unnecessary Re-renders](https://dev.to/eraywebdev/optimizing-zustand-how-to-prevent-unnecessary-re-renders-in-your-react-app-59do) - Zustand optimization guide (MEDIUM confidence)
- [Simplifying React Three Fiber with Entity Component System](https://douges.dev/blog/simplifying-r3f-with-ecs) - ECS pattern for R3F (MEDIUM confidence)
- [100 Three.js Best Practices (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips) - Three.js best practices including object pooling (LOW confidence - future dated)
- [Introduction to Object Pooling in Three.js](https://kingdavvid.hashnode.dev/introduction-to-object-pooling-in-threejs) - Object pooling tutorial (LOW confidence - older)

---
*Architecture research for React Three Fiber Performance Optimization*
*Researched: 2026-01-22*
