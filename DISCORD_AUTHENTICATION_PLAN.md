# Discord Authentication Plan

## Reader And Outcome

Reader: an internal engineer implementing Discord login for Opus Strike.

After reading this plan, the engineer should be able to add Discord authentication, preserve existing Phantom wallet players and stats, and keep multiplayer room authentication working through the existing session cookie.

## Current State

- Authentication is Phantom-wallet-only.
- The client owns a Phantom-specific auth context, restores sessions from the server, asks the wallet to sign a nonce, and stores the authenticated user in game state.
- The server has an Express auth router that issues nonces, verifies Solana signatures, registers new players, restores sessions, and logs out.
- The app session is an `auth_token` HTTP-only cookie containing a JWT with the user id and wallet address.
- The database user row is also the stats row. It currently uses `walletAddress` as the unique external identity.
- Colyseus room auth resolves the user from the same cookie or explicit auth token, then falls back to guest play if allowed.

The main risk is treating Discord as a direct replacement for `walletAddress`. Discord should be added as another identity provider attached to the same player profile so existing stats survive.

## Target Product Behavior

- "Continue with Discord" becomes the primary sign-in path.
- Existing Phantom users can link Discord to their current profile before Phantom login is removed or hidden.
- New Discord users create a player name using the existing name flow, with the Discord display name offered as the default when available.
- Existing Discord users land in the lobby with their stats and name restored.
- Logout continues to clear the same app session cookie.
- Phantom can remain as a secondary sign-in option during migration, then be removed later after account linking has had enough time.

## OAuth Approach

Use Discord OAuth2 Authorization Code Grant on the server.

- Authorization URL: `https://discord.com/oauth2/authorize`
- Token URL: `https://discord.com/api/oauth2/token`
- Token revocation URL: `https://discord.com/api/oauth2/token/revoke`
- Required scope: `identify`
- Optional scope: `email`, only if the product needs account recovery, support, or user messaging.
- Avoid `guilds`, `guilds.members.read`, or bot scopes unless there is a concrete guild-gating feature.
- Do not use the implicit grant. It exposes the access token to the browser URL and does not provide a refresh token.
- Use the OAuth `state` parameter as a one-time CSRF token for every authorization request.

Discord's token and revoke endpoints require `application/x-www-form-urlencoded` requests. Keep the Discord client secret server-side only.

## Data Model Plan

Move from "user equals wallet" to "user owns one or more auth accounts."

Recommended schema shape:

- `User`
  - Keep profile and stats fields here.
  - Keep `walletAddress` temporarily for backward compatibility during migration.
  - Add optional profile fields that are not provider-specific, such as `lastLoginAt`.
- `AuthAccount`
  - `id`
  - `userId`
  - `provider`: `discord` or `phantom`
  - `providerAccountId`: Discord user id or wallet address
  - `displayName`
  - `avatarUrl`
  - `emailHash` if the `email` scope is used
  - `createdAt`
  - `updatedAt`
  - Unique constraint on `provider` plus `providerAccountId`

Migration steps:

1. Add `AuthAccount` while leaving current `User.walletAddress` behavior intact.
2. Backfill one `phantom` auth account for every existing user with a wallet address.
3. Update session creation and lookup to use `userId` as the durable app identity.
4. Keep emitting `walletAddress` in API responses until the client has been refactored.
5. Later, make `walletAddress` nullable or remove it after all wallet-specific code has been retired.

## Server Implementation Plan

Add provider-neutral auth helpers before adding Discord-specific endpoints.

1. Generalize session payloads
   - Prefer JWT payloads with `userId`, `sessionVersion`, and optional `provider`.
   - Stop requiring `walletAddress` for session verification.
   - Continue accepting old wallet-shaped JWTs for one release if there are active users.

2. Add OAuth state storage
   - Generate a cryptographically random `state`.
   - Store it server-side with a short TTL, one-time-use flag, return target, and optional link target user id.
   - Do not depend on the existing app auth cookie being present on the callback, because production `SameSite=strict` cookies may not be sent after a cross-site redirect.

3. Add `GET /auth/discord/start`
   - Accept an optional safe `returnTo` path.
   - Create an OAuth state record.
   - Redirect to Discord with `response_type=code`, `client_id`, `redirect_uri`, `scope`, and `state`.

4. Add `GET /auth/discord/callback`
   - Validate `state` and mark it used.
   - Exchange `code` for a Discord access token using form encoding and server-side client credentials.
   - Fetch the current Discord user with the access token.
   - Find an existing `AuthAccount` for `provider=discord` and the Discord user id.
   - If found, issue the normal app session cookie and redirect back to the client.
   - If not found and the state is for account linking, attach the Discord account to the linked user.
   - If not found and this is a new login, create a pending registration session containing provider metadata, then redirect the client to the profile creation flow.

5. Generalize registration
   - Replace wallet-only registration with a provider-neutral profile creation endpoint.
   - Accept the player name and complete the pending Discord registration by creating the `User` plus `AuthAccount`.
   - Preserve the existing name validation rules.

6. Update session restore
   - Return provider-neutral user data.
   - Include linked account summaries so the client can show "Discord connected" or "Phantom connected."
   - Keep wallet fields temporarily for compatibility while the client migrates.

7. Add account linking endpoints
   - `GET /auth/discord/link/start` starts Discord OAuth for an already-authenticated user.
   - The callback links Discord to the authenticated user's profile through the stored OAuth state.
   - Add an unlink endpoint only after deciding whether every account must keep at least one login provider.

8. Keep logout simple
   - Continue clearing the app session cookie.
   - If Discord tokens are not stored, there is no Discord token to revoke.
   - If tokens are stored later, revoke them when the user disconnects Discord.

## Token Storage Policy

For authentication-only login, do not persist Discord access or refresh tokens. Use the access token once to fetch Discord identity, then discard it.

Only store Discord tokens if a later feature needs Discord API calls after login. If that happens:

- Encrypt refresh tokens at rest.
- Store token expiry.
- Refresh server-side only.
- Revoke tokens when the provider is disconnected.
- Never expose Discord tokens to the browser.

## Client Implementation Plan

Refactor from wallet-specific auth UI to provider-neutral auth UI.

1. Rename the auth context conceptually from wallet auth to app auth.
   - Keep Phantom provider logic isolated behind a Phantom-specific helper.
   - Add Discord actions that redirect the browser to the server start endpoint.

2. Update the sign-in modal.
   - Primary action: "Continue with Discord."
   - Secondary action during migration: "Continue with Phantom."
   - Keep the player name screen for new accounts.

3. Handle OAuth return.
   - On app load, continue calling session restore.
   - If the callback redirects with an auth status query, show success or error feedback, then clean up the URL.
   - If the restored session is pending registration, show the profile creation flow.

4. Update user state.
   - Treat `userId`, `playerName`, and stats as the durable game identity.
   - Replace wallet-only display fields with linked account summaries.
   - Avoid using Discord username as a stable id; use Discord user id only.

5. Preserve room auth behavior.
   - Continue relying on the HTTP-only app session cookie for room joins.
   - If any Colyseus client path passes an explicit token, keep that compatible with the new JWT payload.

## Security Checklist

- Use high-entropy OAuth state values.
- Expire OAuth state quickly and consume it once.
- Validate `returnTo` against same-origin relative paths only.
- Keep Discord client secret out of client bundles.
- Use rate limits on OAuth start, callback, registration, and provider linking endpoints.
- Log provider, user id, and failure reason, but never log OAuth tokens.
- Store only the minimum Discord profile fields needed by the game.
- Do not trust mutable Discord usernames for account identity.
- Handle duplicate-provider conflicts with a clear error instead of silently moving identities between users.
- Keep app session cookies HTTP-only and secure in production.

## Rollout Plan

1. Add the provider-neutral database model and backfill Phantom identities.
2. Generalize JWT session verification while keeping current Phantom login working.
3. Add Discord OAuth endpoints behind a feature flag.
4. Add the client Discord sign-in button behind the same feature flag.
5. Add Discord linking for already-authenticated Phantom users.
6. Turn on Discord sign-in for internal testing.
7. Make Discord the primary option and keep Phantom as secondary.
8. After enough linked-account coverage, decide whether Phantom remains supported or is removed.

## Verification Plan

Automated checks:

- Database migration backfills one Phantom account per existing user.
- Discord callback rejects missing, expired, reused, or mismatched state.
- Discord callback creates a pending registration for a new Discord user.
- Discord callback restores an existing Discord-linked user.
- Linking refuses to attach a Discord account already linked to another user.
- Session restore works with the new JWT payload.
- Room auth resolves authenticated users without requiring a wallet address.
- Logout clears the app cookie.

Manual checks for the user:

- New Discord user completes OAuth, creates a name, and enters the lobby.
- Existing Discord user returns directly to the lobby.
- Existing Phantom user links Discord and keeps stats.
- Logout followed by sign-in restores the same profile.
- OAuth denial or Discord error returns to the app with a useful message.

## Implementation Slices

1. Schema and migration
   - Add `AuthAccount`, backfill Phantom accounts, regenerate the Prisma client.

2. Session generalization
   - Make JWT verification user-id-first and update session restore responses.

3. Discord OAuth backend
   - Add start/callback endpoints, state storage, Discord user fetch, and pending registration.

4. Provider-neutral registration
   - Complete new Discord profiles with the existing player-name rules.

5. Client auth refactor
   - Add Discord sign-in, provider-neutral session state, and OAuth return handling.

6. Account linking
   - Let current Phantom users attach Discord and keep their stats.

7. Cleanup
   - Remove wallet-only assumptions from API responses and game store after migration.

## Open Decisions

- Should Discord fully replace Phantom, or should both remain supported?
- Is Discord guild membership required to play?
- Is the `email` scope needed, or is `identify` enough?
- Should new Discord users get their Discord display name prefilled or automatically accepted when valid?
- How long should Phantom users have to link Discord before Phantom login is hidden?

## References

- Discord OAuth2 documentation: https://docs.discord.com/developers/topics/oauth2
- Discord Social SDK authentication notes for game-oriented OAuth behavior: https://discord.com/developers/docs/social-sdk/authentication.html
