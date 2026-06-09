# Project Research Summary

**Project:** Opus Strike - CTF Map Level Design
**Domain:** Competitive FPS Hero Shooter (React Three Fiber + Rapier Physics)
**Researched:** 2026-01-22
**Confidence:** HIGH

## Executive Summary

Building a competitive CTF map for this R3F hero shooter requires a hybrid approach: use Blender for visual geometry exported as compressed GLB, then define collision separately using simplified Rapier colliders. The critical insight from 2025 best practices is that visual and collision geometry must be decoupled - trimesh colliders work but are expensive, primitive collider composition performs better.

From a gameplay perspective, competitive CTF maps follow well-established patterns: 3-4 attack routes, balanced travel times, 2-3 height tiers for vertical mobility, and multiple flag zone entrances to prevent stalemates. The hero roster (Phantom, Hookshot, Blaze) introduces mobility complexity that must be handled carefully - every vertical route needs a ground-level alternative so the map stays readable and fair.

The main risks are performance degradation from complex collision meshes and gameplay imbalance from poor spawn/route design. Mitigation: establish collision mesh complexity budgets early, use debug visualization throughout development, and test movement patterns with actual hero abilities before finalizing geometry.

## Key Findings

### Recommended Stack

The project already has the core foundation (R3F 8.17, Drei 9.114, Three 0.169, Rapier 0.14). Two additions will significantly improve level design workflow:

**Core technologies:**
- **@react-three/csg (^3.2.0)**: Constructive solid geometry for doors, windows, carved-out areas - outputs BufferGeometry compatible with Rapier
- **@react-three/rapier (^1.4.0)**: React wrapper for Rapier providing `<RigidBody>`, `<Physics>`, automatic collider generation - project currently uses raw Rapier API but wrapper simplifies level geometry handling
- **gltfjsx (^6.5.0 CLI)**: Converts Blender GLB exports to typed React components with Draco compression and texture optimization

**Development approach:** Blender for authoring, GLB with Draco compression, gltfjsx conversion to typed JSX components, then manually define simplified collision geometry that matches visual mesh positioning but uses far fewer triangles.

### Expected Features

**Must have (table stakes):**
- Symmetrical or balanced travel times - both teams need equal opportunity (users expect this)
- 3-4 distinct attack routes - prevents "guess maps" (too many) and chokepoint stalemates (too few)
- Clear flag zone visibility with 2+ entrances - prevents impasse scenarios
- Spawn protection positioning - prevents spawn camping
- Multiple height levels (2-3 tiers) - essential for hero shooters with vertical mobility
- Mixed sightline lengths - supports different weapon ranges and playstyles

**Should have (competitive):**
- Hero-specific mobility routes - rewards mastery (wall-run paths for Hookshot, teleport spots for Phantom, jetpack ledges for Blaze)
- Dynamic defense positions - multiple valid setups create strategic depth
- Risk/reward flanking routes - exposed shortcuts for skilled players
- Ambush architecture - enables "interception" plays on flag carriers

**Defer (v2+):**
- Neutral mid-control objective - adds complexity, defer until basic CTF works
- Sound design landmarks - audio pass after visual/spatial design finalized
- Environmental storytelling polish - after gameplay is solid

### Architecture Approach

Maps should be self-contained R3F components following a separation-of-concerns pattern: visual geometry renders high-detail meshes, collision layer uses simplified Rapier colliders, and configuration files define spawn points, base positions, and boundaries. This decouples map structure from game logic.

**Major components:**
1. **MapGeometry** - Visual meshes from GLB/JSX, no physics responsibility
2. **MapColliders** - Simplified physics geometry (cuboids, capsules, trimesh for static only) registered with Rapier
3. **MapConfig** - Data-driven spawn points, flag positions, boundary polygon exported for SpawnManager/FlagManager consumption
4. **VoxelWorld** - Map loader/switcher that initializes physics and passes config to game systems

**Build order:** Config first (spawns, bases, boundaries) → Collision meshes (simplified physics) → Visual geometry (detailed render) → Map component assembly → Integration with game managers. Config and collision can be done in parallel with visual work.

### Critical Pitfalls

1. **Trimesh on dynamic bodies** - Causes objects to get stuck, clip through geometry, exhibit erratic collision. Players already use capsule colliders (correct). Reserve trimesh exclusively for `type="fixed"` map geometry.

2. **Visual/collision mesh mismatch** - Players hit invisible walls or pass through visible geometry. Always enable `<Physics debug>` during development. Apply transforms in Blender before export (bake with Ctrl+A). Document expected scale (player height = 1.8 units).

3. **Collision groups misconfiguration** - Rapier requires mutual matching for collision. If player group allows collision with walls, wall group must also allow collision with players. Create collision matrix documenting groups: 0=players, 1=map, 2=projectiles, 3=triggers.

4. **Ghost collisions on trimesh edges** - Players sliding along floors catch on invisible seams. Enable `TriMeshFlags.FIX_INTERNAL_EDGES` when creating trimesh colliders. Avoid long thin triangles in floor geometry.

5. **Performance from complex collision** - Frame drops when physics step exceeds 16ms. Set collision mesh budget: max 500 triangles for entire map. Use compound primitive colliders for buildings instead of trimesh where possible.

6. **Spawn point issues** - Players spawn inside geometry or visible to enemies. Validate spawn Y-coordinate with shape cast to ground. Ensure no spawn point has line-of-sight to enemy base. Check all spawns are inside boundary polygon.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Map Configuration & Boundaries
**Rationale:** Config defines all downstream work. Spawn positions, flag bases, and playable area boundaries have no dependencies and inform all geometry decisions.
**Delivers:** `mapConfig.ts` with spawn arrays, base positions, boundary polygon. Boundary validation integrated into player controller.
**Addresses:** Spawn point issues pitfall, map boundaries feature requirement
**Avoids:** Hardcoded positions that break when geometry changes

### Phase 2: Collision Architecture Foundation
**Rationale:** Collision mesh decisions must be made before visual geometry to avoid "visual first, physics later" trap that causes performance issues.
**Delivers:** Simplified collision mesh workflow, debug visualization enabled, collision complexity budget established (max 500 triangles)
**Uses:** @react-three/rapier for RigidBody/CuboidCollider components, TriMeshFlags for edge fixing
**Addresses:** Performance pitfall, visual/collision mismatch pitfall
**Avoids:** Using visual mesh directly as collision mesh

### Phase 3: Core Map Geometry (Floors, Walls, Ramps)
**Rationale:** Build foundational geometry with collision testing at each step. Establishes movement flow before adding detail.
**Delivers:** Primary pathways, floor surfaces, boundary walls with working collision. 3 main attack routes navigable.
**Addresses:** Route structure feature, travel time balance feature
**Implements:** MapGeometry + MapColliders components with separation of concerns
**Avoids:** Ghost collision issues by testing diagonal movement on all surfaces

### Phase 4: Height Tiers & Verticality
**Rationale:** After horizontal flow works, add vertical dimension. Must test with hero mobility abilities (Blaze jetpack, Hookshot grapple).
**Delivers:** 2-3 height levels accessible via ramps/jumps. Ground-level alternatives to all elevated positions.
**Addresses:** Multiple height levels feature, hero mobility support
**Implements:** Elevated platforms, ramps, ledges - all with collision validation
**Avoids:** Punishing low-mobility heroes (Sentinel, Pulse) with required vertical routes

### Phase 5: Flag Zones & Choke Points
**Rationale:** Objective areas require completed route structure and height tiers to test engagement timings.
**Delivers:** Flag base areas with 2-3 entrances, balanced cover at choke points, no impasse positions
**Addresses:** Flag zone design feature, choke point timing feature, balanced cover feature
**Uses:** CSG for carved windows/doors if needed (@react-three/csg)
**Avoids:** Single-entrance flag rooms that become unbreachable

### Phase 6: Spawn System Validation
**Rationale:** After map geometry is complete, validate all spawn points against physics world. Cannot do earlier without collision meshes.
**Delivers:** Runtime spawn validation (shape cast to ground, collision check, boundary check), spawn protection logic
**Addresses:** Spawn positioning feature, spawn point issues pitfall
**Implements:** SpawnManager integration with mapConfig, line-of-sight checks
**Avoids:** Players spawning stuck in geometry or visible to enemies

### Phase 7: Advanced Features (Hero-Specific Routes)
**Rationale:** After core gameplay works, add hero-specific mobility shortcuts. Requires playtesting to determine which heroes need buffs.
**Delivers:** Grapple points for Hookshot, teleport spots for Phantom, jetpack-only ledges for Blaze
**Addresses:** Hero-specific mobility routes feature, risk/reward flanking feature
**Implements:** Optional paths that reward mastery without being required

### Phase 8: Performance Optimization & Polish
**Rationale:** Final pass to hit performance targets and add visual/audio polish.
**Delivers:** Instancing for repeated props, LOD for distant objects, environmental storytelling, team visual differentiation
**Addresses:** Draw call budget (<500 for full map), physics step time (<8ms with 8 players)
**Uses:** Drei Instances for repeated elements, r3f-perf monitoring

### Phase Ordering Rationale

- **Config first:** No dependencies, informs all other work
- **Collision before visual:** Prevents performance traps and visual/collision mismatch
- **Horizontal before vertical:** Establishes flow pattern, then adds complexity
- **Geometry before gameplay systems:** Spawn validation needs collision meshes to exist
- **Core features before advanced:** Validate basic CTF works before adding hero-specific complexity
- **Performance last:** Optimization after features are complete and stable

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Core Geometry):** May need Blender workflow research if team unfamiliar with GLB export pipeline and transform baking
- **Phase 7 (Hero Routes):** Needs hero ability research to understand movement capabilities (grapple range, jetpack fuel, teleport distance)

Phases with standard patterns (skip research-phase):
- **Phase 1 (Config):** Data structures, well-documented
- **Phase 2 (Collision):** Rapier docs are comprehensive, pattern established
- **Phase 5 (Flag Zones):** CTF design is well-documented domain
- **Phase 6 (Spawn System):** SpawnManager already exists, integration is straightforward

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified via official Rapier/R3F docs, Context7, current 2025 articles |
| Features | MEDIUM | Based on established CTF/FPS patterns; hero-specific mobility creates some uncertainty |
| Architecture | HIGH | Based on existing codebase analysis and official R3F/Rapier documentation |
| Pitfalls | HIGH | Verified against official Rapier docs, R3F sources, common issues from community |

**Overall confidence:** HIGH

### Gaps to Address

- **Hero ability movement parameters:** Research couldn't determine exact values for grapple range, jetpack fuel duration, teleport distance. Need to measure in-game during Phase 7 planning to size hero-specific routes correctly.

- **Multiplayer synchronization:** Research focused on single-player physics. Phase 8 may need additional research on deterministic physics and client-side prediction patterns for networked collision.

- **Blender workflow details:** If team is unfamiliar with Blender export pipeline, Phase 3 may need supplementary research on UV mapping, texture baking, and LOD creation. Research assumed basic 3D modeling proficiency.

- **Collision group implementation:** Current codebase doesn't appear to use collision groups. Phase 2 will need to establish group numbering conventions and test mutual matching behavior with actual game objects.

## Sources

### Primary (HIGH confidence)
- [@react-three/rapier GitHub](https://github.com/pmndrs/react-three-rapier) - Automatic collider generation, RigidBody API
- [Rapier Colliders Docs](https://rapier.rs/docs/user_guides/javascript/colliders/) - Collider types, trimesh vs hull, TriMeshFlags
- [Rapier Advanced Collision](https://rapier.rs/docs/user_guides/javascript/advanced_collision_detection_js/) - CCD, contact manifolds
- [Rapier Collision Groups](https://rapier.rs/docs/user_guides/javascript/collider_collision_groups/) - Bitmask filtering, mutual matching
- [@react-three/csg GitHub](https://github.com/pmndrs/react-three-csg) - CSG operations for procedural geometry
- [Drei Instances Docs](https://drei.docs.pmnd.rs/performances/instances) - Instancing API and createInstances
- [R3F Scaling Performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance) - Draw call budget, instancing strategy
- [R3F Performance Pitfalls](https://docs.pmnd.rs/react-three-fiber/advanced/pitfalls) - Memory leaks, disposal
- [TF2Maps.net CTF Design Guide](https://tf2maps.net/threads/guide-fun-fast-and-dynamic-ctf-design.11683/) - Comprehensive CTF principles
- [World of Level Design - Choke Points](https://www.worldofleveldesign.com/categories/csgo-tutorials/csgo-principles-choke-point-level-design.php) - CS:GO choke point principles
- [The Level Design Book - Map Balance](https://book.leveldesignbook.com/process/combat/balance) - Competitive balance theory
- [Valve Developer Wiki - TF2 Design Theory](https://developer.valvesoftware.com/wiki/TF2_Design_Theory) - Class-based design

### Secondary (MEDIUM confidence)
- [Codrops Three.js Performance 2025](https://tympanus.net/codrops/2025/02/11/building-efficient-three-js-scenes-optimize-performance-while-maintaining-quality/) - Physics optimization
- [Codrops Blender to Three.js 2025](https://tympanus.net/codrops/2025/04/08/3d-world-in-the-browser-with-blender-and-three-js/) - Map workflow
- [CritPoints - Good FPS Map Design](https://critpoints.net/2018/02/18/good-fps-map-design/) - Loop and sightline theory
- [Blizzard - Overwatch 2 Map Design](https://overwatch.blizzard.com/en-us/news/23785339/uniting-gameplay-and-style-behind-overwatch-2-s-complex-map-design/) - Hero shooter verticality
- [Multiplayer Level Design Techniques](https://games.themindstudios.com/post/multiplayer-level-design-techniques/) - Spawn placement
- [Halo Spawn Points Guide](https://c20.reclaimers.net/h1/guides/multiplayer/player-spawns/) - Team spawn conventions

### Tertiary (LOW confidence)
- [Three.js Forum: GLTF Collision](https://discourse.threejs.org/t/react-three-fiber-add-collision-to-imported-blender-gltf-object/41184) - Transform issues discussion
- [Rapier GitHub Issue #669](https://github.com/dimforge/rapier/issues/669) - Ghost collision discussion

---
*Research completed: 2026-01-22*
*Ready for roadmap: yes*
