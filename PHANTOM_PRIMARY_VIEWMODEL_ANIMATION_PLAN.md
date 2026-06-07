# Phantom Primary Viewmodel Animation Plan

## Reader And Outcome

Reader: an engineer implementing first-person hero skill animations in the client.

Post-read action: implement Phantom's left-click primary bolt so the firing hand animates and the projectile originates from that same animated palm socket.

## Goal

Phantom's left-click attack should feel like a real first-person hand attack, not a projectile spawned from a separate gameplay offset. Each successful primary shot alternates hands. The chosen hand rotates forward while the palm opens into a high-five pose, and the bolt starts from that palm.

This should become the reusable pattern for future first-person skill animations.

## Current State

Phantom primary fire is currently implemented as Dire Ball in the Phantom ability handler. It rate-limits left-click, increments a projectile counter, alternates a launch side, computes a world-space spawn position, adds a projectile to the store, and plays audio.

The first-person viewmodel renders Phantom forearms and clenched hands, but it does not yet receive a per-shot action event or expose a palm socket. The projectile spawn is computed separately from the rendered hand.

Hookshot projectiles already carry launch-side metadata. Phantom primary fire should follow that precedent instead of inferring which hand fired from timing or screen position.

## User Requirements

- Animate only Phantom left-click primary attack for this pass.
- The firing arm rotates during the attack.
- The firing hand opens its palm like a high five during the attack.
- Hands alternate one after the other as successful shots are used.
- The animated hand is the hand that shoots the bolt.
- The bolt origin must be bound to the palm location, not approximated with a detached visual effect.
- The solution should be the model for future skill/viewmodel integration.
- Do not browser-test; manual browser verification is left to the user.

## Architecture

### 1. Add A First-Person Socket Registry

Create a small viewmodel socket registry owned by the client runtime. It should let the rendered viewmodel register real `THREE.Object3D` sockets, and let ability code read the current world pose for a named socket.

For Phantom primary fire, the viewmodel registers:

- `phantom.primary.leftPalm`
- `phantom.primary.rightPalm`

Each socket is placed inside the actual palm group after the arm, wrist, palm, and hand rotations are applied. The socket's world matrix is the launch source.

The registry should expose a read API that returns:

- world position
- world quaternion
- a timestamp or revision for debugging stale reads

This registry must not create fake offsets. For local first-person shots, the normal launch path should read the registered palm socket.

### 2. Extend The Phantom Primary Projectile Contract

Extend the Phantom primary projectile data with launch metadata:

- `launchSide: -1 | 1`
- `launchYaw?: number`
- `viewmodelEventId?: string`

The ability handler already alternates the side with the projectile counter. Store that side on every primary bolt so renderers and future network consumers know which hand fired.

Keep the existing projectile id as the durable event id, or derive a viewmodel event id from it. The viewmodel should trigger one attack animation per new local projectile id.

### 3. Resolve The Bolt Launch From The Palm

When Phantom primary fire passes the fire-rate gate:

1. Increment the primary projectile counter.
2. Resolve `launchSide` from that counter.
3. Read the matching palm socket world pose from the registry.
4. Use the palm socket position as the projectile start position.
5. Keep aim based on the camera look ray, including terrain hit adjustment.
6. Compute projectile velocity from the palm position toward the aim point.
7. Add the projectile with the same `launchSide`.

The existing player-relative socket helper can remain for remote/legacy cases, but the local first-person primary fire path should treat the viewmodel socket as the authoritative source once the viewmodel is mounted.

Acceptance epsilon: for a local shot, the projectile `position` at creation should equal the registered palm socket world position within a tiny floating-point tolerance.

### 3A. Make Frame Ordering Explicit

The socket binding needs a deterministic frame-order contract. Do not rely on whichever `useFrame` callback happens to run first.

The registry should support direct socket sampling at the moment an ability fires:

- The viewmodel registers the palm socket object.
- The viewmodel also registers a small pose sampler for Phantom primary fire.
- The sampler uses the same arm, wrist, palm, and finger transform math that the rendered viewmodel uses.
- The ability handler asks for the firing pose sample for the chosen side before creating the projectile.
- The viewmodel consumes the same shot event and renders that same pose on the next frame.

This avoids a one-frame stale socket and prevents the launch point from being a separate gameplay approximation. The projectile starts from the palm pose that the attack animation uses for the firing moment.

React state should not be the bridge for this shot event because state updates are asynchronous. Use refs, a tiny event queue, or store data that can be read synchronously by the ability handler and consumed by the viewmodel.

### 4. Drive Animation From Successful Shots

The viewmodel should not animate on raw mouse-down state. It should animate only after a successful projectile is created, so cooldown/rate-limit misses do not play a fake attack.

The Phantom viewmodel can subscribe to local Dire Ball projectiles and keep the last processed projectile id in a ref. When it sees a new local projectile with `launchSide`, it starts an attack state for that side.

Suggested attack timing:

- Wind-up/open: 0.00s to 0.07s
- Fire hold: 0.07s to 0.13s
- Recover: 0.13s to 0.24s

The exact durations can be tuned, but the animation should be short enough to support the current Phantom fire rate.

### 5. Build A Pose-Based Phantom Hand

Replace the static Phantom fist shape with a poseable hand component. Keep it blocky, but split the hand into manipulable groups:

- upper/forearm group
- wrist group
- palm group
- thumb group
- four finger groups
- palm socket group

Attack pose behavior for the firing side:

- Arm rotates forward and slightly inward.
- Wrist rolls so the palm faces more toward the aim line.
- Palm moves slightly forward.
- Fingers rotate from clenched to extended.
- Thumb opens away from the fingers.
- Non-firing hand stays in idle/ready pose with only subtle shared sway.

The palm socket should be parented to the palm group near the center-front of the opened palm. Because the socket is inside the animated group, moving the hand automatically moves the launch source.

### 6. Keep One Source Of Truth For Side And Timing

The same successful shot event must supply:

- the projectile id
- the launch side
- the projectile start position
- the viewmodel animation trigger

Do not compute hand alternation separately in the viewmodel. The ability handler chooses the side once, stores it on the projectile, and the viewmodel consumes that same value.

### 7. Future-Proof The Pattern

Keep the registry and event flow hero-agnostic:

- Ability code chooses an action and side.
- Viewmodel registers named sockets.
- Ability code launches from a registered socket when available.
- Projectile data carries the hand/socket metadata.
- Viewmodel animation consumes successful projectile/action events.

This makes Blaze rockets, Hookshot hooks, and future skills follow the same model without custom one-off glue.

## Implementation Order

1. Add the viewmodel socket registry.
2. Register Phantom left/right palm sockets from the viewmodel.
3. Add launch metadata to Phantom primary projectile data.
4. Update Phantom primary fire to resolve local launches from the matching palm socket.
5. Refactor Phantom fists into poseable hand/arm groups.
6. Trigger side-specific attack animation from successful local primary projectiles.
7. Add a small debug/test helper or assertion path that can verify projectile start equals palm socket world position for local shots.
8. Run typecheck and production build.

## Verification

Automated checks:

- Client typecheck passes.
- Client production build passes.
- Static search confirms Phantom primary projectiles include `launchSide`.
- Static search confirms the local Phantom primary spawn path reads the registered palm socket.

Manual checks for the user:

- Left-click alternates hands.
- The active arm rotates and palm opens like a high five.
- The bolt appears from the open palm, not below it or in front of it.
- Missed/rate-limited clicks do not play fake hand attacks.
- Other heroes' viewmodels are unchanged.

## Non-Goals

- Do not change Glacier's weapon behavior.
- Do not animate Phantom secondary fire in this pass.
- Do not redesign Dire Ball visuals except for the source alignment needed for the hand-bound launch.
- Do not browser-test from the agent side.
