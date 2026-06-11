# Bespoke Anti-Cheat Implementation Plan

Reader: the next engineer implementing a custom anti-cheat system for the game.

Post-read action: ship a privacy-conscious, server-authoritative anti-cheat that detects impossible play, reduces exploit value in real time, protects ranked and wager outcomes, and gives operators reviewable evidence plus manual admin controls instead of automated bans.

## Outcome

The game should stop trusting the browser for any outcome that affects movement, combat, objectives, rank, or wagers.

The first production version should:

- make the server the final authority for movement, abilities, combat, objective interactions, match completion, rank updates, and wager settlement
- preserve the current client Rapier movement feel while server authority is introduced through shadow validation, measured drift budgets, and staged promotion
- turn existing authority events into a unified anti-cheat signal stream
- score suspicious behavior over time instead of punishing isolated network jitter
- correct or reject impossible actions during the match
- pause and flag ranked or wager rewards when match integrity is compromised
- persist compact evidence for review, appeal, tuning, and abuse analysis
- expose operator tooling without leaking secrets, wallet addresses, raw network identifiers, or player private data
- launch in observation mode before automatic gameplay correction or payout holds

This plan deliberately avoids kernel drivers, local file scanning, browser-extension requirements, microphone inspection, or invasive device fingerprinting. The client can contribute low-trust telemetry, but the server must remain correct if every client value is forged.

## Current State

The project already has several strong anti-cheat building blocks:

- Colyseus rooms own the live match state.
- Lobby-created game rooms use signed entry tickets with nonce checks.
- Matchmaking tickets bind user, mode, rating band, and ranked wager quote data.
- Direct game-room joins are disabled in production unless explicitly allowed.
- Game messages are schema-validated and rate-limited by session.
- Movement commands have protocol versions, sequence numbers, epochs, command caps, queue limits, and correction reasons.
- Hardened movement validation rejects invalid transforms, speed violations, blocked paths, and map-boundary escapes.
- The server already simulates shared movement for authoritative paths.
- The client Rapier movement path is the current production feel path and should be treated as fragile. Anti-cheat work must not rewrite or remove it until parity is proven with real movement traces.
- Ability handlers and many projectile or area-damage outcomes are server resolved.
- Security events are recorded in-room for movement corrections, malformed messages, rate-limit drops, objective suppression, and ability rejects.
- Ranked and wager systems already have explicit match-mode, eligibility, payment, persistence, settlement, and refund concepts.

The main gap is that these defenses are still local to individual systems. There is no durable anti-cheat domain model, no cross-match player risk profile, no ranked/wager integrity gate, no operator case workflow, and no clearly staged enforcement policy.

## Threat Model

Treat these as first-class threats:

- forged movement positions, velocities, epochs, or command sequences
- speed, teleport, wall, boundary, noclip, fly, unstuck, and collision bypasses
- client-side cooldown, ammo, fuel, charge, ultimate, reload, or cast-state manipulation
- forged projectile impacts, area damage, or hit claims
- objective abuse, including flag pickup or capture immediately after correction, teleport, knockback, or invalid movement
- replayed tickets, duplicate sessions, direct room joins, and guest identity abuse
- message flooding, malformed packet floods, and latency manipulation
- ranked and wager reward farming through invalid match states
- automated input, aim assist, macros, and botting patterns
- collusion and intentional no-contest abuse in ranked or wagered matches

Do not try to solve client memory inspection, third-party process detection, or operating-system level tamper resistance in the first version. Browser games lose that fight by design.

## Core Principles

Server authority beats client inspection. If a value changes the match result, compute or validate it on the server.

Corrections are not punishments. Players can experience packet loss, clock drift, low frame rate, and desync. Use corrections to preserve match integrity, then use repeated evidence to classify behavior.

Deterministic impossibility can be corrected or rejected automatically inside the match. Account-level punishment is manual-only in the first version: cases are flagged for review, and authorized admins can suspend or ban from the admin UI.

Ranked and wagered matches need stricter gates than casual matches. A suspicious casual player can be corrected in place; a suspicious ranked or wagered match may need reward suppression or no-contest handling.

Privacy is part of the product. Store the evidence needed to explain decisions, not broad device surveillance data.

Movement feel is a launch-critical dependency. The anti-cheat migration must preserve current client Rapier responsiveness while server authority is measured, tuned, and rolled out behind mode-specific gates. Do not flip strict movement enforcement globally until legal slide, bhop, grapple, rocket jump, teleport, knockback, unstuck, and flag-route traces stay inside the accepted drift budget.

## Target Architecture

Add a server-side anti-cheat subsystem with five parts:

| Component | Responsibility |
| --- | --- |
| Signal collector | Receives normalized events from room auth, movement, combat, abilities, objectives, matchmaking, ranked, wager, and rate-limit systems. |
| Rule engine | Converts events into deterministic violations, suspicion signals, player risk score changes, and match integrity flags. |
| Enforcement policy | Chooses real-time corrections, action rejection, objective suppression, ranked/wager payout holds, review outcomes, and manual admin account actions. |
| Evidence store | Persists compact event timelines, score changes, enforcement actions, and review metadata. |
| Operator review | Lets trusted operators inspect cases, reverse actions, tune thresholds, and export anonymized false-positive samples. |

The anti-cheat subsystem should not own gameplay rules. Gameplay systems stay authoritative and emit facts. Anti-cheat decides whether the facts are impossible, suspicious, or reward-blocking.

## Signal Model

Normalize every anti-cheat input into a common event shape:

- event id
- event type
- source system
- room id
- match id when known
- lobby id when known
- match mode
- user id when authenticated
- player session id
- team
- hero id
- server tick
- server time
- movement epoch and sequence when relevant
- severity
- confidence
- reason
- compact details payload
- retention class

Recommended event categories:

- `auth`: invalid ticket, expired ticket, nonce replay, user mismatch, direct join rejection, duplicate session
- `network`: rate-limit drop, malformed message, impossible packet shape, command flood, stale command flood
- `movement`: invalid transform, speed limit, blocked path, bounds escape, epoch mismatch, queue overflow, correction burst
- `combat`: rejected attack, impossible range, line-of-sight failure, damage cap hit, duplicate impact, stale cast id
- `ability`: cooldown reject, resource reject, invalid target, impossible teleport, disabled development command, cast-state mismatch
- `objective`: pickup suppressed, capture suppressed, carrier mismatch, capture after hard correction, flag interaction out of radius
- `ranked`: ranked eligibility blocked, suspicious participant, no-contest integrity reason
- `wager`: payout paused, refund held, settlement review required, roster/payment mismatch
- `client_hint`: version mismatch, build hash mismatch, telemetry gap, prediction drift, suspicious input cadence

Client hints must never be enough for an automatic ban. Use them to prioritize review or trigger stricter server-side scrutiny.

## Server Authority Plan

Move toward input-only authority through a compatibility-first migration. The goal is not to break the current client Rapier controller; it is to make the server capable of rejecting impossible outcomes while the client keeps providing responsive local movement.

Start with shadow authority:

- keep the current client Rapier movement and local prediction path unchanged
- continue accepting the current client transform proposal path where the game already depends on it
- run server simulation or envelope validation beside it and record drift without enforcing new corrections
- capture legal movement traces from real play and harnesses
- tune hero-specific tolerances from observed legal movement, not guesses
- gate objective, ranked, and wager outcomes with only high-confidence impossibility checks during this phase

Do not let new server movement simulation influence live corrections, objectives, ranked rating, wager settlement, or payout holds until the trace-replay parity gate exists and passes. Server simulation work may proceed only in offline replay, smoke-test, or observe-only shadow mode before that gate.

Promote authority gradually:

- accept client input commands as the long-term source of truth, but only after server/client drift stays within budget
- send authoritative acknowledgements, corrections, movement epochs, and state snapshots back to the client
- keep local prediction on the client as visual responsiveness
- remove or downgrade client position and velocity proposals from ranked and wagered matches only after the compatibility budget is met
- keep any transitional transform proposal path behind a strict environment flag and never allow it alone to decide objectives, ranked rating, or wagers

Strict input-only movement is a destination, not the first implementation step. If the server simulator disagrees with client Rapier on a legal move, the anti-cheat system should record a compatibility failure, not punish the player.

For movement:

- use hero-specific movement envelopes derived from shared hero stats and active effects
- validate sequence order, command rate, command gaps, stale epochs, and queue overflows
- reject non-finite values and impossible look values before they reach simulation
- treat teleports, knockbacks, respawns, and unstuck actions as explicit authority barriers
- suppress objective interactions briefly after hard corrections, teleports, knockbacks, and unstuck actions
- record repeated corrections as scoreable signals, not immediate bans
- classify server/client movement drift separately from cheating until the movement compatibility phase is complete

## Movement Trace-Replay Parity Gate

Before server-side movement simulation can progress beyond offline replay or observe-only shadow mode, prove parity against the current client Rapier feel with a trace-replay harness.

Required trace recorder:

- records input command sequence, buttons, look yaw, look pitch, and client timestamp
- records client Rapier position, velocity, and movement flags at the same sequence boundary
- records hero id, active ability state, flag-carrier state, health/state transitions, terrain/contact state, movement epoch, and latest server acknowledgement
- samples traces in development, staging, and production observation mode without storing secrets, wallet addresses, names, or raw network identifiers
- writes bounded, versioned trace files that can be replayed deterministically

Required replay harness:

- feeds the recorded command stream into the server simulator or envelope validator by movement sequence, not wall-clock time
- compares server-predicted position, velocity, movement flags, correction reasons, and objective suppression outcomes against the recorded Rapier trace
- produces machine-readable pass/fail output and a human-readable drift report
- separates compatibility drift from cheat detection results
- can replay both legal traces and malicious traces without a browser

Required trace corpus:

- a small committed smoke corpus for every pull request
- a larger legal movement corpus for nightly, pre-release, or release-candidate checks
- malicious traces for teleport, speed spike, blocked-path traversal, stale epoch spam, duplicate command spam, and impossible objective interaction
- legal traces for slide, bhop, grapple, rocket jump, teleport abilities, knockback, respawn, unstuck, and flag routes

This gate passes only when:

- the smoke corpus passes in CI
- the full legal corpus stays inside documented position, velocity, movement-state, correction-frequency, and objective-suppression budgets
- malicious traces fail for the expected reasons
- live observation drift percentiles are stable across heroes, maps, frame-rate bands, and ping bands
- failures produce actionable reports rather than ambiguous pass/fail noise

If this gate fails, the plan must stop at observation mode for movement authority. Other anti-cheat slices can continue, but strict movement enforcement and ranked/wager movement-integrity decisions must not proceed.

## Movement Compatibility Budget

Before strict movement authority can affect ranked rating, wager settlement, or outcome holds, define and prove a compatibility budget.

Track these values per player and per movement mode:

- server-predicted position versus client Rapier position
- server-predicted velocity versus client Rapier velocity
- correction count and correction distance
- command queue length and command delay
- ping and packet burst context
- hero id, active ability state, flag-carrier state, and current terrain/contact state

Legal movement classes that need explicit traces:

- walking, sprinting, crouching, sliding, slide jumping, and bhop chains
- wall running, ledge mantling, gliding, and falling
- Hookshot grapple attach, swing, release, drag hook, trap pull, and anchor wall interactions
- Blaze rocket jump, bomb knockback, flamethrower movement state, and ultimate area pressure
- Phantom blink, shadow step, invisibility transitions, and teleport authority barriers
- Chronos time effects, shields, heals, and any movement-tempo modifiers
- flag pickup, carry slowdown, return, capture, respawn, knockback, and unstuck

Suggested promotion gates:

- observation mode has covered normal play plus targeted movement harnesses
- false-positive hard corrections are below the agreed threshold for each hero
- legal movement traces stay within position and velocity drift budgets
- ranked and wager matches have a stricter but proven budget
- every remaining correction reason has an explainable player-facing recovery path

Until those gates pass, movement anti-cheat should prefer evidence collection, objective suppression for deterministic impossibility, and post-match integrity review over hard enforcement.

For abilities and combat:

- make the server mint cast ids and own cast lifetimes
- reject client messages that reference unknown, expired, duplicated, or mismatched cast ids
- resolve hits, ranges, line of sight, area damage, fuel, ammo, reload, charge windows, cooldowns, and ultimate charge on the server
- treat projectile-impact messages from clients as visual acknowledgements or migration-only compatibility, not damage authority
- cap source-to-target damage per window based on hero kit and active buffs
- record impossible combat attempts separately from normal misses or cooldown rejects

For objectives:

- compute flag pickup, drop, return, and capture exclusively from server positions
- reject objective interactions while the player is suppressed by recent correction or authority barrier
- record carrier mismatches and impossible capture timing as high-severity match-integrity events
- block ranked and wager finalization when objective abuse could have changed the result

## Risk Scoring

Use layered scoring so the system is firm on impossible facts and forgiving around ordinary desync.

Suggested score bands:

| Score | Meaning | Default action |
| ---: | --- | --- |
| 0-24 | Normal noise | No action beyond corrections. |
| 25-49 | Suspicious | Increase telemetry, mark for post-match review, no player-facing action. |
| 50-74 | Match integrity risk | Pause and flag ranked/wager rewards for that player or match when causally relevant. |
| 75-89 | Severe repeated abuse | Create a high-priority admin case and keep ranked/wager payouts paused pending review. |
| 90+ | Deterministic exploit or repeated severe abuse | Create an urgent admin case; authorized admins may manually suspend or ban after review. |

Score changes should decay over time. Decay casual-match noise faster than ranked or wagered-match evidence. Store enough detail to explain why the score changed.

Example severity guidance:

- low: isolated malformed message, one stale command burst, one correction during high latency
- medium: repeated speed corrections, repeated queue overflow, repeated cooldown spam, suspicious input cadence
- high: bounds escape, blocked-path traversal, duplicate impact spam, objective after hard correction, cast id forgery
- critical: ticket replay, direct production join bypass attempt, deterministic impossible movement repeated after correction, forged wager/ranked state

## Enforcement Policy

Implement enforcement in stages:

1. Observation mode records signals and scores but takes only existing gameplay-corrective actions.
2. Soft mode adds player-facing corrections, action rejection, objective suppression, and ranked/wager integrity flags.
3. Ranked review mode pauses ranked rating application and wager settlement when evidence crosses configured thresholds, then exposes the hold in the admin UI.

There is no automated ban stage in the first version. The system may correct impossible gameplay and pause affected outcomes, but account-level punishment requires a human admin action from the review UI.

Recommended first automatic gameplay and outcome actions:

- reject malformed or impossible messages
- correct invalid movement
- suppress objective interactions after authority barriers
- deny development commands outside development mode
- honor existing manually applied ranked or account restrictions
- mark a ranked or wagered match as `review_required` when integrity failure could change the outcome
- pause wager payout, refund, and settlement decisions until an operator resolves the review

Recommended operator review actions in this version:

- releasing, refunding, or canceling paused wager payouts
- applying, clearing, or reversing ranked rating changes before they become visible
- suspending a user for a finite duration with a required reason and evidence link
- permanently banning a user with a required reason, evidence link, and elevated admin role
- lifting a suspension or ban with a required reason
- annotating a case, marking it false positive, or escalating it

Do not build automated account suspension, automated bans, device association, or automatic queue-lock controls in the first version.

## Ranked And Wager Integrity

Ranked and wagered matches need explicit anti-cheat gates.

A match can apply ranked rating or wager settlement only when:

- the match mode allows it
- every participant has a valid authenticated identity required by the mode
- the game room was created from a valid lobby flow
- every ranked/wager participant passed payment and roster requirements
- no participant has an unresolved critical anti-cheat case for the current match
- no team benefited from a high-confidence integrity event that could affect the result
- the match end state is valid and persisted exactly once

When the gate fails:

- pause ranked rating updates before they become visible
- pause winner payout settlement and any refund decision
- mark the match as `review_required` with an integrity reason
- persist the anti-cheat evidence and enforcement reason
- expose the paused ranked/wager outcome in the admin UI with affected players, teams, payment ids, payout amount, reason, and evidence links
- notify the client with a neutral match-integrity message, not detection internals

Do not expose exact thresholds or rule internals in client messages.

## Data Model Plan

Add durable anti-cheat records.

Recommended models:

- `AntiCheatSignal`: immutable normalized event with severity, confidence, compact details, and retention class
- `AntiCheatPlayerProfile`: current decayed score, review flags, and last signal timestamps
- `AntiCheatMatchIntegrity`: match-level integrity status, no-contest reason, affected teams, ranked/wager impact, and resolver metadata
- `AntiCheatPayoutHold`: paused wager payout, refund, or settlement decision with payment ids, payout amount, integrity reason, evidence references, and resolution state
- `AntiCheatAccountAction`: manual suspension, ban, lift, reversal, actor id, reason, evidence references, timestamps, and expiration when applicable
- `AntiCheatAction`: correction, objective suppression, ranked hold, payout hold, payout release, refund decision, reversal, and operator notes
- `AntiCheatCase`: grouped signals for review, state, priority, assigned operator, resolution, and appeal marker

Retention:

- keep low-severity raw signals briefly
- keep summarized counters longer
- keep high-severity cases and enforcement actions long enough for appeals and fraud analysis
- hash or redact network identifiers with a rotating server-side salt
- never store wallet addresses in anti-cheat payloads when a user id or payment id is enough

## Admin And Observability

Operators need an explainable dashboard.

Minimum views:

- live signal rate by type, match mode, and severity
- player case timeline with room, match, hero, score deltas, and enforcement actions
- match integrity timeline for ranked and wagered matches
- paused payout queue showing held winner payouts, held refunds, affected payment ids, amounts, reasons, age, and linked evidence
- manual account action controls for suspend, ban, lift suspension, lift ban, and view action history
- false-positive review queue
- threshold configuration and rollout mode
- exportable anonymized samples for harness tests

Minimum metrics:

- anti-cheat signals by type and severity
- corrections by reason
- rejected combat or ability actions by reason
- ranked outcomes paused by integrity reason
- wager payouts paused, released, refunded, or canceled by integrity reason
- automated gameplay corrections and payout holds by type
- manual suspensions, bans, lifts, and reversals by reason and actor role
- operator reversals
- false-positive rate from reviewed cases

Logs should sample noisy repeated events but persist enough aggregate counts for scoring.

## Client Plan

Client work should improve responsiveness, messaging, and low-trust hints without pretending to secure the browser.

Implement:

- keep the current Rapier movement path as local prediction until strict authority promotion passes the compatibility gates
- add drift telemetry around the existing movement path instead of replacing it early
- protocol version and build id in join metadata
- authoritative correction handling that feels smooth and clear
- neutral error messages for action rejection, ranked restriction, and no-contest outcomes
- local telemetry for prediction drift, frame timing, and command production gaps
- clear review-required and payout-hold messaging without revealing detection rules

Do not implement:

- a movement-controller rewrite as part of the anti-cheat foundation
- local file scanning
- process scanning
- kernel or driver components
- clipboard, microphone, camera, or browser-history inspection
- exact anti-cheat rule disclosure in client-visible strings

## Implementation Slices

### 1. Anti-Cheat Domain And Event Bus

Create the normalized signal types, server collector, scoring interfaces, environment flags, and in-memory per-room signal sink.

Acceptance criteria:

- existing authority events can be emitted as anti-cheat signals
- signal payloads are bounded in size
- sensitive identifiers are redacted or omitted
- observation mode can be enabled without behavior changes
- unit tests cover event normalization and payload bounds

### 2. Durable Evidence Store

Add persistence for signals, player profiles, match integrity, enforcement actions, and review cases.

Acceptance criteria:

- signals are written idempotently
- low-severity retention can be configured
- match and user lookups are indexed
- no raw wallet addresses or secrets are stored in anti-cheat payloads
- database migrations include rollback-safe defaults

### 3. Movement Trace-Replay Parity Gate

Build the proof system before movement authority is allowed to continue beyond offline replay or observe-only shadow mode.

Acceptance criteria:

- trace recorder captures input sequence, buttons, look, client Rapier position, velocity, movement flags, hero state, ability state, flag-carrier state, terrain/contact state, movement epoch, and latest server acknowledgement
- trace files are bounded, versioned, deterministic, and free of secrets, wallet addresses, names, and raw network identifiers
- replay harness feeds traces into server simulation or envelope validation by movement sequence
- harness reports position drift, velocity drift, movement-state mismatch, correction reasons, and objective suppression mismatches
- committed smoke corpus covers the highest-risk legal movement cases and runs in CI
- full legal corpus covers slide, bhop, grapple, rocket jump, teleport abilities, knockback, respawn, unstuck, and flag routes
- malicious trace corpus proves teleport, speed spike, blocked path, stale epoch spam, duplicate command spam, and impossible objective interactions fail for expected reasons
- failing parity blocks strict movement enforcement and ranked/wager movement-integrity decisions

### 4. Movement Compatibility And Authority

Preserve current client Rapier feel while proving the server authority path in shadow mode.

Acceptance criteria:

- client Rapier movement remains the active local feel path
- no broad client movement rewrite is required for this slice
- server simulation or envelope validation runs beside current movement and records drift without new punishment
- legal movement traces are captured for each hero and major movement mechanic
- drift budgets are defined for position, velocity, correction distance, and correction frequency
- movement command sequence, epoch, packet size, and command-rate failures emit signals
- deterministic impossible transforms can still be rejected or objective-suppressed when they are independent of Rapier parity
- hard corrections suppress objectives only when the correction is high-confidence or already part of existing behavior
- authority barriers are emitted for respawn, teleport, knockback, and unstuck
- harness tests cover speed hacks, teleport attempts, bounds escapes, blocked-path traversal, duplicate commands, stale epochs, queue overflow, legal slide/bhop/grapple/rocket-jump traces, and high-latency false-positive cases
- strict input-only movement remains disabled for ranked and wagered matches until the compatibility budget passes

### 4B. Strict Movement Promotion

Promote movement authority only after compatibility data proves it will not damage the current feel.

Acceptance criteria:

- server/client drift stays inside budget across the legal movement trace suite
- ranked and wagered matches can reject client position and velocity as authority without rubber-banding normal play
- fallback flags can return a mode to compatibility enforcement without redeploying
- promotion is enabled first for one low-risk queue or test cohort
- post-promotion dashboards show correction rates, drift, and objective suppressions by hero and movement mode

### 5. Combat And Ability Hardening

Remove remaining client-owned combat outcomes.

Acceptance criteria:

- server-owned cast ids are required for ability and projectile lifecycles
- duplicate, stale, unknown, or mismatched cast references emit signals
- projectile impacts and area damage are server resolved
- cooldown, ammo, fuel, charge, line-of-sight, and range failures emit structured reject reasons
- damage caps prevent impossible source-target burst windows
- tests cover forged impact, duplicate impact, cooldown spam, line-of-sight failure, range failure, and resource forgery

### 6. Objective Integrity

Gate flag interactions through anti-cheat-aware authority state.

Acceptance criteria:

- pickup, return, and capture use server position only
- objective interactions fail while suppressed after hard corrections or authority barriers
- objective suppression emits signals
- carrier mismatch emits a high-severity match-integrity signal
- tests cover capture after teleport, capture after speed correction, pickup through blocked path, and normal high-speed legal captures

### 7. Risk Scoring And Match Integrity

Implement the rule engine, score decay, match integrity state, and configured thresholds.

Acceptance criteria:

- deterministic signals raise score immediately
- noisy low-confidence signals decay without enforcement
- match integrity can be marked clean, suspicious, compromised, or no-contest
- ranked and wager services can query integrity state before applying outcomes
- tests cover score accumulation, decay, threshold crossing, and non-causal suspicious events

### 8. Enforcement Actions

Add staged enforcement with safe defaults and manual-only account punishment.

Acceptance criteria:

- observation mode records the action that would have happened
- soft mode rejects invalid actions and suppresses objectives
- ranked review mode pauses ranked rating visibility and wager payout settlement when integrity fails
- paused payouts are visible in the admin UI with payment ids, amounts, reason, age, and evidence links
- no automated ban, automated suspension, kick, or queue lock is implemented in this version
- manual suspend and ban actions require an authenticated admin, authorized role, selected reason, evidence link, and confirmation step
- suspension actions require an expiration time
- ban actions require elevated admin permission and create an irreversible audit entry even if later lifted
- every enforcement action stores a reason, evidence references, actor, and expiration when relevant
- client messages are neutral and do not leak thresholds

### 9. Operator Review

Build the minimum case review workflow.

Acceptance criteria:

- operators can list cases by severity, mode, player, match, and status
- a case view shows signal timeline, score changes, match impact, and actions
- operators can list paused payouts by age, match, user, team, amount, integrity reason, and case status
- operators can release payout, refund payment, cancel settlement, apply ranked outcome, or cancel ranked outcome from a reviewed case
- operators with the required role can suspend, ban, lift suspension, lift ban, and see account-action history from the case view
- manual account actions are audit-logged with actor id, target user id, reason, evidence references, timestamps, and expiration when applicable
- operators can resolve, reverse, annotate, and mark false positives
- reversed actions are auditable
- reviewed false positives can be exported into regression tests

### 10. Rollout And Tuning

Ship gradually.

Acceptance criteria:

- launch observation mode in all modes
- compare observed score distribution across quick play, ranked, custom, and wagered matches
- compare movement drift distribution across heroes, maps, frame rates, ping bands, and movement mechanics
- keep strict movement authority disabled until legal Rapier traces satisfy the compatibility budget
- tune thresholds before enabling ranked outcome holds
- enable ranked and wager integrity gates as review-required holds before any settlement decision
- enable manual admin suspension and ban controls only after audit logging, role checks, and evidence links are implemented

## Configuration

Recommended environment flags:

- `ANTICHEAT_ENABLED`
- `ANTICHEAT_MODE=observe|soft|ranked_review`
- `ANTICHEAT_SIGNAL_RETENTION_DAYS`
- `ANTICHEAT_LOW_SIGNAL_RETENTION_DAYS`
- `ANTICHEAT_MAX_SIGNAL_DETAIL_BYTES`
- `ANTICHEAT_RANKED_SCORE_THRESHOLD`
- `ANTICHEAT_WAGER_SCORE_THRESHOLD`
- `ANTICHEAT_ADMIN_REVIEW_SCORE_THRESHOLD`
- `ANTICHEAT_PAYOUT_HOLD_SCORE_THRESHOLD`
- `ANTICHEAT_PAYOUT_HOLDS_ENABLED`
- `ANTICHEAT_MANUAL_ACCOUNT_ACTIONS_ENABLED`
- `ANTICHEAT_BAN_REQUIRES_ELEVATED_ROLE`
- `ANTICHEAT_ALLOW_CLIENT_TRANSFORM_PROPOSALS`
- `ANTICHEAT_CLIENT_HINTS_ENABLED`
- `ANTICHEAT_MOVEMENT_AUTHORITY_MODE=compatibility|shadow|strict`
- `ANTICHEAT_MOVEMENT_PARITY_GATE_REQUIRED`
- `ANTICHEAT_MOVEMENT_DRIFT_SAMPLE_RATE`
- `ANTICHEAT_MOVEMENT_STRICT_MATCH_MODES`

Production defaults should favor observation or soft enforcement until the harness and review workflow are proven.

## Verification Plan

Do not use browser testing for this plan.

Use unit tests, server harnesses, Colyseus clients, HTTP clients, and direct service tests.

Minimum verification:

1. Run authority hardening tests for existing movement, ticket, protocol, and rate-limit coverage.
2. Add anti-cheat unit tests for signal normalization, scoring, decay, threshold crossing, and action selection.
3. Add malicious Colyseus client harnesses for movement forgery, malformed messages, command floods, stale epochs, replayed tickets, duplicate sessions, forged ability casts, duplicate impacts, and objective abuse.
4. Add ranked and wager integrity tests proving compromised matches do not apply rating or winner settlement.
5. Add the movement trace recorder and trace-replay harness before enabling server movement simulation outside offline or observe-only mode.
6. Add CI smoke parity tests comparing committed client Rapier traces against server simulation or envelope validation.
7. Add full-corpus parity tests for nightly, pre-release, or release-candidate checks.
8. Add false-positive scenarios for high latency, packet burst, low frame rate, respawn, knockback, teleport abilities, legal grappling, legal sliding, legal rocket jumps, legal bhop chains, and legal flag captures.
9. Add malicious trace replay tests proving teleport, speed spike, blocked path, stale epoch spam, duplicate command spam, and impossible objective interactions fail for expected reasons.
10. Add load tests to ensure signal volume does not overload room ticks or persistence.
11. Add migration tests for anti-cheat persistence models.
12. Add operator workflow tests for creating, resolving, reversing, and exporting cases.
13. Add admin account-action tests for role checks, required reasons, required evidence links, suspension expiration, ban audit entries, lifting actions, and denied unauthorized attempts.

## Launch Checklist

- observation mode deployed
- dashboards show signal rates and score distributions
- movement compatibility dashboards show Rapier/server drift by hero and movement mode
- trace-replay parity gate exists and passes before server movement simulation influences live enforcement, objectives, ranked, or wagers
- no secrets or private player data appear in logs, metrics, or persisted payloads
- ranked and wager gates are wired but initially report-only
- paused payouts and paused ranked outcomes are visible in the admin UI before any hold can be enabled outside report-only mode
- manual suspend/ban controls are role-gated, require evidence links, and write immutable audit records before they are available in production
- false-positive samples from live observation are converted into regression tests
- strict movement authority remains disabled until the compatibility budget passes
- enforcement thresholds are reviewed with real data
- player-facing Terms, conduct, and appeal language are updated
- operator runbook covers review-required matches, paused payouts, refund/release/cancel decisions, ranked outcome release/cancel decisions, manual suspension, manual ban, lifting actions, reversal, and escalation

## Out Of Scope For The First Version

- kernel-level anti-cheat
- native launcher requirement
- browser extension requirement
- OS process or file scanning
- machine-learning-only automatic bans
- automated bans, automated suspensions, kicks, queue locks, and device association
- unaudited or non-role-gated admin account actions
- public exposure of detection thresholds
- post-settlement wager reversal automation
