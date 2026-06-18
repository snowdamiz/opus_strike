# Main Play Party Plan

## Reader And Action

This plan is for an internal engineer implementing party invites from the main Play screen. After reading it, they should be able to change the Play screen, social invites, party state, and queue/start flows without mistaking the existing lobby system for a pre-lobby party system.

## Goal

Let authenticated players invite friends into a party while they are still on the main Play screen. A solo player should keep the current hero showcase experience, with the Play action moved into the bottom-left season/action stack. A party should show party members and their selected heroes standing together, with Ready Up for members and Start for the leader. The selected bottom-left mode should drive the queue/start behavior, including practice.

## Current Code Findings

- `MainLobby` owns the Play screen state today. It keeps `featuredHero`, modal flags such as `showPlayDialog`, and the handlers for quick play, ranked, custom lobby creation, practice, tutorial, and reconnect.
- `PlayTab` renders the current Play screen hero carousel. It shows `RankedSeasonPlate`, the carousel arrows, `FeaturedHeroPreview`, hero name, hero description, hero dots, and the main Play/Discord/reconnect/tutorial CTA.
- `PlayDialog` is the dialog opened by the current Play button. It contains the Ranked, Quick Play, Custom Game, and Practice buttons. Custom and Practice still open separate setup modals from there.
- `RankedSeasonPlate` already occupies the bottom-left corner. The CSS class `play-season-plate` is absolutely positioned there, and `play-main-cta` is currently centered under the hero info with auto margins.
- `FeaturedHeroPreview` and `HeroPreviewCanvas` already support reusable hero previews. `FeaturedHeroPreview` accepts an override `className`, so the party lineup can reuse the same renderer at smaller sizes instead of adding a second hero renderer.
- `HeroIcon` already provides compact hero icons for `phantom`, `hookshot`, `blaze`, and `chronos`.
- `SocialBox` already handles friends, friend requests, and lobby invites. Its friend invite button is currently enabled only when `appPhase === 'in_lobby'` and `currentLobbyId` exists.
- `SocialBox` sends `/social/lobby-invites` with a `lobbyId`, and accepting an invite calls `joinLobby`.
- The Prisma model is `LobbyInvite`, not a party invite. It stores `lobbyId`, `lobbyName`, `matchMode`, sender, recipient, status, and expiry.
- `LobbyRoom` is a real game lobby, not a pre-lobby party. It owns teams, readiness, host state, bots, map vote, matchmaking status, and game start. Private lobby admission depends on accepted `LobbyInvite` records.
- `useGameStore` has lobby state (`currentLobbyId`, `lobbyPlayers`, `isLobbyHost`, `currentLobbyWager`, `matchmakingStatus`) but has no party state.
- `AppPhase` has `menu`, `matchmaking`, `in_lobby`, `map_vote`, and `in_game`. There is no party phase, and the requested party should remain on the `menu` phase because the player is not in a lobby yet.
- `NetworkContext` has one lobby room ref and one game room ref. It exposes `quickPlay`, `rankedPlay`, `createLobby`, `joinLobby`, `leaveLobby`, `setLobbyReady`, `startGame`, `startPracticeGame`, and game hero selection. It does not expose party operations.
- `quickPlay` and `rankedPlay` each issue a single-user matchmaking ticket and then join or create a `lobby_room`. `LobbyRoom` requires each matchmaking join to include a valid ticket for that user and the room's rank band.
- `startPracticeGame` is local-only. It calls `resetLobby`, sets `isPracticeMode`, creates a local practice player, and moves directly to `appPhase: 'in_game'`. There is no multiplayer practice room today.

## Key Architecture Conclusion

The requested feature cannot be implemented cleanly by just showing `lobbyPlayers` on the Play page. The current lobby system means the player has already joined a `LobbyRoom`, which changes `appPhase` to `in_lobby` or `matchmaking`. The requested party is a new pre-lobby social state that must exist while `appPhase` remains `menu`.

The right shape is a lightweight party layer that is separate from `LobbyRoom`, then launches into the existing lobby/matchmaking/practice paths when the leader starts.

## Proposed Data Model

Add a party state with these concepts:

- Party id.
- Leader user id.
- Members keyed by durable user id, not Colyseus session id.
- Member display name and rank summary.
- Member selected hero id.
- Member ready state.
- Member connection state.
- Selected party mode.
- Optional selected gameplay mode for custom/practice variants.
- Optional launch error.

Prefer a new client store module for this transient party state rather than expanding the already-large game store. The game store should only be touched when the party actually launches into lobby, matchmaking, or practice.

## Server Plan

### 1. Add A Pre-Lobby Party Room

Register a new Colyseus `party_room` beside the existing `lobby_room`. This room should authenticate the same way gameplay rooms do, but it should not create teams, bots, map votes, wagers, or matchmaking metadata.

Party room messages:

- `setHero`: update the sender's selected hero.
- `setReady`: update the sender's party readiness.
- `setMode`: leader-only selected mode update.
- `start`: leader-only launch command.
- `leave` or normal room leave: remove the member and transfer leader if needed.

Party room outbound messages:

- `partyState`: full party snapshot.
- `partyMemberJoined`.
- `partyMemberLeft`.
- `partyMemberUpdated`.
- `partyLeaderChanged`.
- `partyLaunch`: tells each member what to join/start.
- `error`: launch or validation errors.

### 2. Replace Main-Screen Lobby Invites With Party Invites

Add party invite persistence or equivalent social invite records. The current `LobbyInvite` model is lobby-specific and contains `lobbyId`; main-screen invites need to point at a party instead.

Recommended path:

- Add `PartyInvite` with `partyId`, sender, recipient, status, expiry, and optional display metadata.
- Add `/social/party-invites` create/accept/decline routes.
- Extend `/social` to return pending party invites.
- Keep existing lobby invites only for true in-lobby private lobby invites until we explicitly confirm they are legacy. `LobbyRoom` currently uses accepted `LobbyInvite` records for private-lobby admission, so deleting them immediately would break existing custom lobby joining.

### 3. Launch Existing Flows From Party Start

Party start should be server-coordinated so all members launch together.

For Quick Play:

- Reuse the existing matchmaking ticket security model.
- Move reusable matchmaking ticket creation/rank-band selection logic out of the HTTP route so party launch can issue per-member tickets.
- Choose the party rank band intentionally. A practical v1 is party average competitive rating, matching how `LobbyRoom` already reports average competitive rating after players join.
- Create or join a matchmaking `lobby_room` for the selected band, then send each party member the same lobby id plus their own ticket.
- Add a `NetworkContext` method that can join a specific matchmaking lobby by id with a provided ticket.

For Ranked:

- Require every party member to pass tutorial, auth, wallet, and token-hold checks.
- Issue per-member ranked tickets with the same target rank band.
- Block launch and show the party error if any member is ineligible.
- Join all members into the same ranked matchmaking lobby.

For Custom:

- Create a private custom `lobby_room` using the selected gameplay mode.
- Admit party members using either signed party launch tokens or generated accepted lobby invites. Signed launch tokens are cleaner long-term; generated accepted lobby invites reuse existing `LobbyRoom` admission with less room change.
- Once launch starts, the app moves out of main Play and into the existing `Lobby` screen.

For Practice:

- The current practice implementation is local-only, so party practice cannot include party members without new server behavior.
- Recommended v1 decision: solo practice continues to call `startPracticeGame`; party practice launches a private custom/practice lobby variant instead of local practice. If practice must remain local, disable Practice while in a party and show why.
- This needs product confirmation before implementation because the existing code has no multiplayer practice concept.

## Client Plan

### 1. Inline The Mode Selector Under The Season Plate

Extract the current `PlayDialog` mode buttons into a reusable inline component rendered under `RankedSeasonPlate`.

The new bottom-left stack should contain:

- Ranked toggle.
- Quick Play toggle.
- Custom Game toggle.
- Practice toggle.
- The main action button below the toggles.
- Any current error/eligibility state that matters for the selected mode.

The selected mode state should live in `MainLobby` or a small Play-screen controller hook. In party, leader mode changes sync to the party room; non-leaders see the leader-selected mode.

After the inline mode selector fully replaces the dialog, remove the legacy `showPlayDialog` state and `PlayDialog` component.

### 2. Move The Solo CTA To The Bottom-Left Stack

In solo mode, keep the current carousel, hero description, arrows, and dots. Move the Play/Discord/reconnect/tutorial CTA out of `play-hero-info` and into the bottom-left season/action stack.

The solo action should still preserve current behavior:

- Unauthenticated users see Discord sign-in.
- Reconnect remains available when `runningGameSession` exists.
- Tutorial still takes precedence when required.
- Otherwise, the selected inline mode determines whether to quick play, ranked play, create custom, or start practice.

### 3. Add Party-Aware Play Rendering

When party state exists:

- Replace the single hero carousel stage with a party lineup stage.
- Render each member with a smaller `FeaturedHeroPreview`.
- Show each member's display name where the solo hero name currently appears.
- Show `HeroIcon` to the left of the member name.
- Hide carousel arrows, carousel dots, hero description, and solo hero-name copy.
- Keep the background and Play page framing so it still feels like the same main screen.
- Keep the lineup responsive by scaling preview sizes and spacing based on member count.

The current carousel is also the main way to choose `featuredHero`. Once it is hidden for party view, add a compact hero selection affordance for the local player or make the Heroes tab update the local party hero. Do not leave party members unable to change their selected hero.

### 4. Wire Party Controls

Party member action:

- `Ready Up` when not ready.
- `Unready` when ready.
- Changing local hero or selected mode should mark the member unready.

Party leader action:

- `Start`.
- Disabled until all non-leader members are ready and launch validation passes.
- The leader does not need a separate Ready button unless product wants leaders to ready too.

Party social actions:

- From the main Play screen, authenticated users can invite friends even when `appPhase === 'menu'`.
- If the user has no party, inviting should create or join a party first, then send the party invite.
- Accepted party invites join the party room and keep the user on the main Play screen.

## Implementation Slices

1. Extract Play mode options from `PlayDialog` into an inline Play mode selector. Move the solo CTA into the bottom-left season/action stack. Do this first because it is useful even before party networking exists.
2. Add client party state and party network methods. Keep it independent from existing lobby state.
3. Add server `PartyRoom`, party schema, party messages, and party lifecycle.
4. Add party invite routes and wire `SocialBox` to invite from the main Play screen. Keep lobby invites for true lobby invites until confirmed legacy.
5. Add the party lineup view in `PlayTab`, reusing `FeaturedHeroPreview` and `HeroIcon`.
6. Implement party launch for Quick Play and Ranked using per-member matchmaking tickets and a shared target matchmaking lobby.
7. Implement party launch for Custom using private lobby admission for party members.
8. Resolve the Practice decision, then implement either party practice as a private practice/custom lobby or disable it in party with clear UI.
9. Remove replaced legacy code: `PlayDialog`, `showPlayDialog`, and any mode-choice-only CSS once the inline selector fully covers those behaviors.

## Testing And Verification Plan

Do not test this in the browser; leave visual/browser validation to the user.

Use code-level checks instead:

- Client typecheck.
- Server typecheck.
- Add server script tests for party room membership, leader transfer, ready state, hero updates, and start validation.
- Add social route tests or service tests for party invite create/accept/decline and expiry.
- Add matchmaking launch tests for party quick play and ranked ticket handling.
- Add a focused client test or type-level coverage for the party store/action reducers if a store module is introduced.

## Open Decisions For Review

- Party max size: use the current default max players of 8, or cap party size lower for ranked/quick play?
- Ranked party banding: average rating, highest rating, or widest-member constraints?
- Practice in party: implement as a private multiplayer practice/custom lobby, or keep practice solo-only and disable it in party?
- Custom settings: should Custom Game settings stay in a secondary setup modal, or move lobby name/gameplay/wager/dev seed controls into the bottom-left stack too?
- Existing lobby invites: once party invites exist, should friend invites from inside an already-created lobby remain, or should all friend invites become party invites?

