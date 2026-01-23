# Requirements: Opus Strike CTF Map

**Defined:** 2026-01-22
**Core Value:** A fully playable asymmetrical CTF map with proper collision, spawn points, and flag zones that integrates seamlessly with the existing game systems.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Map Foundation

- [ ] **FOUND-01**: Remove current imported map from game world
- [ ] **FOUND-02**: Create asymmetrical map layout with visually distinct team sides
- [ ] **FOUND-03**: Establish three main attack routes connecting team bases
- [ ] **FOUND-04**: Balance travel times between routes (no route significantly faster)

### Team Areas

- [ ] **TEAM-01**: Build Team A base area with distinct visual identity
- [ ] **TEAM-02**: Build Team B base area with distinct visual identity
- [ ] **TEAM-03**: Configure spawn points for Team A (multiple positions)
- [ ] **TEAM-04**: Configure spawn points for Team B (multiple positions)
- [ ] **TEAM-05**: Create flag zone for Team A with 2-3 entry points
- [ ] **TEAM-06**: Create flag zone for Team B with 2-3 entry points
- [ ] **TEAM-07**: Integrate flag zones with FlagManager and CTFGameMode

### Cover & Engagement

- [ ] **COVR-01**: Place hard cover elements (walls, barriers) along routes
- [ ] **COVR-02**: Define 2-3 choke points for team fight engagement
- [ ] **COVR-03**: Create mixed sightlines (short, medium, long range options)
- [ ] **COVR-04**: Add elevated positions with height advantage
- [ ] **COVR-05**: Build ramps/stairs for vertical navigation

### Environment Elements

- [ ] **ENVR-01**: Create building structures (solid, provide cover/routing)
- [ ] **ENVR-02**: Add trees/foliage for decoration and concealment
- [ ] **ENVR-03**: Place props (barrels, crates) for small cover and detail

### Technical Integration

- [ ] **TECH-01**: Generate collision meshes for all walkable surfaces
- [ ] **TECH-02**: Generate collision meshes for all blocking surfaces (walls, buildings)
- [ ] **TECH-03**: Register collision meshes with Rapier physics world
- [ ] **TECH-04**: Integrate spawn positions with SpawnManager
- [ ] **TECH-05**: Use instanced rendering for repeated props (performance optimization)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Features

- **ADV-01**: Hero-specific shortcuts (grapple points, teleport spots)
- **ADV-02**: Competitive lighting optimization (clear visibility, no dark corners)
- **ADV-03**: Collision layer separation (players, projectiles, triggers)
- **ADV-04**: Debug visualization toggle for testing

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Destructible/interactive elements | Adds complexity without testing value |
| Multiple map variants | Single map sufficient for testing |
| Map editor/tools | Manual construction is fine for one map |
| Complex textures/materials | Low-poly aesthetic uses simple materials |
| Dynamic lighting | Performance overhead, not needed for testing |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | TBD | Pending |
| FOUND-02 | TBD | Pending |
| FOUND-03 | TBD | Pending |
| FOUND-04 | TBD | Pending |
| TEAM-01 | TBD | Pending |
| TEAM-02 | TBD | Pending |
| TEAM-03 | TBD | Pending |
| TEAM-04 | TBD | Pending |
| TEAM-05 | TBD | Pending |
| TEAM-06 | TBD | Pending |
| TEAM-07 | TBD | Pending |
| COVR-01 | TBD | Pending |
| COVR-02 | TBD | Pending |
| COVR-03 | TBD | Pending |
| COVR-04 | TBD | Pending |
| COVR-05 | TBD | Pending |
| ENVR-01 | TBD | Pending |
| ENVR-02 | TBD | Pending |
| ENVR-03 | TBD | Pending |
| TECH-01 | TBD | Pending |
| TECH-02 | TBD | Pending |
| TECH-03 | TBD | Pending |
| TECH-04 | TBD | Pending |
| TECH-05 | TBD | Pending |

**Coverage:**
- v1 requirements: 24 total
- Mapped to phases: 0
- Unmapped: 24 ⚠️

---
*Requirements defined: 2026-01-22*
*Last updated: 2026-01-22 after initial definition*
