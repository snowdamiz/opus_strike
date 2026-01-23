# Feature Research: Competitive CTF Map Design

**Domain:** Competitive FPS/CTF Map Design for Hero Shooter
**Researched:** 2026-01-22
**Confidence:** MEDIUM (based on established design patterns; hero-specific mobility creates some uncertainty)

## Feature Landscape

### Table Stakes (Users Expect These)

Features players assume exist in a competitive CTF map. Missing these = the map feels broken or unplayable.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Symmetrical or balanced travel times** | Both teams need equal opportunity to capture/defend | LOW | Can achieve with visual asymmetry + gameplay symmetry. Measure with "knife runs" from spawn to flag |
| **3-4 distinct attack routes** | Prevents "guess maps" (too many angles) and chokepoint stalemates (too few) | MEDIUM | Three overlapping loops is the CS:GO gold standard. Fewer = defense-dominant, more = chaos |
| **Clear flag zone visibility** | Players need instant orientation on where objectives are | LOW | Use visual landmarks, lighting, and elevation differences to mark flag areas |
| **Spawn protection/positioning** | Prevents spawn camping and ensures fair re-engagement | LOW | Spawns face away from walls, have cover on exit, and are positioned at map edges |
| **Balanced cover at choke points** | Neither team should have structural advantage at engagement areas | MEDIUM | Equal cover from both approach directions. Test with actual engagements |
| **Multiple height levels** | Essential for hero shooters with vertical mobility | MEDIUM | At least 2-3 height tiers. High mobility heroes need routes; low mobility heroes need protection |
| **Mixed sightline lengths** | Supports different weapon ranges and playstyles | MEDIUM | Short sightlines for CQC areas, medium for general combat, 1-2 long sightlines for sniping |
| **Choke point timing (~5-12 seconds)** | Both teams arrive at contested areas around the same time | LOW | Defenders can arrive 2-3 seconds earlier to set up. Test and tune spawn distances |
| **Flag carrier escape routes (3-4)** | Defenders must predict, not simply block all exits | MEDIUM | Makes flag return gameplay dynamic. Creates "interception" moments |
| **Distinguishable team sides** | Players need instant visual orientation | LOW | Use color coding, different architectural styles, or lighting. CS:GO uses orange vs blue |

### Differentiators (Competitive Advantage)

Features that make a map memorable and competitively interesting. Not required, but create the "golden moments."

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Hero-specific mobility routes** | Rewards mastery of specific heroes; creates emergent strategy | HIGH | Wall-run paths only Hookshot can use, teleport spots for Phantom, jetpack-only ledges for Blaze |
| **Dynamic defense positions** | Multiple valid defensive setups create strategic depth | MEDIUM | Different angles work against different team compositions. Forces adaptation |
| **Risk/reward flanking routes** | Skilled players can take dangerous shortcuts for advantage | MEDIUM | Example: exposed high-ground route that's faster but visible |
| **"Boost" spots for team coordination** | Teamwork enables positions that solo players cannot reach | LOW | Two-player boost locations reward communication |
| **Ambush architecture** | Enables "interception" plays on flag carriers | MEDIUM | Overlook points where defenders can cut off predictable escape routes |
| **Neutral mid-control objective** | Creates early-game fighting before flag pushes | HIGH | Optional: contested resource or position that advantages the controlling team |
| **One-way drops/paths** | Creates commitment decisions; prevents easy retreats | LOW | Falling from high ground commits you to an attack. Adds tension |
| **"Ninja" routes** | Hidden or non-obvious paths for creative plays | LOW | Reward map knowledge without being required for basic play |
| **Sound design landmarks** | Distinct audio for different map areas | MEDIUM | Different floor materials, ambient sounds help situational awareness |
| **Environmental storytelling** | Makes the map memorable and immersive | LOW | Visual narrative that explains why this location exists |

### Anti-Features (Things NOT to Build)

Features that seem good but create problems. Explicitly exclude from this test map.

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| **Flag in spawn-adjacent room** | "Easier to defend" | Forces attackers through defenders twice; enables kill farming over objective play | Place flag accessible from multiple routes, defensible but not spawn-camping-friendly |
| **Single-entrance flag room** | "Strategic defense" | Creates impasses; Sentinel's barriers + Glacier's walls make it literally impossible to breach | Minimum 2 entrances to any objective area, preferably 3 |
| **Extreme verticality everywhere** | "We have mobility heroes" | Punishes low-mobility heroes (Sentinel, Pulse) excessively; creates unfair matchups | Use verticality strategically in specific areas, not map-wide |
| **Long hallways** | "Classic FPS design" | Only one engagement angle; position becomes deterministic not strategic | Use rooms and intersections that offer multiple angles |
| **Perfect symmetry** | "Fair balance" | Boring and artificial-feeling; hard to orient | Visual asymmetry with gameplay symmetry (same distances, different aesthetics) |
| **Too many routes (5+)** | "More options = more depth" | Defenders cannot hold anything; attackers win by default | Stick to 3-4 main routes. "Less is more" in level design |
| **Inescapable killboxes** | "Punish mistakes" | Frustrating deaths without counterplay; encourages camping over active defense | Every dangerous area needs an escape option |
| **Sentry-proof positions** | "Defense should be strong" | With Sentinel's abilities, creates permanent unbreakable setups | All defensive positions need flanking counters or destructible angles |
| **Map-wide long sightlines** | "Skill expression" | Favors only one playstyle; mobile heroes become death-trapped | Limit long sightlines to 1-2 specific areas |
| **Complex verticality for low-mobility heroes** | "Adds depth" | Actually adds frustration; Sentinel/Pulse become unviable picks | Provide ground-level alternatives to all vertical routes |

## Feature Dependencies

```
[Spawn Positioning]
    |
    v
[Travel Time Balance] --requires--> [Route Structure (3-4 paths)]
    |                                      |
    v                                      v
[Choke Point Timing]              [Cover Placement at Chokes]
    |                                      |
    +----------+----------+----------------+
               |
               v
        [Flag Zone Design]
               |
    +----------+----------+
    |                     |
    v                     v
[Escape Routes]    [Defense Positions]
    |                     |
    +----------+----------+
               |
               v
    [Hero-Specific Routes] <--enhances-- [Height Levels]
               |
               v
    [Risk/Reward Flanking]
```

### Dependency Notes

- **Travel Time Balance requires Route Structure:** Cannot tune timing without first establishing paths
- **Choke Point Timing requires Spawn Positioning:** Spawn location determines arrival times
- **Flag Zone Design requires Choke Points:** Flag area is defined by how players flow to it
- **Hero-Specific Routes require Height Levels:** Vertical mobility needs vertical space to use
- **Risk/Reward Flanking enhances Hero-Specific Routes:** Advanced routes build on mobility infrastructure
- **Cover Placement conflicts with Long Sightlines:** Heavy cover shortens effective sightlines; balance is trade-off

## MVP Definition

### Launch With (v1 - Test Map)

Minimum viable map to test CTF gameplay and hero balance.

- [x] **Symmetrical travel times** - Foundational balance requirement
- [x] **3 main attack routes** - Minimum for strategic depth without overwhelming defenders
- [x] **2-height verticality** - Ground floor + elevated positions; tests mobility without complexity
- [x] **Clear flag zones with 2+ entrances** - Prevents impasse scenarios
- [x] **Balanced spawn positioning** - Fair starts for both teams
- [x] **Mixed sightlines** - At least one long corridor, several medium, and close-quarters areas
- [x] **Basic cover at choke points** - Boxes, walls, pillars at engagement areas

### Add After Validation (v1.x)

Features to add once core gameplay loop works.

- [ ] **Hero-specific mobility routes** - After confirming which heroes need map buffs
- [ ] **Risk/reward flanking paths** - After observing how players naturally move
- [ ] **Third height tier** - If 2-tier feels limiting for Blaze/Hookshot
- [ ] **Boost spots** - After testing team coordination patterns
- [ ] **Environmental storytelling** - Polish pass after gameplay is solid

### Future Consideration (v2+)

Features to defer until the test map proves successful.

- [ ] **Neutral mid objective** - Adds complexity; defer until basic CTF works
- [ ] **Sound design landmarks** - Audio pass after visual/spatial design finalized
- [ ] **One-way paths** - Can create frustration; add only if stalemates become problem
- [ ] **Alternative flag/capture zone positions** - Only if single-location proves stale

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Travel time balance | HIGH | LOW | P1 |
| 3-4 attack routes | HIGH | MEDIUM | P1 |
| 2-height verticality | HIGH | MEDIUM | P1 |
| Flag zone (2+ entrances) | HIGH | LOW | P1 |
| Spawn positioning | HIGH | LOW | P1 |
| Choke point cover | HIGH | MEDIUM | P1 |
| Mixed sightlines | MEDIUM | LOW | P1 |
| Team visual differentiation | MEDIUM | LOW | P1 |
| Hero-specific routes | MEDIUM | HIGH | P2 |
| Risk/reward flanks | MEDIUM | MEDIUM | P2 |
| Boost spots | LOW | LOW | P2 |
| Third height tier | MEDIUM | MEDIUM | P2 |
| Ambush architecture | MEDIUM | MEDIUM | P2 |
| Environmental storytelling | LOW | MEDIUM | P3 |
| Sound landmarks | LOW | MEDIUM | P3 |
| Neutral mid objective | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for test map release
- P2: Should have, add when core gameplay works
- P3: Nice to have, consider for future versions

## Competitor Feature Analysis

| Feature | CS:GO (de_dust2) | Overwatch (CTF maps) | TF2 (ctf_2fort) | Our Approach |
|---------|------------------|----------------------|-----------------|--------------|
| **Symmetry** | Asymmetric visual, balanced gameplay | Symmetric with visual distinction | Perfect mirror | Visual asymmetry, gameplay symmetry |
| **Verticality** | Minimal (low sens players) | High (hero abilities) | Moderate | High but with ground alternatives |
| **Route count** | 3 main + connectors | 2-3 per map | 3 (front, sewer, spiral) | 3 main routes + hero-specific shortcuts |
| **Flag defense** | N/A (bomb) | 2-3 entrances | 1 main + vents | 2-3 entrances, no impasse positions |
| **Spawn distance** | Long (~20s to sites) | Short (~5-10s) | Medium (~15s) | Medium (10-15s to flag area) |
| **Choke points** | 3 clear chokes | Varied per map | Strong chokepoint focus | 3 chokes, all with flanking options |
| **Hero mobility support** | N/A (no abilities) | Full (map designed for it) | Class-varied | Full support with low-mobility alternatives |

## Special Considerations for Hero Abilities

Given the hero roster (Phantom, Hookshot, Blaze, Glacier, Pulse, Sentinel), map design must account for:

| Hero | Key Mobility | Map Requirement |
|------|--------------|-----------------|
| **Phantom** | Blink teleportation, Shadow Step | Medium sightlines for blink targets; shadow areas for invisibility value |
| **Hookshot** | Grappling hook, Swing | Horizontal grapple points; open air space for swinging; anchor points throughout |
| **Blaze** | Jetpack, Rocket jump | Vertical space; elevated positions; fuel-appropriate distances between perches |
| **Glacier** | Ice slide, Wall climb | Long floor surfaces for slide value; climbable walls; not all walls (preserve strategy) |
| **Pulse** | Speed aura, Quick dash | Open running lanes; cover for speed-pushing teammates |
| **Sentinel** | Fortify, Energy barrier | Defensible positions; chokepoints worth holding; cannot rely on map for defense |

**Design principle:** Every area accessible to high-mobility heroes must also have a ground-level route for Sentinel and Pulse. Otherwise those heroes become unviable picks on this map.

## Sources

- [TF2Maps.net CTF Design Guide](https://tf2maps.net/threads/guide-fun-fast-and-dynamic-ctf-design.11683/) - Comprehensive CTF principles (HIGH confidence)
- [World of Level Design - Choke Points](https://www.worldofleveldesign.com/categories/csgo-tutorials/csgo-principles-choke-point-level-design.php) - CS:GO choke point principles (HIGH confidence)
- [The Level Design Book - Map Balance](https://book.leveldesignbook.com/process/combat/balance) - Competitive balance theory (HIGH confidence)
- [CritPoints - Good FPS Map Design](https://critpoints.net/2018/02/18/good-fps-map-design/) - Loop and sightline theory (MEDIUM confidence)
- [Valve Developer Wiki - TF2 Design Theory](https://developer.valvesoftware.com/wiki/TF2_Design_Theory) - Class-based design (HIGH confidence)
- [Blizzard - Overwatch 2 Map Design](https://overwatch.blizzard.com/en-us/news/23785339/uniting-gameplay-and-style-behind-overwatch-2-s-complex-map-design/) - Hero shooter verticality (MEDIUM confidence)

---
*Feature research for: Competitive CTF Map Design for Hero Shooter*
*Researched: 2026-01-22*
