# Bot AI Overhaul Plan

## Reader And Outcome

This plan is for an engineer improving Opus Strike bots from simple reactive opponents into credible CTF teammates.

After reading it, the engineer should be able to implement a staged bot overhaul that makes bots navigate around walls, choose sensible objectives, coordinate around the flag, heal or shield teammates at the right time, and use hero abilities for tactical value instead of random cadence.

## Problem

Bots already have a server-side brain with roles, a blackboard, aiming, movement targets, route nodes, perception checks, and hero-specific ability heuristics. The problem is that these pieces are too shallow:

- Navigation follows a semantic target and only reacts to being stuck after movement failure. Bots do not predict blocked paths, choose alternate lanes, or reason about temporary walls and cover.
- Strategy is mostly one-bot-at-a-time. Bots do not assign team jobs based on match state, ally composition, flag pressure, or local fights.
- Ability use is cadence-driven. A bot may spend a heal, wall, blink, rocket jump, or ultimate because a timer allows it, not because the tactical value is high.
- Support play has no real triage. Chronos can heal any damaged ally in radius, even if the heal is mostly wasted or a better multi-target moment is imminent.
- Difficulty mainly changes aim, reaction, and frequency. It does not change tactical patience, path quality, heal thresholds, focus fire, escort behavior, or objective priority.
- There is no dedicated bot regression harness, so bot quality is hard to measure without playing a match manually.

The durable fix is not a bigger pile of one-off conditions. Build a bot decision pipeline with explicit navigation feedback, utility scoring, team-level tactical state, and measurable scenarios.

## Goals

- Bots stop walking into walls or repeatedly pushing invalid routes.
- Bots route through the map using reachable waypoints, lane alternatives, and short local avoidance.
- Bots make CTF decisions that look intentional: capture, escort, return, defend, intercept, regroup, and pressure.
- Chronos bots save Lifeline for meaningful healing value, move toward heal clusters, and shield when allies are actually behind them.
- Hookshot bots use grapple for movement, anchor walls for blocking lines or protecting carriers, and traps for zones that matter.
- Blaze bots use rocket jump for repositioning and escape, use flamethrower only when close enough to sustain it, and ult clustered enemies or objectives.
- Phantom bots flank, disengage, and pressure carriers instead of blinking into bad geometry.
- Hard bots feel smarter, not merely more accurate.
- The system stays inside the room tick budget and degrades gracefully when many bots are active.

## Non-Goals

- Do not add machine-learning behavior.
- Do not make bots omniscient. Perception should still respect stealth, distance, line of sight, and intentionally public objective information.
- Do not browser-test this work. Use headless/server verification and leave visual or feel checks to the user.
- Do not keep the old monolithic bot heuristics as a permanent legacy path once the replacement is validated.

## Current Architecture Notes

- The authoritative bot brain lives in the server room simulation.
- Bot state currently includes intent, blackboard timing, stuck timing, strafe/reverse state, aim jitter, target id, and ability timing.
- The map manifest already exposes CTF-specific semantic data: bases, flags, spawns, lanes, tactical slots, and a route graph.
- Movement uses the shared movement simulator and collision terrain adapter, so bots can use the same collision knowledge as server movement validation.
- Combat perception already has line-of-sight checks and a short LOS cache.
- The current blackboard tracks allies, enemies, carriers, nearby counts, flag positions, and basic nearest/weakest targets.
- Chronos Lifeline target selection already sorts damaged allies by health ratio and distance, but the decision to spend the charge only checks whether any target is below max health.

## Design Principle

Make bots choose actions by expected value, then execute those actions through movement and ability controllers that know when execution is failing.

Each bot tick should answer four questions:

1. What does my team need right now?
2. What local opportunity or danger can I perceive?
3. Which action has the best value after accounting for cooldown cost, travel time, health, role, and difficulty?
4. Is my current movement/ability execution working, or should I recover/replan?

## Target Decision Pipeline

Use a layered pipeline instead of one large heuristic function:

```ts
TeamTactics -> BotBlackboard -> UtilityIntent -> PathPlan -> CombatPlan -> AbilityPlan -> PlayerInput
```

### TeamTactics

Runs at low frequency per room and produces shared tactical facts:

- Team flag state: safe, dropped, stolen, carrier near base, carrier under pressure.
- Enemy flag state: at base, dropped, carried by ally, contested.
- Role demand: runners needed, defenders needed, escorts needed, interceptors needed, support needed.
- Threat map: enemy clusters, recently seen enemies, carrier danger, blocked lanes.
- Resource map: low-health allies, available support charges, ultimates ready, respawn waves.

### BotBlackboard

Runs per bot and merges team facts with local perception:

- Visible enemies, last-known enemies, recent damage source, nearby allies, ally health debt.
- Current lane, nearest route node, reachable next nodes, cover and choke points.
- Immediate blockers: terrain in front, temporary walls, steep vertical deltas, crowding.
- Current objective progress: distance and estimated travel time, not only straight-line distance.

### UtilityIntent

Scores possible intents every think interval:

- Capture enemy flag.
- Carry flag home.
- Escort allied carrier.
- Return dropped friendly flag.
- Intercept enemy carrier.
- Defend base.
- Fight local enemy.
- Peel for support or low-health ally.
- Retreat, heal, or reposition.
- Regroup.

The winning intent should include a reason string for debugging, such as `intercept_carrier:enemy_near_mid`, `save_lifeline:low_value`, or `repath:blocked_front`.

### PathPlan

Converts the selected intent into a route and short-term steering target:

- Select a lane or route branch based on travel time, danger, role, and blocked-lane memory.
- Plan over route graph nodes with edge costs instead of only stepping to the next primary-route node.
- Validate short segments against collision data before committing.
- Use local avoidance probes when the direct steering vector is blocked.
- Replan when progress stalls, the target moves, a temporary wall appears, or the lane becomes too dangerous.

### CombatPlan

Chooses target and stance:

- Focus carrier, low-health enemy, threat to carrier/support, or target already pressured by allies.
- Prefer targets with line of sight, but allow pursuit to last-known positions when valuable.
- Choose stance: close, kite, strafe, hold cover, escort, block, retreat.
- Penalize fighting while carrying unless the enemy is blocking the route home.

### AbilityPlan

Scores ability casts by opportunity value minus cooldown/resource cost:

- Heal value is missing health actually restored, weighted by target importance and death risk.
- Wall value is blocked damage, protected carrier route, denied choke, or forced enemy detour.
- Mobility value is saved travel time, escape probability, or reachability of an objective.
- Damage value is expected hits, target priority, cluster size, and whether the target can be killed.
- Ultimate value requires match impact: carrier swing, multi-target fight, objective denial, or capture enable.

## Phase 1: Extract And Measure The Bot Brain

Move bot decision logic into a dedicated server-side bot module with pure functions for blackboard building, intent scoring, target selection, route scoring, and ability scoring.

Work items:

- Define plain input/output types for bot context, team tactics, route plans, action plans, and debug reasons.
- Keep the room responsible for authoritative state mutation, movement command enqueueing, and ability execution.
- Add a headless bot decision test harness that can construct synthetic match states without opening a browser.
- Add scenario fixtures for wall-blocked routes, stolen flags, dropped flags, low-health ally clusters, enemy carrier interception, and temporary wall obstructions.
- Remove duplicated or superseded legacy helper code as each extracted replacement becomes active.

Acceptance criteria:

- Bot intent and ability decisions can be tested without starting a client.
- A test can assert not only the chosen action but the reason and score components.
- Existing bot behavior still works while the extraction is incomplete.
- Once the new path covers a decision, the old equivalent branch is removed.

## Phase 2: Navigation That Knows When It Is Failing

Replace direct target steering with route planning plus local avoidance.

Work items:

- Build a route graph adapter from existing map lanes, route nodes, and tactical slots.
- Add A* or Dijkstra over route graph edges with dynamic costs for danger, crowding, carrier state, temporary walls, and role.
- Add a short forward collision probe before setting movement input.
- If the direct vector is blocked, sample left/right tangent probes and choose the clearest progress direction.
- Track per-bot movement progress over time: desired target, expected progress, actual progress, blocker direction, and failed edge.
- Mark blocked edges with a short TTL so other bots can avoid them without permanently poisoning the route.
- Use the existing unstuck system only as a last resort, not primary navigation.

Acceptance criteria:

- A bot approaching a wall chooses a side route or tangent movement before spending repeated ticks walking into it.
- A temporary wall can cause a bot to pause, flank, jump, or choose another edge.
- Multiple bots near a choke avoid standing inside each other and blocking the whole team.
- Route choice changes when carrying the flag versus attacking the enemy flag.

## Phase 3: Team Tactics And Role Assignment

Add low-frequency team-level decision making so bots do not all independently choose the same obvious target.

Work items:

- Assign dynamic roles from match state: runner, escort, interceptor, defender, support, fighter.
- Use hero suitability as a preference, not a hard lock. A Chronos can escort or defend; Phantom and Hookshot prefer runner/interceptor; Blaze prefers fighter/area denial.
- Limit duplicate jobs. For example, one bot returns a dropped friendly flag while another escorts or zones.
- Add carrier support rules: nearby allies escort, far allies intercept threats or clear route ahead.
- Add base defense rules that include enemy proximity, flag status, respawn timing, and whether another defender already exists.

Acceptance criteria:

- In a 4v4 bot match, bots split between attack, defense, support, and escort instead of clustering on the same route.
- When an ally takes the flag, at least one nearby bot changes to escort or route-clear behavior.
- When the friendly flag drops, one reachable bot prioritizes return while others cover.

## Phase 4: Support And Healing Intelligence

Make Chronos behave like a support-tank instead of a heal button with legs.

Work items:

- Add ally health debt to the blackboard: missing health, danger, distance, line of sight, carrier status, role, and whether the ally is retreating or actively fighting.
- Score Lifeline as actual expected healing, not target count alone.
- Require minimum value before spending a charge. Suggested normal baseline: at least 65-80 effective ally healing, or one critical ally below 35% health, or carrier below 70% while threatened.
- Prefer multi-target heals when two or three allies are damaged and reachable soon.
- Let Chronos move toward heal clusters when a high-value heal is likely but just outside radius.
- Let Chronos save a charge if only one ally is missing trivial health.
- Use self-heal only when Chronos is meaningfully damaged and not about to produce a better ally heal.
- Use Aegis when it can block a known attack line and an ally is actually behind the shield plane, especially a carrier or low-health teammate.
- Use Timebreak for peel: enemies close to support, enemies chasing carrier, or a high-threat enemy entering close range.

Acceptance criteria:

- Chronos does not spend Lifeline on a teammate missing tiny health.
- Chronos heals multiple damaged allies when they are clustered.
- Chronos self-heals under pressure only when ally heal value is lower.
- Chronos positions closer to teammates instead of drifting away from its support role.

## Phase 5: Hero-Specific Tactical Controllers

Move each hero's abilities behind a small controller that returns scored ability candidates.

### Phantom

- Blink toward flanks, cover, last-known carrier intercepts, or escape vectors.
- Avoid blinking into collision or into the middle of multiple enemies.
- Use shield when a fight is already committed or a carrier duel is imminent.
- Use veil for objective pressure, escape while carrying, or sneaky return routes.

### Hookshot

- Grapple to validated anchor points that improve route progress or escape.
- Use anchor wall to block enemy line of sight, protect carrier routes, split a choke, or deny a direct chase.
- Avoid dropping walls that block the friendly carrier's route.
- Use trap on flags, dropped flags, choke points, and predictable carrier paths.

### Blaze

- Use flamethrower only when the target is close, visible, and likely to stay inside the cone.
- Rocket jump for high-value repositioning, escape, vertical shortcuts, and chasing carriers.
- Bomb clustered enemies, cover exits, and flag pads rather than isolated low-value targets.
- Ultimate when it can affect multiple enemies or force objective movement.

### Chronos

- Use Lifeline, Aegis, Timebreak, and Ascendant according to the support rules above.
- During Ascendant, switch into aerial pressure only when it helps peel, finish, or objective deny.

Acceptance criteria:

- Ability logs show a tactical reason for every bot ability cast.
- Failed casts due to no target or invalid geometry become rare and measurable.
- Hard bots use abilities more decisively, while easy bots keep simpler and more delayed decisions.

## Phase 6: Perception, Memory, And Fairness

Make bots aware without making them unfair.

Work items:

- Keep direct line-of-sight and close reveal rules.
- Add last-known enemy memory with expiry and uncertainty radius.
- Use recent damage source to turn, seek cover, or pursue, even when the attacker leaves sight.
- Represent hidden/veiled enemies as unknown unless close, carrying the flag, or revealed by combat.
- Track loud events such as rockets, bombs, traps, and ultimates as approximate points of interest.

Acceptance criteria:

- Bots can chase a carrier around a corner briefly but do not track invisible enemies forever.
- Bots respond to being shot from behind by turning, taking cover, or repositioning.
- Veiled Phantom still works against bots outside close reveal and combat reveal rules.

## Phase 7: Difficulty And Personality

Make difficulty affect decision quality, not only aim quality.

Work items:

- Easy: slower replans, more direct routes, higher heal waste tolerance, weaker focus fire, shorter memory, less ability comboing.
- Normal: balanced route choice, basic team roles, reasonable heal thresholds, simple escort and interception.
- Hard: better lane selection, lower wasted healing, coordinated focus fire, stronger carrier escort, better ability combos, faster recovery from blocked routes.
- Add personality modifiers from bot profile: aggressive, cautious, defender, flanker, bodyguard, support-first.

Acceptance criteria:

- Hard bots visibly avoid repeated bad decisions that easy bots may still make.
- Difficulty does not grant impossible perception or illegal movement.
- Bot profiles affect style without breaking team needs.

## Phase 8: Debugging And Telemetry

Make bot intelligence visible to engineers through logs, counters, and optional debug snapshots.

Add metrics:

- `bot.intent.selected`
- `bot.intent.score`
- `bot.route.replanned`
- `bot.route.blocked_edge`
- `bot.stuck.recovered`
- `bot.ability.cast`
- `bot.ability.rejected`
- `bot.ability.saved_for_value`
- `bot.heal.effective_amount`
- `bot.heal.wasted_amount`
- `bot.team.role_assignment`
- `bot.tick.budget_deferred`

Add per-bot debug snapshots:

```ts
{
  intent,
  role,
  targetId,
  routeNodeId,
  movementTarget,
  abilityPlan,
  topScores,
  reason,
  stuckState
}
```

Acceptance criteria:

- A bad bot decision can be explained from a debug snapshot.
- Heal waste and blocked-route recovery can be measured across a match.
- AI budget deferral never silently turns active bots into idle targets.

## Phase 9: Verification Plan

Do not use browser testing for this task; leave that to the user.

Add headless checks:

- Bot decision unit tests for intent scoring, target scoring, healing thresholds, and ability value.
- Route planner tests over synthetic route graphs and generated map manifests.
- Movement recovery tests where the direct path is blocked by terrain or a temporary wall.
- CTF scenario tests with scripted match states: enemy carrier, dropped friendly flag, allied carrier under pressure, grouped damaged allies, and base defense.
- Room-load benchmark variant with 8 active bots and frequent temporary walls.

Run code-level checks:

- `pnpm --filter @voxel-strike/server typecheck`
- `pnpm --filter @voxel-strike/shared test:maps`
- `pnpm --filter @voxel-strike/physics test:movement`
- A new server bot AI test script once added.
- The room-load benchmark after tactical pathfinding is enabled.

Manual checks for the user:

- Watch a bot approach a wall and confirm it reroutes instead of pushing into it.
- Damage one ally slightly and confirm Chronos saves Lifeline.
- Damage two or three allies enough and confirm Chronos moves into range and heals them.
- Steal a flag and confirm nearby friendly bots escort or clear the route.
- Drop the friendly flag and confirm one bot returns it while another covers.
- Place or trigger temporary walls near a choke and confirm bots replan.

## Implementation Order

1. Add a bot AI test harness and extract pure decision helpers.
2. Add decision debug reasons and metrics around the existing bot brain.
3. Implement team tactics and dynamic role assignment.
4. Replace direct semantic target steering with route graph planning and local avoidance.
5. Add blocked-path memory and temporary wall route costs.
6. Replace ability cadence checks with utility-scored ability plans.
7. Implement Chronos support triage first, because it directly addresses wasted heals and team value.
8. Add hero-specific controllers for Hookshot, Blaze, and Phantom.
9. Tune difficulty profiles for tactical differences.
10. Remove superseded legacy bot branches once each replacement is covered by tests.
11. Run typecheck, headless bot tests, map tests, movement tests, and room-load benchmark.

## Rollout Strategy

Use a server-side feature flag while replacing behavior:

- `legacy`: current bot brain.
- `shadow`: compute new decisions and log differences, but execute old decisions.
- `hybrid`: execute new intent/path decisions while keeping old ability heuristics.
- `new`: execute the full new pipeline.

The flag is temporary. After the new pipeline passes scenarios and match-load checks, remove the legacy mode and shadow-only code.

## Success Criteria

- Bots no longer spend more than a short recovery window pushing into walls or temporary walls.
- Bots choose different roles when the match state demands it.
- Chronos effective healing rises and wasted healing drops.
- Carrier escort and flag return behavior happen without manual scripting.
- Ability rejection rates drop because bots cast only when geometry and targets are valid.
- Hard bots are smarter in navigation, team play, and resource timing, not just aim.
- Server tick time remains within the existing room budget with 8 active bots.
- The old monolithic heuristics are removed once the new tested pipeline owns the behavior.

## Risks

The main risk is overbuilding pathfinding before the tactical layer can use it. Start with route graph planning plus local probes, then deepen pathfinding only where scenarios prove it is needed.

The second risk is making bots feel unfair. Keep perception rules explicit and testable. Better bots should make better decisions from legitimate information, not see through walls or ignore stealth.

The third risk is preserving two AI systems for too long. Use shadow and hybrid modes only as migration tools, then delete legacy code after the new scenarios pass.
