# AI Bot Lobbies, Shared Movement, and Hero Voxel Bodies Plan

## Reader and Action

This plan is for an internal engineer joining the project cold. After reading it, they should be able to implement lobby-created primitive AI bots that play CTF using the same movement, targeting, ability, damage, respawn, and objective rules as human players, while also replacing the generic in-game body with hero-specific voxel bodies based on the lobby hero SVGs.

## Goal

Let a host create a lobby with one or more primitive AI bots, start a match, and see those bots behave as real match participants:

- Bots appear in the lobby and game roster.
- Bots choose heroes, become ready, spawn, respawn, score, die, carry and drop flags, and grant stats/ultimate charge like players.
- Bots move through the same shared movement simulation as humans.
- Bots use primary fire, secondary fire, ability 1, ability 2, and ultimate through the same server-side ability/combat path as humans.
- Bots target enemies and objectives using simple deterministic logic.
- Every hero has a readable voxel body in game, including bots and remote players.

## Current State and Gaps

The current project already has useful pieces, but they are not connected as a bot-ready system.

- Lobby rooms only model human players. Game start broadcasts human assignments, and game rooms assign teams as humans join.
- Game rooms have development NPC commands, but NPCs are test entities, not lobby slots or full match participants.
- NPC damage currently has special client shortcuts in several effects. This makes bots damageable in some cases but does not make humans and bots share one combat rule path.
- Server movement is a simple fallback, while the client has richer movement with sliding, bunny hopping, terrain collision, and hero-specific movement effects.
- CTF flags are rendered and reset, and flags drop on death, but active pickup, return, capture, score broadcasts, and objective-state updates are not fully wired into the live game room.
- Remote players currently use one generic blocky body with team tint instead of hero-specific silhouettes.

## Design Principles

- Bots are server-owned players, not fake browser clients.
- A bot should produce the same input shape a real player sends whenever possible.
- The game should not branch on "human versus bot" for movement, damage, scoring, cooldowns, or respawn rules.
- Client visuals can predict and animate, but combat and objective results must be server authoritative.
- Primitive AI is enough for this milestone: direct steering, simple target choice, basic ability heuristics, and stuck recovery.
- Do not test this work in the browser during implementation; leave browser playtesting to the user.

## Phase 1: Shared Participant Schema

Add a first-class participant model that can represent humans and bots.

- Extend lobby player state with `isBot`, `botDifficulty`, `heroId`, and optional `botProfileId`.
- Extend game player state and shared player types with `isBot`.
- Use stable bot IDs such as `bot_<roomId>_<index>` instead of the existing development `npc_` identity.
- Keep bots in the same `players` collection as humans so scoreboards, nameplates, damage, targeting, and broadcasts can remain generic.
- Keep `maxClients` as the human connection limit, and add a separate max participant rule for humans plus bots.
- Preserve backward compatibility for human-only lobbies.

Acceptance criteria:

- Human-only lobbies behave as before.
- Bot players can exist in lobby and game state without a Colyseus client.
- Clients can render bot rows and in-game bot players from normal player state.

## Phase 2: Lobby Bot Controls

Let hosts create and manage bot slots before the match starts.

- Add bot options to lobby creation: initial bot count, fill mode, and default difficulty.
- Add host-only lobby messages: add bot, remove bot, update bot team, update bot hero, and optionally randomize bot heroes.
- Auto-balance bot team assignment using the same red/blue team rules as humans.
- Mark bots ready automatically.
- Include bots in lobby state, ready counts, team panels, start-game readiness, and game-start assignments.
- Ensure kicking a bot removes the bot slot rather than trying to disconnect a client.
- Include bot counts in lobby browser metadata.

Acceptance criteria:

- A host can create a lobby with bots.
- A host can add/remove bots from the lobby screen.
- Starting a game carries both human and bot assignments into the game room.

## Phase 3: Shared Movement Consolidation

Consolidate client and server movement into a shared movement simulator before bot AI work depends on movement.

### Why This Comes First

Bots need to move through the world without a browser. If the bot uses the current simplified server movement while humans use richer client movement, bots will feel wrong and future server authority will stay fragile. The movement simulator should become the common engine for humans, bots, and server validation.

### Work

- Create a shared movement simulator in the physics package that accepts:
  - player transform and velocity
  - movement state
  - hero stats
  - active ability modifiers
  - flag carrier state
  - input booleans
  - look yaw and pitch
  - delta time
  - a terrain/collision adapter
- Move or mirror the current client movement behavior into that simulator:
  - walk, sprint, crouch, jump
  - Quake/Source-style acceleration and air control
  - sliding, slide cooldown, slide steering, and slide boosts
  - gravity, landing, out-of-bounds recovery
  - hero speed/jump stats
  - flag carrier speed penalty
  - active speed modifiers from Phantom Veil, Pulse Speed Aura, Pulse Haste, and similar effects
  - basic grapple/swing/dash/blink movement hooks where they affect authoritative state
- Replace the game room's simplified physics update with this shared simulator.
- Update the client player controller to use the same simulator for prediction where practical, while keeping local camera/input ergonomics.
- Provide a server terrain adapter using procedural map bounds and colliders.
- Provide a client terrain adapter using the existing local physics/collision data.
- Make bot controllers generate the same input that the simulator consumes.
- Add deterministic tests for representative movement cases:
  - walking and sprint speed
  - jump and gravity
  - slide start/end
  - flag carrier penalty
  - speed boost modifiers
  - map bounds clamping or recovery

Acceptance criteria:

- The server and bot movement path use the shared simulator.
- The client prediction path no longer owns unique movement rules that the server cannot reproduce.
- Movement tests pass without launching a browser.

## Phase 4: Server-Authoritative Combat and Abilities

Unify combat so bots and humans can damage each other through the same path.

- Replace client-only NPC damage shortcuts with server-side hit and damage messages that apply to any alive enemy player.
- Keep client effects as visuals, but make hit validation and damage application server authoritative.
- Add a generic `applyDamage` helper that handles:
  - friendly fire rules
  - spawn protection
  - health changes
  - death
  - kill credit
  - assist tracking if implemented
  - ultimate charge
  - flag drop on death
  - damage and kill broadcasts
- Add server-side handling for primary and secondary attacks, not only ability slots.
- Add a reusable `processPlayerInput` path that can be called for both humans and bots.
- Keep per-player press state for ability edges, including bots.
- Add target data support for abilities that need a ground target, direction target, or confirmed target position.
- Implement or wire server-side hit logic for the currently client-driven attacks:
  - Phantom Dire Ball and Void Ray
  - Hookshot Chain Hooks, Drag Hook, Swing Line, Grapple Pull, and Grapple Trap
  - Blaze Rockets, Bomb/Air Strike targeting, Rocket Jump splash, and Flamethrower
  - Glacier Ice Mallet, Ice Wall Rush, Frost Storm, and Fortress
  - Pulse Speed Aura, Dash, and Haste
  - Sentinel Fortify, Barrier, and Dome
- Keep ability visuals triggered by server broadcasts so remote players and bots show the same effects.
- Deprecate development NPC damage commands or clearly keep them as dev-only helpers.

Acceptance criteria:

- A human can damage and kill a bot with the same attacks used against humans.
- A bot can damage and kill a human with the same attacks used by humans.
- No production combat code checks for `npc_` IDs.
- Ability cooldowns, charges, active states, and ultimate charge remain synchronized.

## Phase 5: CTF Objective Support

Wire complete objective play into the live game room.

- Use the existing CTF game-mode logic or port its behavior directly into the game room.
- On every playing tick, evaluate alive players for:
  - enemy flag pickup
  - own dropped flag return
  - capture at own base while carrying enemy flag
  - auto-return after the flag return timer
- Update flag carrier IDs, positions, base state, dropped state, and scores.
- Broadcast flag pickup, drop, return, and capture events.
- Increment player flag stats and award ultimate charge for captures if desired.
- Ensure bots can pick up, carry, drop, return, and capture flags without special cases.
- Make bot strategy aware of flag state.

Acceptance criteria:

- Any alive player, human or bot, can play the full CTF objective loop.
- Flags, scores, carrier indicators, and broadcasts stay correct.
- Death while carrying still drops the correct enemy flag.

## Phase 6: Bot Controller and Primitive AI

Add server-owned bot controllers that run during game room ticks.

### Bot Lifecycle

- Create bot players from lobby assignments when the game room is created.
- During hero select, assign the chosen hero or a default hero and mark the bot ready.
- During countdown and playing, spawn bots exactly like players.
- During death, let normal respawn logic revive bots.
- On round reset or match end, reset bot state exactly like human player state.

### Bot Perception

Each bot should derive a small blackboard every tick or at a lower AI tick rate:

- nearest visible enemy
- nearest enemy carrying the friendly flag
- nearest dropped friendly flag
- enemy flag position and state
- own base position
- nearby allies
- current health and cooldown state
- stuck timer and last position

### Bot Intent States

Use a simple finite state machine:

- `selecting`: choose hero and ready up.
- `seek_enemy_flag`: move toward enemy flag when no urgent defense exists.
- `carry_flag_home`: return to own base while carrying.
- `return_friendly_flag`: prioritize returning the dropped friendly flag.
- `defend_carrier`: follow an allied carrier.
- `chase_enemy_carrier`: chase an enemy carrying the friendly flag.
- `fight_enemy`: aim and use attacks/abilities on visible enemies.
- `retreat_or_reposition`: back off when low health or stuck.
- `respawning`: no input until alive.

### Movement Input Generation

- Convert the current intent into look yaw, look pitch, and movement booleans.
- Prefer direct steering to the target for the primitive version.
- Add basic stuck recovery:
  - jump if horizontal progress stalls
  - strafe around obstacles
  - briefly reverse and choose a new angle
  - slide or sprint on long flat approaches
- Use procedural CTF layout points as coarse waypoints before introducing a navmesh.
- Keep pathfinding intentionally simple for this milestone.

### Combat and Ability Heuristics

- Aim at the nearest valid enemy within a configurable range.
- Use primary fire when aim is close enough.
- Use secondary fire for hero-specific opportunities.
- Use ability 1 and ability 2 when the target is in a useful range or when movement needs it.
- Use ultimate only when charged and at least one high-value condition is true:
  - near multiple enemies
  - defending or attacking a flag
  - carrying a flag and escaping
  - contesting a capture/return

Hero-specific primitive behaviors:

- Phantom: blink toward cover or an objective, shadowstep to close gaps or escape, veil when carrying or low health.
- Hookshot: grapple/swing toward flags or high-value enemies, use drag hook on fleeing enemies, trap near objectives.
- Blaze: fire rockets at enemies, flamethrower close targets, rocket jump when stuck or escaping, air strike objective clusters.
- Glacier: slide toward objectives, use mallet in melee range, use frost shield under pressure, fortress near flags.
- Pulse: sprint and dash aggressively, speed boost near allies or while carrying, haste during pushes.
- Sentinel: hold defensive positions, barrier toward incoming enemies, fortify when contesting, dome near flag/base fights.

Acceptance criteria:

- Bots move, aim, attack, use abilities, die, respawn, and play the objective.
- Bots do not require connected browser clients.
- Bots are primitive but visibly purposeful.

## Phase 7: In-Game Hero Voxel Bodies

Replace the generic remote-player block body with hero-specific voxel bodies based on the lobby hero SVGs.

### Component Shape

- Add a reusable hero body renderer that takes hero ID, team, health/state cues, and optional bot status.
- Use the same renderer for remote humans and bots.
- Keep nameplates, health bars, and flag carrier indicators.
- Reuse materials and geometry where possible.
- Prefer data-driven voxel parts over hand-copying nearly identical mesh trees.
- Add lightweight idle/walk/ability animation hooks.
- Keep team readability through small red/blue accents, armbands, emissive strips, or base glows rather than recoloring the whole hero.

### Hero Translation Notes

Phantom:

- Hooded silhouette.
- Dark void face.
- Purple glowing eyes.
- Narrow torso.
- Wispy cloak blocks or translucent trailing cubes.
- Subtle blink/veil glow state.

Hookshot:

- Helmet with bright visor.
- Grapple cable spool or backpack.
- One arm rigged with hook launcher.
- Small hook/cable prop.
- Cyan and teal highlights.

Blaze:

- Helmet and visor.
- Back jetpack with two tanks.
- Thruster blocks and flame exhaust particles.
- Orange armor with darker heat-scorched panels.
- Hover/rocket-jump flame state.

Glacier:

- Bulky tank silhouette.
- Broad shoulders and large fists.
- Ice crystal armor plates.
- Blue/white translucent spike accents.
- Heavy boots and frosty aura.

Pulse:

- Slim runner silhouette.
- Chest energy core.
- Streamlined helmet and visor.
- Green speed-line accents.
- Small animated energy trails during sprint/dash.

Sentinel:

- Heavy armor and planted stance.
- Helmet crest.
- Large shield slab or forearm shield.
- Gold/yellow armor highlights.
- Shield/dome energy accents.

Acceptance criteria:

- Every hero is distinguishable in game from silhouette and signature props.
- Bots and remote players use the same hero body renderer.
- Team identity is still readable at combat distance.
- Dead/hidden/spawning states do not create confusing leftover bodies.

## Phase 8: Client UI and State Sync

Update the client to understand bot participants and hero bodies.

- Show bot badges in lobby panels and scoreboards.
- Let hosts manage bot slots from the lobby screen.
- Update lobby browser cards with human count and bot count.
- Update network listeners so `isBot`, `heroId`, and bot metadata flow into game store state.
- Update player state sync so bots are not treated as ghost duplicate players.
- Remove `npc_` assumptions from UI helpers and targeting utilities.
- Render hero voxel bodies for every non-local player.
- Optionally render a simple first-person local-body hint later, but do not block this milestone on it.

Acceptance criteria:

- Lobby UI makes bots obvious but not visually noisy.
- Game UI treats bot stats, kills, deaths, objectives, and health like normal players.
- Bot-specific metadata does not break human reconnection or duplicate-session handling.

## Phase 9: Verification Without Browser Testing

Do not use browser-based verification for this work. Use code-level and server-level verification.

Suggested checks:

- `pnpm typecheck`
- `pnpm build:server`
- `pnpm build:client`
- Unit tests for shared movement simulation.
- Unit tests for bot decision state transitions.
- Unit tests for lobby bot add/remove/team balance.
- Unit tests or integration tests for CTF pickup, return, capture, and drop.
- Integration test for one human assignment plus one bot assignment creating a game room with both participants.
- Server tick simulation test where bots produce inputs and move over several seconds.
- Combat tests where a human-dummy and bot-dummy damage each other through the same server path.

Manual browser playtesting remains for the user after implementation.

## Suggested Implementation Order

1. Add participant schema fields and bot-aware shared types.
2. Add lobby bot controls and game-start bot assignments.
3. Consolidate movement into the shared simulator and swap server movement to it.
4. Create game-room bot players from assignments and make them pass through normal phase/spawn/respawn logic.
5. Wire complete CTF objective handling.
6. Move damage and attack resolution to one server-authoritative path for humans and bots.
7. Add the primitive bot controller and hero-specific ability heuristics.
8. Replace the generic player model with the hero voxel body renderer.
9. Remove or quarantine old development NPC code.
10. Run non-browser verification.

## Risks and Decisions

- Movement consolidation is the riskiest dependency because it changes both client prediction and server simulation. Keep it covered by focused tests and small vertical slices.
- Full navmesh pathfinding is intentionally out of scope for the primitive bot milestone. Use direct steering and procedural CTF waypoints first.
- Server-authoritative combat may reveal existing client-only assumptions in effects. Treat those as required supporting work, because bots and humans must not use different damage rules.
- Hero voxel bodies can be implemented as composed Three.js primitives first. Asset pipeline work can come later if the hand-built voxel bodies become too heavy.
- Keep development NPC commands only if they stay clearly separate from production bot behavior.

## Definition of Done

- A host can create a lobby with bots and start a match.
- Bots appear in the lobby, hero select, scoreboard, game world, and combat feed as normal participants.
- Bots use shared movement, attacks, abilities, targeting, damage, respawn, and CTF objective rules.
- Human and bot damage paths are unified.
- CTF pickup, drop, return, capture, score, and flag carrier state work for humans and bots.
- Every hero has a readable in-game voxel body based on the lobby SVG identity.
- Non-browser verification passes.
