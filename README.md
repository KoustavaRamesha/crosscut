# Crosscut

A voxel deathmatch shooter for Freebuff Sites. One arena, a rifle with controlled
spray, a faster knife, and bunny hopping. Play solo against bots, or play online
with friends in a shared room.

## Modes

- **Play solo — bots:** the original single-player session, fully offline, with
  five bot opponents. Escape pauses the simulation. Rounds end at 25 kills or
  four minutes.
- **Play online:** join a room over a Freebuff realtime WebSocket. The first
  player in a room hosts the authoritative simulation and relays snapshots;
  everyone else streams batched inputs and renders interpolated snapshots with
  local self-prediction. Optional Freebuff sign-in gives a stable identity;
  signed-out players get a server-minted guest id.

By default an online room is filled with practice bots while few humans are
present (host-only toggle in the menu). Movement targets ~15 batched input
messages and ~15 snapshots per second, inside the realtime room budgets.

## Run

```sh
bun install
bun run dev
```

For the actual Workers runtime:

```sh
bun run build
bun run preview
```

Open http://localhost:8796 in a desktop browser. Use mouse and keyboard. Embedded
browsers that refuse pointer capture offer an in-window mouse fallback; a normal
browser with pointer capture is recommended for unrestricted turning.

## Freebuff Sites

Build and deploy `deploy.json` through Freebuff Sites. Test the preview, then
publish the production environment when ready.
The artifact is a standard ES-module Worker with an `ASSETS` binding and a Vite
client bundle. It requires no Durable Objects, realtime binding, database, auth
registration, credentials, or application secrets. The entire match runs locally
at a fixed 60 Hz, with interpolation for rendering between simulation steps.
All models, effects, audio and fonts are generated locally or bundled.

Stats are saved only in this browser. They are not account stats, are not synced,
and reset if browser storage is cleared. This solo game has no
sign-in. Local scores are editable by the player and are unsuitable for competitive
leaderboards without a separately designed trusted backend.

## Customize

- `src/shared/world.ts`: arena geometry, cover and spawn points.
- `src/shared/physics.ts`: movement, acceleration, air control and weapon spray.
- `src/shared/navigation.ts`: the bots' ground navigation graph.
- `src/shared/game.ts`: combat, AI, rounds and respawns.
- `src/shared/session.ts`: solo session, pause and local records.
- `src/client/scene.ts`: procedural voxel art, weapons, lighting and effects.
- `src/client/style.css`: typography, menu and HUD.

## Verify

```sh
bun run typecheck
bunx bun@1.3.14 test tests
bun run build
```

Tests cover collision, momentum, gun damage, cover, fire rate, spawn protection,
pausing, persisted round results, navigation between all spawns, and a full bot
round followed by reset. Browser checks cover starting, movement, firing, weapon
switching, pause/resume, settings and ending a match.
