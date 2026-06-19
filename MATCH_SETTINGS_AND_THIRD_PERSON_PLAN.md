# Match Settings and Third-Person Queue Plan

## Reader and Outcome

Reader: an internal engineer implementing the play-menu match settings change.

Post-read action: replace the inline bot-fill toggle with a settings dialog, add a third-person match setting for every non-ranked mode, and make matchmaking keep first-person and third-person players in separate queues.

## Product Behavior

- Ranked has no match settings cog and always queues first-person.
- Quick Play, Team Deathmatch, Battle Royal, and Practice each expose a cog icon button from the play-mode option.
- The cog opens a focused Match Settings dialog for that mode.
- The dialog includes the existing bot-fill toggle for online queue modes that already support bot fill: Quick Play, Team Deathmatch, and Battle Royal.
- Practice uses the same dialog entry point, but only shows the perspective control because the current practice launch path does not use queue bot fill.
- The dialog includes a perspective control with first-person and third-person choices. Default is first-person.
- In a party, only the leader can change match settings. Non-leaders should see the same disabled affordance pattern already used for mode/bot-fill ownership.
- Changing bot fill or perspective in a party clears non-leader ready state, matching the current mode-setting behavior.

## Data Model

- Add a shared `MatchPerspective` type with values `first_person` and `third_person`.
- Add shared defaults and validators:
  - `DEFAULT_MATCH_PERSPECTIVE`
  - `isMatchPerspective`
  - a helper for default perspective settings by non-ranked play mode
- Keep the existing bot-fill settings as the source of truth. Do not duplicate bot-fill state in a new structure.
- Extend play-menu preferences with perspective settings keyed by non-ranked play modes.
- Extend party state with perspective settings keyed by the same logical modes, or with a helper-backed structure that can map the selected party mode plus gameplay mode to the active non-ranked settings key.
- Keep sanitizers tolerant of missing perspective data so existing saved preferences fall back to first-person without a migration path or legacy UI.

## Client Implementation

1. Replace the inline bot toggle in the play-mode selector with a cog icon button.
   - Show the cog for every non-ranked mode option.
   - Do not show it for ranked.
   - Prevent the cog click from accidentally selecting the mode if it is a separate action inside the option shell.
   - Remove the old inline bot-toggle JSX and CSS after the dialog is wired.

2. Add a Match Settings dialog.
   - Reuse the existing game dialog component.
   - Scope the dialog to the mode whose cog was clicked.
   - Render a bot-fill switch for Quick Play, Team Deathmatch, and Battle Royal.
   - Render a first-person/third-person control for every non-ranked mode.
   - Disable controls when the player is in a party and is not the leader.

3. Persist solo settings.
   - Extend the play-menu preference sanitizer/defaults for perspective.
   - Save perspective changes alongside existing play-menu preferences.
   - Use first-person whenever no saved value exists.

4. Sync party settings.
   - Add a network action for setting party perspective, mirroring the existing party bot-fill action.
   - Update the party snapshot so all members see the leader's selected perspective.
   - Include the selected perspective in party launch payloads.

5. Thread perspective through solo launches.
   - Quick Play passes the selected perspective into ticket request, room join options, and local matchmaking status.
   - Practice passes the selected perspective into the local room/start path.
   - Ranked hardcodes first-person and ignores any non-ranked preference.

6. Apply perspective in gameplay.
   - Store the active match perspective in the game store once a match/lobby/practice session starts.
   - Update the local camera system to support a third-person offset behind and above the player while preserving the same yaw/pitch input model.
   - Hide first-person viewmodel rendering in third-person.
   - Ensure the local hero body is visible in third-person.
   - Keep ability aim, movement commands, and server-relevant look yaw/pitch consistent with existing first-person input.
   - Add basic camera obstruction handling so the third-person camera does not sit behind terrain or map geometry.

## Server and Matchmaking Implementation

1. Add perspective to room options and metadata.
   - Room creation resolves a match perspective from join/create options.
   - Ranked rooms force first-person.
   - Matchmaking metadata and status payloads include perspective.

2. Enforce perspective compatibility at room admission.
   - Existing queue admission already checks match mode, gameplay mode, rank band, and bot-fill mode.
   - Add perspective to that compatibility gate.
   - A third-person quick-play request must not join a first-person quick-play room, and vice versa.

3. Include perspective in queue status.
   - Add a queue-status query parameter for perspective.
   - Include perspective in the queue-status cache key.
   - Filter quick-play queue-status counts by gameplay mode and perspective.
   - Ranked queue status continues to use first-person only.

4. Include perspective in rank-band selection.
   - Quick-play ticket requests should send gameplay mode, bot-fill mode, and perspective.
   - Rank-band candidate selection should filter to compatible rooms before choosing an existing rank band.
   - Party matchmaking should pass the same compatibility inputs when choosing the party's target band.

5. Harden ticket/room consistency.
   - Add quick-play match settings to matchmaking ticket claims, or otherwise validate that room join settings match the settings used to issue the ticket.
   - Ranked tickets should either omit perspective or explicitly carry first-person.
   - Room ticket validation should reject mismatched matchmaking settings.

## Cleanup

- Remove the old inline bot-toggle component markup and styles once the dialog replaces it.
- Remove any helper that only exists to decide whether to show the old inline bot toggle.
- Keep bot-fill state and helpers that remain active behind the new dialog.
- Avoid worktrees or branches unless explicitly requested.
- Do not run browser verification; leave that to the user.

## Verification Plan

- Add or update play-menu preference tests for default first-person behavior, saved third-person behavior, and missing-field sanitization.
- Add party runtime tests for leader-only perspective changes, ready-state reset, and launch payload perspective.
- Add matchmaking tests that prove first-person and third-person quick-play requests do not share a room.
- Add queue-status tests that prove counts and cache keys are separated by perspective.
- Add ticket validation tests for mismatched perspective claims/options.
- Run targeted TypeScript checks and relevant unit scripts.
- Do not use browser testing for this task.

## Reader Test

A fresh engineer should be able to implement this in this order:

1. Add the shared perspective type and preference/party state plumbing.
2. Replace the old inline bot toggle with the settings dialog.
3. Thread perspective through solo and party launches.
4. Make room admission, queue status, ticket validation, and rank-band selection perspective-aware.
5. Wire the active perspective into camera/viewmodel behavior.
6. Delete obsolete inline-toggle code and run the automated checks above.
