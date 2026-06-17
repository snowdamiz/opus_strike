# Opus Strike - Custom Map System

## Related Planning

- [Admin Hero Editor And Animator](HERO_EDITOR_PLAN.md)

## What This Is

A custom low-poly competitive CTF map for Opus Strike, replacing the imported map with a purpose-built asymmetrical arena. The map provides a CS:GO-inspired gameplay environment with strategic lanes, cover positions, and proper game system integration for testing and play.

## Core Value

A fully playable asymmetrical CTF map with proper collision, spawn points, and flag zones that integrates seamlessly with the existing game systems.

## Requirements

### Validated

- ✓ CTF game mode with flag capture mechanics — existing
- ✓ Hero system with unique abilities (Phantom, Blaze, Hookshot) — existing
- ✓ Rapier physics-based movement and collision — existing
- ✓ Colyseus multiplayer state synchronization — existing
- ✓ Spawn management system — existing
- ✓ React Three Fiber rendering pipeline — existing
- ✓ Visual state architecture with Zustand stores — existing

### Active

- [ ] Remove current imported map from game world
- [ ] Create asymmetrical low-poly CTF arena base geometry
- [ ] Build Team A base area with flag zone and spawn points
- [ ] Build Team B base area with flag zone and spawn points
- [ ] Create multiple strategic lanes connecting bases
- [ ] Add building structures (solid cover, enterable where appropriate)
- [ ] Add environmental cover elements (crates, walls, barriers)
- [ ] Add decorative elements (trees, props)
- [ ] Add elevated positions and ramps for vertical gameplay
- [ ] Integrate collision meshes with Rapier physics
- [ ] Configure spawn point positions for both teams
- [ ] Configure flag zone positions with proper UI/game objects
- [ ] Ensure proper lighting for competitive visibility

### Out of Scope

- Dynamic/destructible environment — adds complexity without testing value
- Multiple map variants — single map sufficient for testing
- Map editor/tools — manual construction is fine for one map
- Texture/material complexity — low-poly aesthetic uses simple materials

## Context

**Existing Map System:**
The game currently uses an imported GLTF/GLB map. The map integrates with:
- Physics world via Rapier collision meshes
- Spawn system via SpawnManager
- Flag system via FlagManager and CTFGameMode
- Visual rendering via React Three Fiber components

**Technical Environment:**
- React Three Fiber 8.17 with Three.js 0.169
- @react-three/drei 9.114 for utilities
- Rapier 0.14 for physics
- Monorepo structure: client renders, game-logic defines rules, physics handles collisions

**CTF Requirements:**
- Two teams need distinct spawn areas
- Each team has a flag zone (capture point)
- Routes between bases should offer strategic choices
- Cover should enable tactical gameplay

## Constraints

- **Stack**: Must use existing R3F/Rapier stack — no new dependencies
- **Integration**: Must work with existing SpawnManager, FlagManager, CTFGameMode
- **Performance**: Low-poly geometry to maintain smooth multiplayer performance
- **Aesthetic**: Clean low-poly style consistent with "Voxel Strike" naming

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Asymmetrical layout | User preference, adds strategic depth | — Pending |
| Low-poly aesthetic | Performance + visual consistency | — Pending |
| Procedural geometry | Full control over collision/integration | — Pending |

---
*Last updated: 2026-01-22 after initialization*
