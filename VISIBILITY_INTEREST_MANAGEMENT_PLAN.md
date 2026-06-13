# Visibility Interest Management Plan

## Reader And Outcome

This plan is for an engineer hardening Opus Strike against passive client cheats such as wallhacks, ESP overlays, and enemy radar.

After reading it, the engineer should be able to implement recipient-aware server replication so a normal client only receives enemy state it is allowed to know, while keeping room CPU and bandwidth within the current real-time budget.

## Problem

The current client can be modified to read remote player state from replicated streams and draw enemy positions, health, ability state, and flag state outside the intended UI. Client-side minimap filters and render choices do not protect this information because the data has already arrived.

The durable fix is server-side information control:

- Do not send precise enemy transforms to a recipient unless that recipient can legitimately perceive or infer that enemy.
- Do not send hidden enemy vitals, ability activity, or cooldown data unless the design intentionally reveals it.
- Keep objective and combat rules server-authoritative.
- Preserve smooth rendering for visible combatants.

## Goals

- Make passive radar and wallhack cheats much harder by withholding exact hidden enemy state.
- Keep visible enemies responsive enough for aiming, hit feedback, and readability.
- Keep teammates fully visible unless a future game mode says otherwise.
- Preserve server authority for movement, hits, projectiles, and objectives.
- Build the system incrementally behind observable metrics and feature flags.
- Avoid per-recipient, per-enemy expensive terrain tests on every server tick.

## Non-Goals

- This does not try to make browser code tamper-proof.
- This does not prevent aim assist against enemies already visible to the client.
- This does not hide static map geometry, because the map is required for rendering and navigation.
- This does not replace movement validation, damage validation, or account-level anti-cheat.

## Current Risk Model

An attacker with a modified client can:

- Decode transform packets and render enemy locations through walls.
- Join transform data with player metadata to identify team, hero, carrier state, health, and cooldowns.
- Draw a full minimap radar even though the shipped minimap only displays teammates.
- Track invisible or veiled enemies if their exact transform and active ability state are replicated.

An attacker should still not be able to:

- Teleport freely without server correction.
- Award captures without reaching server-authoritative objective zones.
- Apply direct damage through walls when the server performs line-of-sight checks.

The mitigation focuses on the first group: passive knowledge leaks.

## Design Principle

Treat replicated enemy state as secret until the server grants interest for a specific recipient.

The server should answer one question before sending any enemy-specific state:

Can this recipient legitimately know this target right now?

If yes, send the minimum precision and frequency needed for good gameplay.
If no, send nothing, or send only intentionally designed last-known information.

## Data Classes

### Always Public

These can be sent to every player:

- Match phase and timers.
- Team scores.
- Static map seed and map theme.
- Static objective base locations.
- Public game mode rules.
- Own player state.
- Teammate state, unless future design adds teammate stealth.

### Recipient-Scoped

These must be filtered per recipient:

- Enemy transforms.
- Enemy velocity and look direction.
- Enemy health and shield state.
- Enemy ultimate charge.
- Enemy cooldowns and charges.
- Enemy active stealth state.
- Enemy spawn protection timing.
- Enemy ping if it helps identify hidden players.
- Enemy ability casts that originate from hidden positions.

### Globally Revealed By Design

These may be global if design wants them to be global:

- Flag carrier identity and approximate route pressure.
- Loud ultimate casts.
- Area hazards after creation.
- Score-changing objective events.
- Death events after they occur.

For each globally revealed event, define whether exact position, approximate position, or no position should be sent.

## Interest States

Use explicit states instead of one boolean. This keeps behavior predictable and gives tuning knobs.

### `visible`

The recipient should receive full transform and combat-relevant vitals.

Examples:

- Enemy is in direct line of sight.
- Enemy is close enough for proximity reveal.
- Enemy recently damaged or was damaged by the recipient.
- Enemy is revealed by a scan/reveal effect.
- Enemy is carrying an objective and the game design requires global tracking.

### `audible`

The recipient may receive approximate or event-only information, not precise continuous transforms.

Examples:

- Enemy fired a loud weapon nearby but is behind cover.
- Enemy used movement or ability audio in a nearby area.
- Enemy landed or impacted terrain nearby.

Payload should be coarse and short-lived: approximate origin, event type, timestamp, and uncertainty radius.

### `last_known`

The recipient may keep stale information from when the target was visible.

Examples:

- Enemy broke line of sight 400 ms ago.
- Enemy entered cover after being seen.

Payload should not update exact position while hidden. The client can fade or mark last-known state.

### `hidden`

The recipient receives no exact state and no hidden vitals.

Examples:

- Enemy is behind terrain and outside reveal/proximity rules.
- Enemy is using a stealth ability and has not broken stealth.
- Enemy is far away and not involved in an objective reveal.

## Visibility Predicate

Implement one shared server predicate:

```ts
getRecipientInterest(recipient, target, context): InterestState
```

The predicate should be deterministic and cheap in its common path.

Recommended evaluation order:

1. Self: full state.
2. Same team: full state.
3. Invalid target state: hidden unless death or respawn data is intentionally public.
4. Explicit reveal effects: visible until reveal expires.
5. Objective reveal rules: visible or approximate, depending on design.
6. Recent combat grace: visible for a short period after direct interaction.
7. Proximity reveal: visible inside a small radius, even behind light cover if desired.
8. Distance cutoff: hidden if outside maximum possible perception range.
9. Cached line of sight: visible if terrain ray is clear.
10. Last-known grace: last_known for a short fade window.
11. Hidden.

The distance cutoff matters. It prevents terrain checks for enemies that cannot possibly be visible or relevant.

## Performance Strategy

### Keep Visibility Lower Frequency Than Transforms

Do not recompute full visibility at transform-send frequency.

Recommended cadence:

- Transform stream: keep current cadence for visible targets.
- Interest updates: 5-10 Hz.
- Long-distance approximate events: event-driven only.
- Last-known expiry cleanup: 2-5 Hz or piggyback on interest updates.

At the current 8-player room size, this is comfortably small. The design should still avoid all-pairs raycasts so larger modes remain possible later.

### Use Spatial Pre-Filters

Before any terrain or line-of-sight work:

- Query nearby candidates with the existing spatial index.
- Skip same-team visibility checks because teammates are always visible.
- Skip targets outside perception range.
- Skip dead or selecting targets unless the stream intentionally exposes them.

The common hidden-far case should cost only a few arithmetic checks.

### Cache Interest Decisions

Maintain a recipient-target interest cache:

```ts
recipientId -> targetId -> {
  state,
  precision,
  expiresAt,
  lastVisibleAt,
  lastKnownPosition,
  reason
}
```

Use short TTLs:

- Direct line of sight: 100-200 ms.
- Proximity reveal: 100-200 ms.
- Recent combat: explicit expiry, usually 500-1000 ms.
- Last-known: 1000-3000 ms, depending on UX.

Keep the cache small by clearing it when players leave, change teams, die, respawn, or when map collision revision changes.

### Cache Line Of Sight Separately

Line-of-sight results can be cached by quantized start and end points. Keep TTL short enough that fast peeks do not feel stale.

Recommended:

- Quantize to coarse half-meter or meter buckets.
- TTL 100-200 ms.
- Clear on dynamic collision changes such as temporary walls.
- Cap cache size and evict oldest or clear on overflow.

### Budget The Work

Set per-room budgets and track them:

- Max interest recompute milliseconds per server tick.
- Max line-of-sight checks per interest update.
- Max transform recipients per tick.
- Max bytes per stream type per second.

If a room exceeds budget, degrade gracefully:

1. Preserve self and teammate state.
2. Preserve visible combat targets.
3. Reduce distant last-known updates.
4. Skip approximate audio-only hints.
5. Never fall back to sending hidden enemy exact transforms.

The failure mode should be less information, not insecure information.

## Replication Changes

### Player Transforms

Change transform replication from "all alive players for each client" to "allowed targets for this recipient."

For each recipient:

- Always include self on full snapshots if bootstrap requires it.
- Include teammates.
- Include enemies only when interest is `visible`.
- Optionally include `last_known` as a separate low-precision message, not as a normal transform.
- Stop sending hidden target heartbeats.

When a target becomes hidden, send a remove/hide marker or rely on a full recipient-scoped snapshot so the client can despawn/fade the remote model.

### Player Vitals

Split vitals into public and private views.

Self view:

- Full health, cooldowns, charges, ultimate, movement state, respawn state.

Teammate view:

- Usually full health, hero, state, flag status, relevant ability state.

Enemy visible view:

- Health and state only if the UI/gameplay should show it during visibility.
- Avoid sending exact cooldowns and ultimate charge unless intentionally scoutable.

Enemy hidden view:

- No vitals update, or only public scoreboard-like stats that do not reveal live position or tactical state.

### Ability Events

Ability event broadcasts need the same recipient filtering.

Visible caster:

- Send full event with precise origin and direction.

Hidden caster, loud event:

- Send approximate audio/impact event if within hearing range.
- Do not include exact caster id unless design intentionally reveals it.

Hidden caster, silent event:

- Do not send event.

Area hazards:

- Once a hazard exists in the world and can affect players, clients near or able to see it need enough data to render and avoid it.
- If a hidden caster creates a visible hazard, reveal the hazard, not necessarily the caster's exact position.

### Objective State

Objective state should be explicit by design:

- Base flag positions can remain public.
- Dropped flag positions can remain public if that is desired CTF behavior.
- Carrier identity and exact carrier transform should not automatically become global unless intended.
- If global carrier tracking is desired, consider approximate pulses instead of exact continuous transforms.

### Ping And Scoreboard Data

Avoid leaking hidden player presence through side channels:

- Do not use hidden enemy ping updates as a live presence signal.
- Do not expose hidden enemy respawn timers if that is not intended.
- Keep scoreboard stats independent from live tactical state.

## Client Changes

The client must tolerate not knowing all enemies.

Required behavior:

- Remote player models disappear or fade when the server stops granting visibility.
- Minimap reads only server-authorized teammate, visible enemy, or last-known data.
- Projectiles and ability effects can exist without a fully known caster transform.
- Last-known markers are visually distinct from live markers.
- Debug overlays should make interest state visible in development.

Do not reintroduce security decisions in the client. The client renders the stream it receives.

## Rollout Plan

### Phase 1: Instrument Only

Add server-side interest calculation but keep current replication behavior.

Record:

- How many enemies would be hidden per recipient.
- How many LOS checks were needed.
- Interest recompute time.
- Current bytes sent versus projected filtered bytes.
- Cases where visible enemies would have been hidden incorrectly.

Ship this behind a disabled-by-default flag.

### Phase 2: Transform Filtering In Shadow Rooms

Enable recipient-scoped transform filtering in development and internal test rooms.

Requirements:

- No enemy transform packets while hidden.
- Full transform resumes within the target latency budget when visible.
- Remote model cleanup works when a target leaves interest.
- No crashes when ability events arrive for partially known entities.

### Phase 3: Vitals Filtering

Split player vitals into self, teammate, visible enemy, and public views.

This phase closes the largest metadata leaks: health, ability state, cooldowns, ultimate charge, and stealth state.

### Phase 4: Ability Event Filtering

Make ability events recipient-aware.

Prioritize stealth and high-impact abilities first. Keep an allowlist of globally visible events and document the gameplay reason for each one.

### Phase 5: Last-Known And Approximate Signals

Add UX support for last-known markers and approximate audio/reveal events.

This keeps gameplay readable without sending exact hidden transforms.

### Phase 6: Production Rollout

Roll out by mode or room percentage.

Watch:

- Server tick p95 and p99.
- Event loop delay.
- Custom message bytes per room.
- Interest recompute duration.
- Player reports mentioning invisible players, ghost hits, or missing effects.
- Combat metrics such as hit rate and time-to-kill.

## Testing Plan

### Unit Tests

Test the interest predicate with table-driven cases:

- Self is visible.
- Teammate is visible.
- Enemy behind terrain is hidden.
- Enemy in LOS is visible.
- Enemy just broke LOS becomes last_known.
- Enemy after last-known expiry becomes hidden.
- Revealed enemy is visible without LOS.
- Stealthed enemy is hidden unless reveal rules apply.
- Flag carrier follows the selected objective reveal policy.

### Stream Tests

Build room-level tests that inspect outbound messages for two recipients on opposing teams.

Required assertions:

- Hidden enemy transforms are absent.
- Visible enemy transforms are present.
- Hidden enemy vitals do not include live tactical data.
- Full snapshots do not reintroduce hidden enemies.
- Removing interest removes or hides the remote entity.
- Dynamic collision revision invalidates relevant LOS cache.

### Performance Tests

Add a synthetic room benchmark:

- Full 4v4 room.
- Players spread across lanes and cover.
- All players moving.
- Mixed abilities and temporary walls.
- Interest updates enabled.

Track:

- Interest update CPU time.
- LOS checks per second.
- Transform bytes per second.
- Vitals bytes per second.
- Tick p95 and p99.

Add a stress variant with bots clustered near cover to exercise the worst LOS case.

### Gameplay Tests

Manual playtest scenarios:

- Enemy peeks from behind cover.
- Enemy crosses open sightline quickly.
- Enemy uses stealth near and far from opponents.
- Enemy fires from behind cover.
- Objective carrier moves behind cover.
- Player dies to an area effect from a hidden caster.

Expected outcome: less hidden information, no confusing missing combat feedback.

## Operational Metrics

Add room metrics:

- `interest.recompute.ms`
- `interest.los_checks.count`
- `interest.visible_targets.count`
- `interest.hidden_targets.count`
- `interest.last_known_targets.count`
- `stream.transforms.bytes`
- `stream.vitals.bytes`
- `stream.filtered_targets.count`
- `stream.hidden_target_leak.count`

The leak counter should increment only in assertions or debug builds if a hidden target is about to be sent through a protected stream.

## Implementation Notes

Keep this work vertical and incremental:

1. Add the interest model and tests.
2. Add metrics in shadow mode.
3. Filter transforms.
4. Filter vitals.
5. Filter ability events.
6. Add last-known UX.
7. Remove temporary compatibility paths once each phase is stable.

Avoid broad rewrites of gameplay logic. The core change is recipient-scoped serialization, not a new game simulation.

## Open Design Decisions

- Should flag carriers be globally exact, globally approximate, or visible only?
- Should proximity reveal ignore cover at very close range?
- How long should last-known markers persist?
- Which abilities are intentionally loud enough to reveal approximate position?
- Should enemy health bars be visible only while directly visible?
- Should spectators receive full state, delayed state, or team-scoped state?

Resolve these before production rollout because they affect both fairness and player expectations.

## Completion Criteria

The mitigation is complete when:

- A hidden enemy's exact transform is absent from that recipient's transform stream.
- A hidden enemy's live tactical vitals are absent from that recipient's vitals stream.
- Full snapshots obey the same filtering rules as incremental messages.
- Ability events do not leak hidden caster precision unless explicitly designed.
- Server performance remains inside the room tick budget under 4v4 stress tests.
- The client gracefully handles players entering and leaving interest.
- Debug tooling can explain why a target is visible, last-known, audible, or hidden.
