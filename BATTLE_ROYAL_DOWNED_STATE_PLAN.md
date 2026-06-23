# Battle Royal Downed State Plan

## Reader And Goal

Reader: an internal gameplay engineer working in the existing TypeScript, Colyseus, React, Three.js codebase.

Post-read action: implement the Battle Royal downed, crawl, revive, and final-elimination flow end to end without changing the immediate death and timed respawn behavior for Capture the Flag or Team Deathmatch.

## Behavior Contract

Battle Royal should gain a downed state between alive and eliminated:

- A Battle Royal hero who takes lethal damage while alive enters `downed` instead of becoming `dead`.
- A downed hero can crawl with reduced movement, but cannot attack, reload, use abilities, jump, sprint, slide, grapple, jetpack, glide, carry objectives, collect powerups, or revive another player.
- A downed hero has a small downed HP pool. Enemy damage while downed subtracts from that pool. Reaching zero final-eliminates the hero.
- A downed hero has a 60 second bleed-out counter. If it reaches zero, the hero is final-eliminated.
- A teammate can revive a downed hero.
- Starting a revive pauses the bleed-out counter.
- Revive takes 5 seconds.
- The reviver cannot move, attack, reload, or use abilities while channeling the revive.
- The downed target should be frozen during an active revive channel so the channel cannot slide out of range while its timer is paused.
- Completing revive returns the downed hero to alive with partial health and clears downed state.
- Only final elimination should count as a death/kill, trigger kill feed, spawn death visuals, affect match ledger, and remove the player from Battle Royal contesting.

Suggested tunable constants:

- `BATTLE_ROYAL_DOWNED_DURATION_MS = 60_000`
- `BATTLE_ROYAL_REVIVE_DURATION_MS = 5_000`
- `BATTLE_ROYAL_DOWNED_MAX_HP = 30`
- `BATTLE_ROYAL_REVIVED_HEALTH = 35`
- `BATTLE_ROYAL_CRAWL_SPEED_MULTIPLIER = 0.32`
- `BATTLE_ROYAL_REVIVE_RADIUS = 2.4`

## Current Baseline

The shared damage engine currently has one lethal outcome: it sets the target state to `dead`, sets health to 0, applies kill/death/assist credit, and returns a death resolution. Server Battle Royal passes no respawn delay during active play, which means final death has no timed respawn.

The server gates most gameplay on `state === 'alive'`: movement command intake, per-tick ability cooldowns and passive ultimate charge, attacks, ability casts, safe-zone damage, hookshot pulls, bot decisions, transform replication, visibility interest, and last-team-alive match end.

The client normalizes a fixed player-state set and uses player vitals as the main live lifecycle stream. Death visuals are driven by final kill events and dead-state vitals. Remote hero bodies are rendered by both a fallback full-body component and a batched instanced renderer, with body poses assembled from idle, walk, crouch, slide, jump, and attack blends.

This means the implementation should treat `downed` as a real player lifecycle state, not as a cosmetic flag layered over `alive` or `dead`.

## Data Model And Network Contract

Add `downed` to the shared player state union and every state normalizer.

Add Battle Royal downed metadata to shared player snapshots and vitals:

- `downedHealth`
- `downedMaxHealth`
- `downedStartedAt`
- `downedRemainingMs`
- `downedExpiresAt`
- `reviveStartedAt`
- `reviveCompletesAt`
- `reviveByPlayerId`

Use `downedRemainingMs` as the authoritative paused-clock value. When no revive is active, derive `downedExpiresAt` from `now + downedRemainingMs`; when a revive starts, store remaining time and clear or freeze the deadline.

Add server-to-client events for lifecycle moments that need immediate UI/audio/visual response:

- `playerDowned`: sent when lethal alive damage becomes downed.
- `playerReviveStarted`: sent when a valid revive channel starts.
- `playerReviveCancelled`: sent when an active revive channel stops before completion.
- `playerRevived`: sent when revive completes.

Keep `playerKilled` as the final-elimination event. Do not overload it for downing.

For enemy redaction:

- Teammates and self receive full downed metadata.
- Visible enemies may receive `state: 'downed'` plus downed HP if the existing health visibility rules allow it.
- Hidden or last-known enemies should not leak exact downed metadata.
- Battle Royal dead spectators should continue to be restricted from enemy state unless they are spectating teammates through existing rules.

## Server Lifecycle

Introduce a small Battle Royal downed lifecycle runtime rather than spreading timer math through the main room class. The runtime should own:

- Transition alive to downed.
- Apply damage to downed players and final-eliminate at zero downed HP.
- Track bleed-out remaining time.
- Pause/resume bleed-out around revive channels.
- Complete revive.
- Cancel revive on invalid conditions.
- Produce event payloads and vitals fields.

Damage flow:

1. Non-Battle Royal modes continue using the shared damage engine exactly as they do now.
2. Battle Royal alive lethal damage resolves to downed, not death.
3. Battle Royal downed damage bypasses normal health and subtracts downed HP.
4. Battle Royal downed HP <= 0 or bleed-out timer <= 0 calls the existing final-death side effects.
5. Safe-zone damage should apply to alive and downed Battle Royal players. Alive safe-zone lethal damage downs first; downed safe-zone damage can final-eliminate.

Refactor the shared damage result shape so lethal alive damage can return either a downed resolution or a death resolution. Keep final kill/death/assist credit in one place to avoid duplicated stat logic. Remove the current Battle Royal immediate-death branch once the downed path replaces it.

Reset and cleanup:

- On entering downed, clear active abilities that should not persist, stop movement abilities, clear carried objectives, stop hookshot pulls, stop roots that imply upright movement, and cancel ability holds.
- On revive, use the existing alive-reset helper where appropriate, but do not reset all ability cooldowns as if this were a respawn.
- On final elimination, use the existing life-reset and ledger side effects already used by death.
- On round/game reset, clear downed and revive metadata.

## Revive Runtime

Use the existing `interact` input for revive start/hold.

Revive start conditions:

- Gameplay mode is Battle Royal.
- Phase is active playing.
- Reviver is alive.
- Target is downed.
- Same team.
- Target is not already being revived by another teammate.
- Reviver is within `BATTLE_ROYAL_REVIVE_RADIUS`.
- Optional line-of-sight check passes if the current interaction systems already have a cheap server-side helper.

Revive continuation conditions:

- Reviver keeps holding interact.
- Reviver and target stay in valid states.
- Reviver remains in range.
- Reviver does not send movement, jump, sprint, crouch, attack, reload, ability, or ultimate input.
- Target is not final-eliminated.

Cancellation should resume the target's bleed-out counter from the stored remaining time.

Completion should:

- Set target state to `alive`.
- Restore target health to `BATTLE_ROYAL_REVIVED_HEALTH`, capped by max health.
- Clear downed HP and revive metadata.
- Clear target velocity and movement-only ability state.
- Release reviver action lock.
- Broadcast `playerRevived`.

Implementation detail: prefer a dedicated revive action lock over reusing root. Existing root suppresses locomotion and some movement abilities, but revive needs to block all combat and ability input as well.

## Movement And Crawl

Allow movement command intake for `downed`, but route it through a downed input sanitizer:

- Keep look yaw and pitch.
- Keep horizontal movement input.
- Clear jump, crouch, sprint, primary, secondary, reload, ability1, ability2, ultimate, and interact for the downed target.
- If the downed target is actively being revived, clear horizontal movement too.

Server movement should apply a crawl speed multiplier and forcibly clear airborne/mobility states. The simplest safe first pass is to reuse the current movement simulation with sanitized input and reduced max speed, while keeping the gameplay hit capsule unchanged until collision and hitbox tuning is intentionally revisited.

Client local prediction should mirror the same sanitizer and crawl multiplier so downed local players do not rubber-band. Movement traces and anti-cheat parity should label downed crawl as its own movement class so it does not trip normal sprint/crouch/jump expectations.

Replication and visibility:

- Include downed players in transform replication.
- Include downed players in visibility interest as valid targets.
- Continue excluding final-dead players from live transform streams.
- Treat downed players as contesting Battle Royal players for remaining-player counts and match end.

## Match End And Spectating

Update Battle Royal match-end logic from "teams with alive players" to "teams with contesting players." A contesting player is alive, downed, dropping, or spawning during Battle Royal pre-active transitions. A final-dead player is not contesting.

This prevents a team with a downed member from losing until that member is finished or bleeds out.

Update Battle Royal team spectator target selection so dead local players can spectate alive or downed teammates. If a teammate is downed, camera height should be lower and behind the crawl pose rather than using the standing target height.

## Client State And Event Handling

Update client state parsing:

- Add `downed` to the accepted player state set.
- Parse downed and revive metadata from vitals.
- Preserve local prediction only when the incoming and existing states are both `alive`; downed state should force authoritative sync.
- Do not create death visuals for `downed`.
- Create death visuals only for final `dead` or `playerKilled`.
- Clear active local ability prediction and viewmodel hold state when local player becomes downed.

Add UI reactions:

- Local downed overlay with bleed-out countdown and downed HP.
- Revive progress indicator for the downed target.
- Revive channel progress indicator for the reviver.
- Teammate prompt near a downed ally using the existing interact keybind label.
- Nameplate state styling for downed teammates.
- Battle Royal top HUD remaining count includes downed players.
- Ability bar and combat widgets are hidden or disabled while local player is downed or reviving.
- Crosshair and active targeting overlays are hidden while downed or reviving.

Keep kill feed text tied to final elimination. If a separate "knocked" feed is desired later, add it as a distinct feed type rather than reusing eliminations.

## 3D Body Pose And Crawl Animation

Add downed pose support to both full-body render paths:

- The non-instanced full-body hero component.
- The batched remote hero renderer.

Extend hero pose inputs with state-driven flags:

- `isDowned`
- `isCrawling`
- `isReviving`
- `isBeingRevived`

Add pose functions to the hero body pose system:

- `applyDownedBonePose`: a prone whole-body pose with torso close to the floor, head lifted slightly, arms forward/braced, legs tucked or trailing.
- `applyCrawlBonePose`: a looping crawl motion driven by horizontal movement speed and walk direction, alternating elbows and knees.
- Optional `applyRevivePose`: a kneeling/braced channel pose for the reviver.

Update pose blend keys so transitions between standing, downed idle, crawl, revive, and final dead are smooth.

Update body anchoring:

- Add a downed visible-height and nameplate offset.
- Make combat text and revive prompts anchor above the prone body instead of standing height.
- Ensure team outline and Battle Royal silhouette rendering still applies to downed bodies.

Remote batch renderer notes:

- Add downed/crawl blend fields to each per-player runtime.
- Include state in the runtime pose key.
- Prewarm resources for downed bodies the same way Battle Royal currently prewarms hidden player resources.
- Keep socket registration valid, but ability socket effects should be blocked while downed.

## Audio And Feedback

Add or reuse short feedback cues:

- Downed impact cue for the local player.
- Teammate downed cue.
- Revive start/loop/complete/cancel cues.
- Final elimination cue remains the existing kill/death flow.

Avoid adding noisy global sounds for every downed enemy. Use team/local prioritization.

## Bots

Bot updates:

- Bots can become downed.
- Downed bots crawl toward the nearest safe teammate or away from nearby enemies.
- Alive bot teammates can choose revive as a high-priority behavior when safe enough.
- Bot combat target selection should include downed enemies as finishable targets.
- Bot heal/support logic should not treat downed allies as normal damaged alive allies.

Keep the first implementation simple if needed: downed bots may crawl minimally, alive bots may finish downed enemies, and bot revives can be added immediately after player revive is stable.

## Scoped Refactors

Use small helper functions to avoid scattering raw state checks:

- `isPlayerAlive`
- `isPlayerDowned`
- `isPlayerAliveOrDowned`
- `isBattleRoyalContestant`
- `canReceiveLiveTransform`
- `canUseCombatInput`
- `canUseMovementInput`
- `canUseAbilityInput`

Replace local ad hoc `state === 'alive'` checks only where downed behavior needs a different answer. Do not rewrite unrelated gameplay paths.

Remove any temporary compatibility branches once the downed path is in place. There should not be a legacy "Battle Royal lethal means dead" path left behind.

## Test Plan

No browser testing. Leave browser validation to the user.

Automated coverage to add or update:

- Shared damage tests: alive lethal damage can resolve to downed under Battle Royal policy; downed damage can final-eliminate; non-Battle Royal lethal damage still resolves to death.
- Server Battle Royal lifecycle tests: downed timer, revive pause, revive completion, revive cancel, bleed-out final elimination, enemy finish, safe-zone down and finish.
- Server match-end tests: downed players keep their team contesting; final-dead players do not.
- Server input tests: reviver movement/combat input cancels or is suppressed; downed player cannot attack or use abilities; downed crawl movement is accepted.
- Server replication tests: vitals include downed metadata; transforms include downed players; hidden enemy redaction does not leak downed metadata.
- Client message handler tests: `downed` normalizes, does not spawn death visuals, preserves final death visuals.
- Client HUD/unit tests where practical: Battle Royal remaining count includes downed players; ability widgets are disabled for downed local player.
- Model-system tests or focused render-data tests: new downed pose keys and movement pose types are accepted by both render paths.
- Typecheck all packages touched.

Suggested command sequence:

```sh
pnpm --filter @voxel-strike/shared test:damage
pnpm --filter @voxel-strike/server test:battle-royal
pnpm --filter @voxel-strike/server test:game-mode-rules
pnpm --filter @voxel-strike/server test:room-attack
pnpm --filter @voxel-strike/server test:room-ability-cast
pnpm --filter @voxel-strike/server test:replication-frame
pnpm --filter @voxel-strike/server test:player-vitals
pnpm --filter @voxel-strike/client test:visual-store
pnpm --filter @voxel-strike/client test:model-system
pnpm typecheck
```

## Implementation Order

1. Add shared state and wire metadata types.
2. Add server downed lifecycle runtime with tests for pure timer, damage, revive, and final-elimination rules.
3. Integrate lifecycle runtime into server damage resolution and remove Battle Royal immediate-death behavior.
4. Add revive input handling and revive action lock.
5. Add downed crawl movement on server and local prediction.
6. Update replication, visibility, redaction, match-end, and spectator targeting.
7. Update client state parsing and lifecycle event handlers.
8. Add HUD and prompts.
9. Add full-body downed pose, crawl animation, revive channel pose, anchors, and batch-renderer support.
10. Update bots for minimum viable behavior.
11. Run focused tests and typecheck.

## Acceptance Criteria

- In Battle Royal, lethal alive damage puts a hero into downed with downed HP and a 60 second timer.
- Downed heroes can crawl and rotate, but cannot attack, reload, use abilities, jump, sprint, slide, grapple, jetpack, glide, collect powerups, or revive.
- Enemy damage can final-eliminate downed heroes.
- Bleed-out final-eliminates after 60 seconds unless revive is active.
- Starting revive pauses bleed-out.
- Revive takes 5 seconds and restores the hero to alive with partial health.
- Reviver cannot move or use combat/abilities during revive.
- Downed players remain rendered, visible, targetable, and counted as Battle Royal contestants until final elimination.
- Final elimination still uses existing kill feed, death visual, stats, ledger, and match-end flows.
- CTF and TDM death/respawn behavior is unchanged.
