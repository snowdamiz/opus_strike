# Stack Research: Level Design in React Three Fiber with Rapier

**Domain:** Game level/map design for R3F multiplayer hero shooter
**Researched:** 2026-01-22
**Confidence:** HIGH (verified via official docs, Context7, and current articles)

## Executive Summary

Building CTF maps in React Three Fiber follows a **hybrid approach**: use Blender for visual geometry exported as compressed GLB, then define collision separately using simplified Rapier shapes. The key insight from 2025 best practices is that **visual geometry and collision geometry should be decoupled** — trimesh colliders work but are expensive; prefer primitive collider composition for performance.

## Recommended Stack

### Core Technologies (Already in Project)

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| @react-three/fiber | 8.17 | React renderer for Three.js | Already installed |
| @react-three/drei | 9.114 | Helpers and abstractions | Already installed |
| three | 0.169 | 3D engine | Already installed |
| @dimforge/rapier3d-compat | 0.14 | Physics engine (WASM) | Already installed |

### Level Design Libraries

| Library | Version | Purpose | Why Recommended |
|---------|---------|---------|-----------------|
| @react-three/csg | ^3.2.0 | Constructive solid geometry | Build complex shapes from primitives declaratively. Use for doors, windows, carved-out areas. Outputs standard BufferGeometry compatible with Rapier. |
| gltfjsx | ^6.5.0 (CLI) | GLTF to JSX conversion | Converts Blender exports to typed React components. Enables Draco compression, texture optimization, and targeted mesh manipulation. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @react-three/rapier | ^1.4.0 | React wrapper for Rapier | Use instead of raw @dimforge/rapier3d-compat. Provides `<RigidBody>`, `<Physics>`, automatic collider generation. Already using Rapier directly, but wrapper simplifies level geometry handling. |
| three-bvh-csg | ^0.0.16 | Fast CSG operations (underlying lib) | Already bundled with @react-three/csg. Used for boolean operations on geometry. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| gltfjsx CLI | Model pipeline | `npx gltfjsx map.glb --transform --draco --types` for compressed, typed components |
| r3f-perf | Performance monitoring | Already installed (7.2.3). Use to verify draw calls stay under 1000. |
| Blender 4.x | Map authoring | Export to GLB with these settings: Apply Modifiers, Include Normals, Draco compression |

## Level Design Approach

### Recommended: Blender GLB + Simplified Colliders

**WHY:** The project already uses this pattern (`VoxelWorld.tsx` loads `Inferno_World_free.glb`). Extend it by adding proper Rapier integration instead of the current polygon-based boundary system.

```
Visual Layer (GLB)          Collision Layer (Rapier)
├── Building meshes    →    CuboidColliders (boxes)
├── Terrain mesh       →    HeightfieldCollider or trimesh (static only)
├── Props/details      →    No colliders (pass-through)
└── Spawn areas        →    Named empty groups for spawn points
```

### Collision Mesh Strategy

| Geometry Type | Collider Choice | Rationale |
|---------------|-----------------|-----------|
| Floors/Walls | `CuboidCollider` | Fast. Define manually with position/size matching visual. |
| Ramps/Slopes | `CuboidCollider` rotated | Cheaper than trimesh. Slight inaccuracy acceptable. |
| Terrain | `HeightfieldCollider` | Most memory-efficient for large areas. |
| Complex static (buildings) | `colliders="trimesh"` on `<RigidBody type="fixed">` | Acceptable for fixed geometry only. Never use on dynamic bodies. |
| CTF flag zones | `CuboidCollider` sensor | Use `sensor={true}` for trigger volumes. |

### CSG for Procedural Elements

Use `@react-three/csg` when you need:
- Windows carved into walls
- Door frames
- Arches and tunnels
- Any boolean operation (subtract, union, intersect)

```tsx
import { Geometry, Base, Subtraction } from '@react-three/csg'

function WallWithWindow() {
  return (
    <mesh>
      <Geometry>
        <Base geometry={wallGeometry} />
        <Subtraction geometry={windowGeometry} position={[0, 2, 0]} />
      </Geometry>
      <meshStandardMaterial />
    </mesh>
  )
}
```

**CRITICAL:** CSG geometry can be fed directly to Rapier. Access via ref:
```tsx
const geoRef = useRef()
// geoRef.current is THREE.BufferGeometry → use with trimesh collider
```

## Performance Considerations for Multiplayer

### Draw Call Budget

| Context | Max Draw Calls | Strategy |
|---------|---------------|----------|
| Full map render | <500 | Merge static geometry, instance repeated props |
| During combat | <300 | Use LOD (Drei's `<Detailed />`) for distant objects |
| Many players visible | <200 for map | Reserve headroom for player models/effects |

### Instancing for Repeated Elements

The project already uses `@react-three/drei` Instances (verified in codebase for rockets). Apply same pattern to map props:

```tsx
import { Instances, Instance } from '@react-three/drei'

// Crates, barrels, cover objects - one draw call for all
<Instances limit={100}>
  <boxGeometry args={[1, 1, 1]} />
  <meshStandardMaterial color="brown" />
  {cratePositions.map((pos, i) => (
    <Instance key={i} position={pos} />
  ))}
</Instances>
```

**Limitation:** Drei's declarative Instances have CPU overhead. For 1000+ static props, use raw `THREE.InstancedMesh` instead.

### Physics Optimization

| Setting | Recommendation | Why |
|---------|---------------|-----|
| `colliders="cuboid"` default | Set on `<Physics>` component | Prevents accidental trimesh generation |
| Simple shapes for dynamics | Always cuboid/ball for players | Trimesh on dynamic bodies causes tunneling |
| Fixed bodies for map | `type="fixed"` on all map RigidBodies | Rapier skips simulation for fixed bodies |
| Collision groups | Use `collisionGroups` for layers | Separate player-map from projectile-map checks |

## Installation

```bash
# New dependencies for level design
pnpm add @react-three/csg @react-three/rapier

# Dev tools (CLI)
pnpm add -D gltfjsx
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Blender GLB | Procedural geometry only | Prototype/testing. Not for final maps. |
| @react-three/csg | three-csg-ts | If you need vanilla Three.js without React wrappers |
| @react-three/rapier | Raw Rapier API | Already using raw API. Wrapper recommended for level geometry ease. |
| Drei Instances | THREE.InstancedMesh | 1000+ static objects with no interactivity |
| Trimesh colliders | Convex decomposition | If trimesh causes physics issues. More complex setup. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `colliders="trimesh"` on dynamic bodies | Objects get stuck inside. No interior. | Convex hull or primitive composition |
| Auto colliders for entire map | Performance nightmare. Every mesh gets collider. | `colliders={false}` on `<Physics>`, add manually |
| Polygon boundary checks | Current approach in `mapBoundaries.ts`. Works but doesn't integrate with Rapier. | Replace with `RigidBody type="fixed"` wall colliders |
| HeightfieldCollider for buildings | Only works for terrain-like topology | CuboidCollider or trimesh for vertical structures |

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| @react-three/rapier@1.4 | @react-three/fiber@8.x, React 18 | V2 adds React 19 + R3F v9 support |
| @react-three/csg@3.x | three@0.160+ | Uses three-bvh-csg internally |
| gltfjsx@6.5 | three@0.169 | --transform flag requires glTF-Transform |

## Workflow: Building a New Map

1. **Blender**: Model visual geometry, organize in collections (Walls, Props, Spawns)
2. **Export**: GLB with Draco compression, embedded textures
3. **Convert**: `npx gltfjsx map.glb --transform --draco --types`
4. **Collision**: Define simplified colliders in React component:

```tsx
function CTFMap() {
  const { scene } = useGLTF('/maps/ctf_arena.glb')

  return (
    <Physics colliders={false}>
      {/* Visual geometry */}
      <primitive object={scene} />

      {/* Simplified collision layer */}
      <RigidBody type="fixed">
        {/* Floor */}
        <CuboidCollider args={[50, 0.5, 50]} position={[0, -0.5, 0]} />

        {/* Walls - manually placed to match visual */}
        <CuboidCollider args={[50, 10, 1]} position={[0, 5, -50]} />
        <CuboidCollider args={[50, 10, 1]} position={[0, 5, 50]} />

        {/* Complex area - use trimesh only where needed */}
        <mesh geometry={buildingGeometry}>
          <RigidBody type="fixed" colliders="trimesh" />
        </mesh>
      </RigidBody>

      {/* Flag capture zones (sensors) */}
      <RigidBody type="fixed" sensor>
        <CuboidCollider args={[2, 2, 2]} position={[20, 1, 0]} />
      </RigidBody>
    </Physics>
  )
}
```

## Sources

- [@react-three/rapier GitHub](https://github.com/pmndrs/react-three-rapier) - Automatic collider generation, RigidBody API (HIGH confidence)
- [Rapier Colliders Docs](https://rapier.rs/docs/user_guides/javascript/colliders/) - Collider types, trimesh vs hull guidance (HIGH confidence)
- [@react-three/csg GitHub](https://github.com/pmndrs/react-three-csg) - CSG operations for procedural geometry (HIGH confidence)
- [Drei Instances Docs](https://drei.docs.pmnd.rs/performances/instances) - Instancing API and createInstances (HIGH confidence)
- [R3F Scaling Performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance) - Draw call budget, instancing strategy (HIGH confidence)
- [Codrops Three.js Performance 2025](https://tympanus.net/codrops/2025/02/11/building-efficient-three-js-scenes-optimize-performance-while-maintaining-quality/) - Physics optimization, simple collider shapes (MEDIUM confidence)
- [Codrops Blender to Three.js 2025](https://tympanus.net/codrops/2025/04/08/3d-world-in-the-browser-with-blender-and-three-js/) - Map workflow, texture baking, optimization (MEDIUM confidence)

---
*Stack research for: CTF map level design in React Three Fiber with Rapier physics*
*Researched: 2026-01-22*
