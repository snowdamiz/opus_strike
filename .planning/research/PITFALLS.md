# Pitfalls Research

**Domain:** R3F Game Level Design with Rapier Physics (CTF Map)
**Researched:** 2026-01-22
**Confidence:** HIGH (verified against official Rapier docs and R3F sources)

## Critical Pitfalls

### Pitfall 1: Trimesh Colliders on Dynamic Objects

**What goes wrong:**
Using `trimesh` colliders for dynamic rigid bodies (players, moveable objects) causes objects to get stuck, clip through geometry, or exhibit erratic collision behavior. Trimeshes have no interior volume, making it easy for other objects to penetrate and become trapped.

**Why it happens:**
Developers assume that matching the visual mesh exactly with a physics collider is the "correct" approach. Rapier trimeshes are optimized for static geometry (terrain, buildings), not dynamic bodies.

**How to avoid:**
- Use primitive colliders (cuboid, capsule, ball) or compound shapes for all dynamic bodies
- For complex non-convex dynamic objects, use convex decomposition (multiple convex hull shapes combined)
- Reserve trimesh colliders exclusively for `type="fixed"` rigid bodies (map geometry)
- Your existing `PhysicsWorld.ts` correctly uses capsule colliders for players - maintain this pattern

**Warning signs:**
- Players or objects getting stuck inside walls
- Inconsistent collision behavior at certain angles
- Objects teleporting or jittering when colliding

**Phase to address:**
Map Geometry Phase - When defining collision meshes for level geometry. Establish collider type conventions before building out the map.

---

### Pitfall 2: Physics Mesh / Visual Mesh Mismatch

**What goes wrong:**
The collision mesh doesn't align with what players see visually. Players hit invisible walls, pass through visible geometry, or see gaps they can't traverse.

**Why it happens:**
- GLTF/GLB imports create colliders from transformed geometry without accounting for scale/rotation applied in the scene graph
- Simplified collision meshes drift from visual updates during iteration
- Parent-child transform chains aren't applied to physics bodies
- Three.js uses SI units (1 unit = 1 meter), but modeled assets may use different scales

**How to avoid:**
- Always enable `<Physics debug>` during development to visualize colliders
- Apply all transforms (position, rotation, scale) before generating collision geometry
- Use `mesh.geometry.computeBoundingBox()` after transforms to verify alignment
- For imported models, bake transforms in Blender before export (Ctrl+A > Apply All Transforms)
- Create a collision mesh validation pass: overlay debug wireframes on visual mesh
- Document expected scale (e.g., "player height = 1.8 units") as a reference constant

**Warning signs:**
- Debug colliders don't align with visible meshes
- Players report "invisible walls" or "passing through walls"
- Collision behaves differently after re-exporting model

**Phase to address:**
Map Geometry Phase - Establish transform conventions and debug visualization early. Add collision verification to map testing checklist.

---

### Pitfall 3: Collision Groups Misconfiguration (One-Way Matching)

**What goes wrong:**
Collision filtering silently fails. Objects that should collide don't, or collision events don't fire. Developers assume setting collision groups on one object is sufficient.

**Why it happens:**
Rapier requires **mutual matching** for collision to occur. If collider A allows collision with group 1, but collider B (in group 1) doesn't allow collision with A's group, no collision happens. This is different from some other physics engines.

**How to avoid:**
```typescript
import { interactionGroups } from "@react-three/rapier";

// WRONG: One-way collision won't work
<Player collisionGroups={interactionGroups(0, [1, 2])} />  // Player in 0, collides with 1,2
<Wall collisionGroups={interactionGroups(1)} />            // Wall in 1, collides with ALL

// RIGHT: Mutual collision groups
<Player collisionGroups={interactionGroups(0, [1, 2])} />  // Player in 0, collides with 1,2
<Wall collisionGroups={interactionGroups(1, [0, 1])} />    // Wall in 1, collides with 0,1
```

- Create a collision matrix document defining which groups interact
- Use consistent group numbers: 0=players, 1=map, 2=projectiles, 3=triggers, etc.
- Test collision groups in isolation before combining systems

**Warning signs:**
- Some collisions work, others silently fail
- Collision events fire inconsistently
- Works with `collisionGroups` commented out, breaks when enabled

**Phase to address:**
Player/Physics Setup Phase - Define collision group conventions before implementing map colliders.

---

### Pitfall 4: Ghost Collisions on Triangle Mesh Edges

**What goes wrong:**
Players sliding along floors or walls experience sudden velocity changes, get "caught" on invisible edges, or bounce unexpectedly. Especially noticeable when moving diagonally across tiled geometry.

**Why it happens:**
Internal edges where triangles meet create "ghost contacts" - the physics engine detects collision with the seam between triangles even though the surface is continuous. Long, thin triangles (common in procedural geometry) worsen numerical stability.

**How to avoid:**
- Enable `TrimeshFlags.FIX_INTERNAL_EDGES` when creating trimesh colliders:
```typescript
const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices)
  .setTriMeshFlags(RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
```
- Avoid long, thin triangles in floor/wall geometry (keep triangles roughly equilateral)
- Use heightfield colliders for terrain instead of trimesh where possible
- Consider compound box colliders for flat surfaces instead of triangulated meshes
- Test player movement at acute angles to surfaces during development

**Warning signs:**
- Player jerks or stutters when walking diagonally
- Inconsistent slide behavior on ramps
- Player gets stuck in flat areas with no visible obstacle

**Phase to address:**
Map Geometry Phase - Configure trimesh flags when setting up level collision. Test movement patterns early.

---

### Pitfall 5: Spawn Point Collision and Line-of-Sight Issues

**What goes wrong:**
Players spawn inside geometry (stuck in walls/floors), spawn visible to enemies (instant death on spawn), or spawn outside the playable area.

**Why it happens:**
- Spawn coordinates don't account for player collider dimensions
- Spawn points placed in editor don't verify physics world state
- Y-coordinate assumes flat ground but terrain varies
- No spawn protection or enemy proximity checks

**How to avoid:**
- Spawn point Y should be `groundHeight + (playerHeight / 2) + epsilon` (e.g., +0.1)
- Perform a shape cast downward from spawn point to find actual ground
- Check spawn point collision with physics bodies before spawning
- Implement spawn protection (invulnerability window or enemy distance check)
- For CTF: ensure spawn points have no direct line-of-sight to enemy base
- Validate spawn points are within map boundary polygon (use your existing `isInsideBoundary()`)

**Warning signs:**
- Players fall through floor on spawn
- Players spawn inside walls and die/get stuck
- Frequent "spawn kills" reported

**Phase to address:**
Spawn System Phase - After map geometry is complete, validate all spawn points against physics world. Add runtime spawn validation.

---

### Pitfall 6: Performance Death from Complex Collision Meshes

**What goes wrong:**
Frame rate drops significantly when multiple players are on the map, especially near detailed geometry. Physics step takes >16ms, causing visible lag.

**Why it happens:**
- Using visual mesh directly as collision mesh (thousands of triangles)
- Trimesh contact manifolds generate many contact points
- Each mesh is a draw call; physics calculations are per-triangle
- No LOD for collision meshes (all detail always active)

**How to avoid:**
- Create simplified collision meshes: 10-50 triangles vs 1000+ visual triangles
- Use compound primitive colliders (boxes, capsules) for buildings/structures
- Profile with `r3f-perf` or Spector.js to identify hotspots
- Set collision mesh budget: e.g., max 500 triangles for entire map collision
- Consider using separate collision-only meshes in Blender (non-rendered layer)
- For repeated geometry, use instanced colliders where possible

**Warning signs:**
- FPS drops in specific map areas
- Physics step time increases with player count
- Profiler shows high `world.step()` time

**Phase to address:**
Map Geometry Phase - Establish collision mesh complexity budget. Create simplified collision mesh workflow before detailed visual modeling.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Using visual mesh as collision mesh | Fast iteration, accurate collisions | Severe performance issues at scale | Prototyping only, replace before testing with 4+ players |
| Hardcoded spawn coordinates | Quick setup | Breaks when map geometry changes | Never in production; use data-driven spawn system |
| Skipping `debug` prop during development | Slightly faster renders | Hours debugging invisible collision issues | Never - always enable during development |
| Single collision group for everything | No collision filtering code | Can't implement projectile pass-through, triggers, etc. | Early prototype only |
| Synchronous physics on main thread | Simpler code | Frame drops during complex physics | Acceptable for <10 physics bodies |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| GLTF Import | Assuming colliders auto-generate correctly | Manually verify transforms, create simplified collision mesh |
| React-Three-Rapier | Wrapping entire scene in single `<RigidBody>` | Use separate `<RigidBody>` per logical object, compound colliders for complex shapes |
| Instanced Meshes | Expecting physics performance to match render performance | Physics is per-body CPU cost; instancing only helps GPU draw calls |
| Component Unmount | Assuming R3F auto-disposes physics bodies | Verify `world.removeRigidBody()` is called; check for memory leaks in long sessions |
| Heightfield Terrain | Using heightfield for complex multi-level geometry | Heightfields are single-surface; use trimesh for multi-floor structures |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Trimesh for dynamic bodies | Collision jitter, stuck objects | Use primitive/compound colliders | Immediately with complex meshes |
| No contact skin | Objects intersect visually before repelling | Set `contactSkin` to 0.01-0.05 | High-speed collisions |
| Many small colliders | Physics step time > 16ms | Merge adjacent colliders | ~100+ active colliders |
| Raycasting every frame per player | CPU spike, dropped frames | Cache raycast results, reduce frequency | 4+ players raycasting |
| No CCD for fast objects | Projectiles tunnel through walls | Enable `ccd: true` on fast rigid bodies | Projectile speed > 50 units/sec |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Client-authoritative collision | Cheaters pass through walls | Server validates all position changes |
| Spawn point prediction | Spawn camping exploits | Randomize spawn selection server-side |
| Exposed collision groups | Cheaters disable collision with projectiles | Collision filtering must be server-authoritative |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Invisible collision bounds | Players confused why they can't go somewhere | Add subtle visual indicators (barriers, fences) at boundaries |
| Precise pixel-perfect collision | Players feel clipped by geometry | Add small collision buffer (~0.1 units inside visual mesh) |
| Silent spawn failures | Players stuck, must restart | Detect spawn collision, find alternative spawn, notify player |
| No collision feedback | Players unsure if they hit something | Audio/visual feedback on collision events |

## "Looks Done But Isn't" Checklist

- [ ] **Map Collision:** Debug wireframes align with visual mesh at all positions - verify in corners and edges
- [ ] **Spawn Points:** All spawn points verified inside boundary polygon and not intersecting geometry
- [ ] **Player Movement:** Test diagonal movement across all floor surfaces - no ghost collisions
- [ ] **Flag Positions:** Flag bases have valid collision for pickup/capture detection
- [ ] **Boundary Walls:** Players cannot escape map via any angle of approach
- [ ] **Multiplayer Load:** Test with 8+ simultaneous players - physics step under 16ms
- [ ] **Component Cleanup:** Navigate away and back to game - memory usage stable

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Trimesh on dynamic bodies | LOW | Change collider type to primitive/compound; minimal code change |
| Mesh/collider mismatch | MEDIUM | Re-export with baked transforms; may need collision mesh rebuild |
| Collision group failures | MEDIUM | Audit all groups with collision matrix; systematic re-test |
| Ghost collisions | MEDIUM | Enable FIX_INTERNAL_EDGES flag; may need mesh topology cleanup |
| Performance issues | HIGH | Create simplified collision mesh from scratch; significant rework |
| Spawn point issues | LOW | Validate spawns against physics world; straightforward fix |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Trimesh on dynamic bodies | Map Geometry | Code review: no `trimesh` colliders on non-fixed bodies |
| Mesh/collider mismatch | Map Geometry | Visual: `<Physics debug>` aligns with rendered mesh |
| Collision group failures | Player/Physics Setup | Test matrix: all expected collision pairs fire events |
| Ghost collisions | Map Geometry | Playtest: smooth diagonal movement on all surfaces |
| Spawn point issues | Spawn System | Runtime: no spawn failures in 100 spawn cycles per point |
| Performance issues | Map Geometry | Profile: physics step < 8ms with 8 players |
| Multiplayer sync | Networking Phase | Test: deterministic replay produces identical results |

## Sources

- [Rapier Colliders Documentation](https://rapier.rs/docs/user_guides/javascript/colliders/) - Trimesh limitations, collider types
- [Rapier Advanced Collision Detection](https://rapier.rs/docs/user_guides/javascript/advanced_collision_detection_js/) - CCD, contact manifolds
- [Rapier Collision Groups](https://rapier.rs/docs/user_guides/javascript/collider_collision_groups/) - Bitmask filtering, mutual matching requirement
- [Rapier Determinism](https://rapier.rs/docs/user_guides/javascript/determinism/) - Cross-platform determinism for multiplayer
- [react-three-rapier GitHub](https://github.com/pmndrs/react-three-rapier) - Debug prop, interactionGroups helper, InstancedRigidBodies
- [R3F Performance Pitfalls](https://docs.pmnd.rs/react-three-fiber/advanced/pitfalls) - Memory leaks, disposal, key requirements
- [R3F Scaling Performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance) - Draw calls, instancing, on-demand rendering
- [Ghost Collision Feature Request (Rapier #669)](https://github.com/dimforge/rapier/issues/669) - Internal edge fix discussion
- [Three.js Forum: GLTF Collision](https://discourse.threejs.org/t/react-three-fiber-add-collision-to-imported-blender-gltf-object/41184) - Transform issues with imported models
- [Multiplayer Level Design Techniques](https://games.themindstudios.com/post/multiplayer-level-design-techniques/) - Spawn placement, flow design
- [Halo Spawn Points Guide (c20)](https://c20.reclaimers.net/h1/guides/multiplayer/player-spawns/) - Team spawn conventions for CTF

---
*Pitfalls research for: R3F CTF Map Level Design with Rapier Physics*
*Researched: 2026-01-22*
