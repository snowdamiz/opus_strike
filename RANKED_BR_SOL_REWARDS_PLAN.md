# Ranked BR SOL Combat Rewards Plan

## Reader And Goal

Reader: an internal engineer implementing real SOL combat rewards for ranked battle royale.

Post-read action: implement server-authoritative ranked BR rewards for damage and kills, show the local player a SOL combat text when a rewarded hit lands, and batch payouts until the player's accrued pending rewards are worth at least 15 USD.

## Codebase Facts Checked

- The server already has a player reward ledger, reward payout rows, reward settings, a background reward payout worker, and a reward economy endpoint.
- Current match rewards are created after match persistence, only when ranked eligibility and anti-cheat integrity are clean.
- Current reward settings are mostly CTF/objective oriented: ranked drip, win, flag capture, flag return, assist, per-player cap, per-match cap, treasury reserve, and payout batch size.
- Damage is resolved server-side through the room damage runtime and the shared damage engine. The damage engine exposes server-applied damage and whether a hit downed or killed the target.
- The client already renders floating combat text through a combat feedback store and a combat text renderer. It currently supports damage, heal, and shield damage text.
- Ranked BR persistence already records placement, human/bot kill splits, combat points, kill events, and ranked outcome status.
- Ranked BR rating already treats human and bot combat separately, so SOL reward accounting should preserve the same split instead of flattening all kills into one bucket.
- The admin console already has an Economy section and a reward-economy update endpoint backed by reward settings. Extend that path instead of adding a separate config tool.
- The existing payout worker currently tries to pay pending rewards immediately when rewards are created or retried; this must change for the requested 15 USD accrual threshold.

## Non-Goals

- No client-authoritative reward claims.
- No payout after every game.
- No payouts to bots.
- No rewards for NPC/dev-spawn enemies, friendly fire, self damage, or environmental damage.
- No env-var or secret changes for reward tuning after deploy.
- No browser testing in this implementation plan; browser verification stays with the user.
- No token reward changes. This plan is for native SOL only.

## V1 Reward Formula

Use lamports internally. Never use floating point math for SOL accounting.

Default constants:

| Setting | Default | Meaning |
| --- | ---: | --- |
| `rankedBrDamageLamportsPerHp` | `250` | 0.000000250 SOL per effective HP of server-applied damage |
| `rankedBrKillLamports` | `100000` | 0.000100 SOL base reward for a final enemy elimination before target multiplier |
| `rankedBrBotTargetRewardBps` | `7000` | Official ranked BR fill bots pay 70% of normal combat rewards |
| `rankedBrSourceVictimDamageCapHp` | `315` | Max rewardable damage from one attacker to one victim per match |
| `rankedBrMaxPlayerMatchLamports` | `750000` | Max ranked BR combat reward per player per match |
| `rankedBrMaxPlayerDailyLamports` | `2500000` | Max ranked BR combat reward per player per UTC day |
| `rankedBrMaxMatchLamports` | `5000000` | Static max ranked BR combat reward pool per match |
| `rankedBrTreasuryExposureBps` | `10` | Dynamic match pool cap is at most 0.10% of available treasury above reserve |
| `minPayoutUsdCents` | `1500` | Minimum accrued pending value before payout |

Rewardable damage:

```text
rewardableDamageHp =
  min(
    serverAppliedDamageHp,
    remainingSourceVictimDamageCapHp
  )

damageRewardLamports =
  rewardableDamageHp * rankedBrDamageLamportsPerHp
```

Kill bonus:

```text
killRewardLamports =
  finalEnemyElimination ? rankedBrKillLamports : 0
```

Target multiplier:

```text
targetRewardBps =
  targetIsOfficialRankedBrBot ? rankedBrBotTargetRewardBps : 10000
```

Final per-event grant before match aggregation:

```text
grossRewardLamports =
  floor((damageRewardLamports + killRewardLamports) * targetRewardBps / 10000)

eventRewardLamports =
  min(
    grossRewardLamports,
    remainingPlayerMatchCapLamports,
    remainingPlayerDailyCapLamports,
    remainingMatchPoolCapLamports
  )
```

The dynamic match pool cap is:

```text
availableTreasuryLamports =
  max(0, treasuryBalanceLamports - treasuryReserveLamports)

dynamicMatchPoolCapLamports =
  min(
    rankedBrMaxMatchLamports,
    floor(availableTreasuryLamports * rankedBrTreasuryExposureBps / 10000)
  )
```

Example outcomes:

| Combat event | Reward |
| --- | ---: |
| 12 effective HP damage | 3,000 lamports, or 0.000003 SOL |
| 40 effective HP damage | 10,000 lamports, or 0.000010 SOL |
| 100 effective HP damage | 25,000 lamports, or 0.000025 SOL |
| Final human kill bonus | 100,000 lamports, or 0.000100 SOL |
| 100 effective HP damage to official ranked BR bot | 17,500 lamports, or 0.0000175 SOL |
| Final official ranked BR bot kill bonus | 70,000 lamports, or 0.000070 SOL |
| Full 240 HP damage + 75 downed HP + final kill | Up to 178,750 lamports, or 0.00017875 SOL before caps |

Do not use 0.001 SOL as a normal hit reward. At per-hit or per-damage frequency, that is too large for a sustainable treasury-backed loop. Keep 0.001 SOL-sized rewards for explicit events or promotions, not routine damage.

## Eligibility Rules

A reward event is eligible only when all of these are true:

- Match mode is ranked.
- Gameplay mode is battle royale.
- The ranked BR match can include official server fill bots.
- The match is in the playing phase.
- The source player is a durable authenticated human player.
- The target is either a durable authenticated human enemy or an official ranked BR fill bot enemy.
- The source and target are different players.
- Damage was accepted by the server damage engine.
- The match later persists as ranked eligible.
- The anti-cheat integrity gate is clean, with no ranked hold and no review requirement.

Damage against official ranked BR fill bots can earn reduced SOL rewards. Damage against NPCs, dev-spawn enemies, or non-roster bots should not earn SOL.

If a match is held, canceled, forced-ended, or flagged for review, do not create SOL combat rewards. The in-game text should be treated as pending feedback until final match integrity is known.

## Bot Policy

Ranked BR should remain reward-eligible when bots are present. Bot-filled matches are a normal ranked BR variant, not an automatic reward disqualifier.

Only authenticated human users can accrue or receive SOL. Official ranked BR fill bots can be rewarded as reduced-value targets, but bots never receive ledger rows, pending balances, or payouts.

Use the existing human/bot combat split for reward audit metadata:

- Human target damage and human kills use the full reward formula.
- Official ranked BR bot target damage and bot kills use `rankedBrBotTargetRewardBps`.
- NPCs and dev-spawned enemies use a zero multiplier and should be recorded as skipped, not rewarded.

The final ranked eligibility gate for battle royale must allow bot participants when the match otherwise satisfies ranked requirements. Do not use an exact "all expected players are human" rule for ranked BR rewards. Instead, require the ranked candidate flag, clean integrity, a configured minimum human count, no NPC/dev enemies, and normal persisted match completion.

## Damage And Kill Accounting

Add an in-memory ranked BR reward accumulator owned by the room or match ledger runtime.

The accumulator tracks:

- Formula version.
- Match pool cap and remaining pool.
- Per-user match totals.
- Per-user UTC-day totals loaded when the accumulator initializes, then re-checked before grant creation.
- Per-source/per-victim rewardable damage HP.
- Per-user damage reward lamports.
- Per-user kill reward lamports.
- Per-user human target and bot target splits.
- Per-user capped/skipped lamports by reason.

Do not write one database row per hit. Aggregate per user at match finalization. Store compact audit metadata on the reward ledger row:

```json
{
  "formulaVersion": "ranked_br_sol_v1",
  "gameplayMode": "battle_royal",
  "damageLamportsPerHp": "250",
  "killLamports": "100000",
  "botTargetRewardBps": 7000,
  "humanRewardableDamageHp": 184,
  "botRewardableDamageHp": 100,
  "humanKills": 2,
  "botKills": 1,
  "damageRewardLamports": "63500",
  "killRewardLamports": "270000",
  "cappedLamports": "0"
}
```

Use one idempotent player reward row per user per match:

```text
match:{matchId}:ranked_br_combat_bounty:{userId}
```

Add a new player reward kind:

```text
ranked_br_combat_bounty
```

This is cleaner than overloading the existing objective bounty kind.

## Server Integration

Extend reward settings with ranked BR combat fields:

- Enable flag for ranked BR combat rewards.
- Shadow-mode flag for dry-run accounting without creating reward rows.
- Damage lamports per HP.
- Kill lamports.
- Official ranked BR bot target reward basis points.
- Source-victim damage cap HP.
- Player match cap.
- Player daily cap.
- Match pool cap.
- Treasury exposure basis points.
- Minimum payout USD cents.
- Price quote TTL for payout threshold checks.

These fields must live in database-backed reward settings and be editable through the admin panel. Do not require env or secret changes for any formula value, cap, threshold, enable flag, multiplier, payout gate, or rollout mode.

Initialize the accumulator after the match roster is known and before gameplay starts. Load per-user UTC-day reward totals and snapshot the available ranked BR reward pool from treasury balance minus reserve. If budget or daily totals are not loaded yet, no live SOL reward text should be emitted and no reward should be accrued until the accumulator is ready.

At damage resolution:

- Calculate reward only from server-applied damage.
- Determine whether the target is a human, official ranked BR fill bot, or non-rewardable target.
- Apply the official ranked BR bot target multiplier when target damage or kill credit is against a bot.
- Apply the per-source/per-victim cap.
- Apply match, player match, player daily, and treasury-derived caps.
- Add reward metadata to the damage event sent to the source player only.
- If the hit caused final enemy elimination, include the kill bonus in the same reward amount where possible.

At match finalization:

- Pass the ranked BR reward accumulator into post-persistence reward creation.
- If final ranked eligibility or integrity fails, discard the accumulator.
- For battle royale, ranked eligibility must permit bot participants and should fail only on insufficient humans, NPC/dev enemies, forced end, or integrity issues.
- Re-check player daily caps and available treasury budget before writing reward rows.
- Create one aggregate player reward row per rewarded user.
- Do not immediately pay the new rewards unless the user's total pending value meets the payout threshold.

## Live Configuration

Deploy with safe default settings in the database, then tune every reward value from the admin Economy panel while the service is live. The implementation must not require deploys, process restarts, env updates, or secret updates to change these values:

- Ranked BR rewards enabled.
- Shadow mode.
- Damage lamports per HP.
- Kill lamports.
- Bot target reward basis points.
- Source-victim damage cap HP.
- Per-player match cap.
- Per-player daily cap.
- Match pool cap.
- Treasury exposure basis points.
- Minimum payout USD cents.
- Payout price quote TTL.
- Client reward text minimum/buffering threshold, if exposed.

Use the reward settings table as the source of truth. Runtime config defaults should only seed the first settings row or act as a development fallback when the database has no row. After the row exists, admin-edited database values win over runtime defaults.

Each settings update should create a new versioned settings snapshot:

```text
settingsVersion = monotonically increasing integer
updatedAt = admin save time
updatedByUserId = admin user id
```

Running game rooms must observe settings changes without restart. Use either a Redis/presence pub-sub invalidation from the admin save path or a short server-side settings cache TTL. Pub-sub is preferred so emergency disable and cap reductions take effect quickly.

Active matches should apply changed settings to future reward events only. Already-accrued pending match rewards are not recalculated retroactively. Each accrued event and final aggregate row should store the settings version that produced it. Emergency disable and treasury safety stops apply immediately and prevent new accrual.

The public reward economy response and admin overview should read the same database-backed settings, so the lobby and admin panel show the values currently used by running servers.

## Payout Threshold

Payouts should be batched by user and wallet once pending rewards are worth at least 15 USD.

Add a SOL/USD price service for payout decisions:

- Fetch or read a fresh SOL/USD price at payout time.
- Cache briefly, with a strict freshness window.
- Store price source, observed price, and timestamp on payout rows.
- If price is unavailable or stale, defer payout without marking rewards failed.

Minimum payout lamports:

```text
thresholdMicroUsd = minPayoutUsdCents * 10000

minPayoutLamports =
  ceil(thresholdMicroUsd * 1_000_000_000 / solUsdPriceMicroUsd)
```

Change payout grouping:

- Group all pending rewards by user and current linked wallet.
- Sum all pending lamports for that user.
- Skip the payout when the sum is below `minPayoutLamports`.
- Keep rewards pending.
- Continue to enforce treasury reserve before submitting any transfer.
- Allow an admin-only manual force payout for support cases.

Update existing immediate payout calls so they respect the threshold. This includes ranked match rewards and daily mission SOL rewards.

## Client Combat Text

Extend the combat text model with a SOL reward kind.

Recommended event shape:

```ts
{
  kind: 'solReward',
  amountLamports: string,
  label: '+0.000003 SOL',
  targetId,
  position
}
```

Do not force SOL rewards through the existing integer `amount` renderer. The current renderer is tuned for numeric damage values and should get a label-aware texture path for SOL text.

Display behavior:

- When the local player is the damage source and the server event includes reward lamports, add a second combat text event at the same target position.
- The existing stack behavior can place the SOL reward above or near the damage number.
- Use a smaller font than damage text so `+0.000003 SOL` fits cleanly.
- Use a distinct money/reward color treatment, but keep it readable against the existing scene.
- Format to exact SOL with up to 9 decimals, trimming trailing zeroes.
- If a single event is below 1,000 lamports, buffer local reward text for a short window and display the aggregate instead of spamming near-zero text.

Reward fields must be source-only in redacted player events. Targets, observers, spectators, and nearby enemies should not receive another player's pending reward amount.

## UI And Admin Updates

Update the public reward economy response so the lobby can show:

- Ranked BR damage reward.
- Ranked BR kill reward.
- Ranked BR bot target multiplier.
- Minimum payout threshold.
- "Rewards accrue pending match integrity and pay out after the threshold."

Update the admin economy form with the new settings and guardrails:

- All ranked BR SOL reward values listed in Live Configuration.
- Min/max validation for all new lamport fields.
- Treasury exposure basis points capped to a low maximum.
- Settings version, last updated time, and last admin editor.
- Price quote freshness display.
- Shadow-mode toggle for dry runs before live payouts.
- Emergency disable control that stops new accrual immediately.

## Anti-Abuse Rules

- Server calculates all rewards.
- Client never submits reward amounts.
- Only authenticated humans can earn or receive SOL.
- Official ranked BR fill bots are reduced-value targets.
- No NPC, dev-spawn enemy, self, friendly, safe zone, or disconnected-player farming rewards.
- Per-source/per-victim damage cap prevents revive-loop farming.
- Per-player match cap prevents runaway carry games.
- Per-player daily cap prevents grind draining.
- Dynamic match pool cap prevents high concurrency from draining treasury.
- Treasury reserve remains a hard stop.
- Admin-configured emergency disable remains a hard stop.
- Clean ranked integrity remains a hard requirement.
- Idempotency keys prevent duplicate match payouts.

## Implementation Slices

1. Add reward settings, enum value, payout threshold fields, live settings versioning, and payout price audit fields.
2. Extend the admin Economy panel and reward-economy update endpoint so every ranked BR SOL value is editable live.
3. Add runtime settings cache invalidation or a short TTL so running rooms pick up admin changes without restart.
4. Add a ranked BR reward accumulator and unit-test its formula and caps.
5. Update final ranked BR eligibility so bot-filled ranked BR matches can still be reward-eligible.
6. Wire the accumulator into server damage resolution and match finalization.
7. Change reward payout grouping to require the 15 USD threshold before transfer.
8. Add source-only reward fields to damage/death network events and redaction.
9. Add SOL reward combat text rendering on the client.
10. Update reward economy and admin UI settings.
11. Add focused tests for formula, caps, idempotency, threshold deferral, live config reload, source-only event visibility, and client formatter output.

## Verification Plan

Automated verification should cover:

- Formula examples produce exact lamport amounts.
- Damage caps apply per source-victim pair.
- Ranked BR matches with official fill bots can still create rewards when final ranked eligibility and integrity pass.
- Human target damage and kills produce full rewards.
- Official ranked BR bot target damage and kills produce reduced rewards.
- NPC and dev-spawn enemy damage produce no SOL reward.
- Clean ranked BR match creates one aggregate reward per rewarded user.
- Held, reviewed, canceled, or forced ranked matches create no SOL combat reward.
- Pending rewards below 15 USD are not paid.
- Pending rewards above 15 USD are grouped into one payout per user wallet.
- Stale or missing SOL/USD price defers payout.
- Admin changes to every ranked BR SOL reward value are persisted without env or secret changes.
- Running rooms observe admin settings changes without restart.
- Active matches apply new settings to future reward events and keep already-accrued rewards unchanged.
- Emergency disable stops new accrual immediately.
- Event redaction only sends reward lamports to the source player.
- SOL reward labels format exact lamport values without floating point drift.

Do not use browser testing for this work unless the user explicitly asks for it.

## Launch Defaults

Recommended rollout:

1. Deploy safe default settings in the database with rewards disabled and shadow mode available.
2. Use the admin panel to enable shadow mode and tune values without changing env or secrets.
3. Enable ledger writes from the admin panel with payouts disabled to validate accrual totals.
4. Enable thresholded payouts from the admin panel after treasury balance, price service, and admin controls are verified.

This staged rollout protects the treasury while still letting the combat loop be tuned quickly.
