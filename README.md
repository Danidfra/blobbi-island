# Blobbi Island

Blobbi Island is a browser game built around Blobbi companions: small virtual
pets whose state lives in signed Nostr events. You log in with a Nostr key,
walk your Blobbi around a hand-drawn island, care for it, buy and equip items,
play a few mini-games, and see other players who are in the same room.

There is no application backend. Everything Island needs to persist (your pet,
your profile, your inventory, what you have equipped) is a signed Nostr event,
published to the relay you configure. Presence and chat are short-lived Nostr
events, and everything else is local to the browser.

The project is pre-alpha and actively developed.

<img width="1915" height="1009" alt="blobbi island homescreen" src="https://github.com/user-attachments/assets/1f25b4f8-eaf7-4c27-8d82-1ee013f03d89" />

<img width="1915" height="1009" alt="image" src="https://github.com/user-attachments/assets/499f47be-283e-45b0-86c9-c40d467f83b6" />

## What exists today

- **Companion.** Hatch a first Blobbi in-app, then feed, play with, clean,
  medicate and put it to sleep. Care actions read their stat effects from the
  item's published definition and are logged as interaction events.
- **Island.** A set of connected locations (town, home, beach, mine, plaza,
  arcade floors, stage, stores, Nostr Station). Click to walk; the Blobbi routes around
  furniture, scales with depth, sits in chairs, hides in bushes, and takes the
  arcade elevator. A map moves you between areas.
- **Inventory, shops, equipment.** Coins and items are quantities in one
  inventory event. A care store, clothing store and furniture store sell items
  for coins. Cosmetics and visual effects are equipped through placement events
  and only render while you still own the item.
- **Activities.** Blobbi Dance (rhythm), Air Hockey, Pool (Planck physics), the
  Mine, and a beach treasure hunt. Games run locally; only the reward is written
  to your inventory. Arcade rewards are tickets, redeemable for a pass or prizes.
- **Presence and chat.** Players in the same room see each other move and talk
  through speech bubbles (free text, quick phrases, templates, emotes). Mute,
  block and report exist and are stored locally.
- **Theater.** A YouTube player, plus a host-driven "watch together" session
  that other players can join with a code.
- **Themes.** Two built-in palettes, a shared day-night sky on a two-hour cycle,
  and interop with Ditto theme events so a theme picked elsewhere applies here.
- **Nostr Farm.** The Nostr Station hub opens Nostr Farm in a new tab. Produce
  you earn there shows up in your Island bag and can be fed to your Blobbi.

Some experimental or inert systems remain in the codebase (a non-selectable
family profile, empty guest-game, badge and media catalogs) and are not part of
the current experience.

## How it works

The app is a static React and TypeScript bundle built with Vite. No backend
holds Island state. One configured relay (default `wss://relay.ditto.pub`,
switchable in settings) is the primary relay for Island's own reads and writes.
A few interoperability reads, for item definitions and other games'
inventories, also fan out to a short fixed relay list, and some events Island
consumes (Farm inventories, Ditto themes) are authored by other applications.

**Persistent state, as Nostr events**

- Blobbi pet state and the append-only care log
- the player's owner profile (which Blobbis they have, current companion)
- inventory and currency balances
- equipment placements
- themes, and an optional photo-booth note

**Short-lived Nostr events**

- room presence, which expires seconds after the last heartbeat
- chat, published as ephemeral events with a ten-second expiry
- shared-playback sessions and commands, which expire with the session

**Local state, in the browser only**

- walk position between presence updates, pose, seat occupancy
- mini-game rounds, the arcade pass entitlement, first-session flags
- mute, block and report lists
- operation ledgers: for coin movements, mine settlement, game rewards and
  cross-game spends, the client records an operation id in `localStorage`
  before publishing, so a reload or an ambiguous publish can be reconciled by
  reading the relay back instead of publishing again

No server coordinates any of this. Local ledgers exist to keep one browser
profile from applying the same operation twice; they are not authoritative for
anyone else.

**Reads and writes.** Ordinary traffic goes through one Nostrify `NPool` aimed
at the configured relay. Reads that matter distinguish "the relay answered
empty" from "the read did not complete" (`src/lib/relay-read.ts`), because a
timeout must not be mistaken for an empty inventory or an empty nest. Writes
that move value go through a strict publish where a timeout counts as unknown,
not as success. Item definitions and other games' inventories are read from a
small fixed relay list in addition to the configured relay.

**Presence and chat.** Presence is an addressable event per browser session
with a short NIP-40 expiry and a heartbeat; when the heartbeat stops the player
disappears from other clients. Movement is published as a goal and interpolated
locally. Chat is an ephemeral event with a ten-second expiry. This gives
shared-room awareness. It is not a server-authoritative shared simulation.

## Nostr kinds

The registry in `src/protocol/event-registry.ts` is the source of truth for
the game kinds, official item addresses and issuer key.
[`docs/protocol/blobbi-island-event-registry.md`](docs/protocol/blobbi-island-event-registry.md)
is generated from it (`npm run docs:registry`) and a test fails if the two
drift. [`NIP.md`](NIP.md) explains the protocol in prose.

| Kind | Purpose | Origin |
|---|---|---|
| 31124 | Blobbi pet state (stats, stage, appearance) | Blobbi ecosystem, via `@blobbi-kit/core` |
| 1124 | Care interaction log entry | Blobbi ecosystem |
| 11125 | Owner profile (owned Blobbis, current companion) | Blobbi ecosystem |
| 31632 | Item definition, signed by the official issuer | `@nostr-games/inventory` |
| 31633 | Player inventory and balances | `@nostr-games/inventory` |
| 31634 | Equipment placement | `@nostr-games/inventory` |
| 1416 / 1417 | Spend against an inventory / fold manifest | `@nostr-games/inventory` |
| 31950 | Room presence | Island |
| 21201 | Room chat | Island |
| 31951 / 21951 | Shared playback session / command | Island, experimental |

None of the project-defined kinds are NIPs. The Blobbi and Island numbers are
conventions of this ecosystem, the inventory kinds are defined by the shared
package, and the playback kinds are unregistered and marked experimental in
`NIP.md`. Standard kinds are used where they fit: kind 0 for names and avatars,
kind 1 for the photo-booth share, and Ditto's theme kinds (36767, 16767, 30078)
for theme interop.

Trust follows authorship. A pet, placement or spend counts only when signed by
its owner. An item is official only when its full address
`31632:<issuer>:<d>` matches the registry with the issuer half fixed in code;
a `d` tag, a name or an event id never identifies an item on its own.

## Inventory and other games

Island uses [`@nostr-games/inventory`](https://github.com/Danidfra/nostr-games-inventory)
for items and inventories. Item definitions are kind 31632 events signed by an
issuer; a player's inventory is one addressable kind 31633 event holding
quantities keyed by item address. Island writes exactly one inventory per
player, `d = blobbi:island`, and coins, tickets and items are all quantities in
it.

All Island inventory writes go through one transaction primitive: a cross-tab
Web Lock, a fresh authoritative read (an empty answer is confirmed with a second
read before it may become the base of a write), a rebuild that preserves tags it
does not understand, and a strict publish. A shop purchase applies the coin
debit and the item grant to the same inventory snapshot and publishes them as
one inventory event.

**Other games' inventories.** Island also queries every kind 31633 the same
player has authored, whatever the `d`, so a game it has never heard of can
credit the player and be noticed. A short issuer table
(`src/inventory/trusted-issuers.ts`) says whose item definitions may be parsed
and displayed. Being trusted grants nothing else: it does not make an item
purchasable, equippable or usable. What can be done with a foreign item is a
separate compatibility profile; today the only one is raw produce, which can be
fed to a Blobbi.

**Nostr Farm** is the integrated external game right now. The path is:

1. Farm credits produce to the player's Farm inventory.
2. Island discovers that inventory and the Farm issuer's definitions, keeps a
   live subscription on it for the session, and shows an in-game notice when a
   quantity rises.
3. Compatible produce can be fed to the Blobbi.
4. Island records that use as a player-signed kind 1416 spend against the Farm
   inventory, then applies the care effect.

Island never replaces another game's inventory snapshot and never publishes a
fold manifest for it. The effective balance is derived from the snapshot, the
spends and the fold chain; when that chain cannot be resolved the item shows as
unavailable and nothing is spent against it, rather than guessing from the raw
number. Details are in
[`docs/INVENTORY_ARCHITECTURE.md`](docs/INVENTORY_ARCHITECTURE.md) and
[`docs/connected-experiences.md`](docs/connected-experiences.md).

## Trust and limitations

- **The economy is client-trusted.** Game results are computed by the client,
  priced by a local policy, and written into the player's own inventory with
  the player's own key. A modified client can give itself any balance or
  reward. Balances are not proof of anything and should not back a leaderboard,
  scarcity, or real value.
- **Ledgers and locks are per browser profile.** They stop an honest client
  from applying the same operation twice after a reload or a double click. They
  do not give exactly-once behaviour across devices.
- **Replaceable events are newest-wins.** Nostr has no compare-and-swap, so
  two devices writing the same inventory or pet can overwrite each other. The
  client reads fresh before writing, which narrows the window without closing
  it.
- **Key storage.** Logging in with a pasted secret key stores it, through the
  login provider, as JSON in `localStorage`. Extension (NIP-07) and bunker
  (NIP-46) logins keep the key out of the page.
- **Safety controls are local.** Mute, block and report change what this
  client shows. Nothing is published and nothing hides you from anyone else.
- **Presence is awareness, not authority.** Two players can claim the same
  seat; clients resolve it locally.

The pre-alpha security notes are in
[`docs/security-audit-pre-alpha.md`](docs/security-audit-pre-alpha.md).

## Shared packages

Island consumes four shared packages, resolved from the public npm registry and
developed under the same GitHub owner.

- [`@blobbi-kit/core`](https://github.com/Danidfra/blobbi-kit): the pet kinds,
  parsers, seed and trait derivation, XP and streak math. Framework-free.
- [`@blobbi-kit/react`](https://github.com/Danidfra/blobbi-kit): React hooks over
  core.
- [`@blobbi-kit/renderer`](https://github.com/Danidfra/blobbi-kit): draws a Blobbi
  as SVG from plain visual data. Knows nothing about Nostr.
- [`@nostr-games/inventory`](https://github.com/Danidfra/nostr-games-inventory):
  item, inventory, placement, spend and fold events.

What Island keeps versus what it takes from the kit is tabulated in
[`docs/blobbi-kit-adoption.md`](docs/blobbi-kit-adoption.md).

## Repository layout

```
src/
  protocol/        event registry and the generated-doc test
  inventory/       inventory transaction, coin wallet, shops, cross-game reads
  placement/       equipment placement policy and mutations
  effects/         visual-effect activation
  lib/             world coordinates, boundaries, routing, pose, presence,
                   per-room config tables, ledgers, relay reads
  arcade/  mine/  beach/   game models, pure and deterministic
  communication/   chat message classes, parsing, rate limits
  safety/  player-safety/  external-egress/   capability policy, mute/block, links out
  components/      React UI; components/blobbi is the world, components/shell the frame
  hooks/           data hooks (pets, profile, presence, rewards)
  pages/           the game page, /tools/game-items, and /dev/* harnesses
docs/              design and audit documents
docs/protocol/     generated registry, playback spec, item publication runbook
NIP.md             protocol description
```

Most files in `docs/` open with a status line. Some are current contracts,
some are dated audits kept as a record, and a few are marked superseded. Read
the status line before trusting a document.

Architecture is enforced rather than assumed. Dedicated boundary tests read the
source tree and assert import rules (for example, nothing under `src/arcade/`
can reach a relay or the inventory, and only one module may call
`window.open`). ESLint runs with inline disables turned off.

## Development

Node 24 is required (`.nvmrc` pins the exact version; `planck` needs it).

```bash
npm ci
npm run dev        # http://localhost:8080
npm test           # typecheck, ESLint, Vitest, production build
npm run build
```

`npm test` is the full check. The individual steps are
`npx tsc -p tsconfig.app.json --noEmit`, `npx eslint`, `npx vitest run` and
`npx vite build`.

You need a Nostr key to play. The login dialog accepts a NIP-07 extension, a
NIP-46 bunker URI, or an nsec, and can generate a new key with a downloadable
backup.

Six `/dev/*` routes (rooms, theater, arcade, equipment, effects, treasure hunt)
exist only in development builds and publish nothing. `/tools/game-items` ships
in production for item authoring. Its Inventory and Equipment Lab is off unless
`VITE_ENABLE_LIVE_INVENTORY_LAB=true` is set at build time
(`npm run dev:inventory-lab`); with it on, the lab publishes real inventory and
placement events for the logged-in account. See
[`docs/inventory-equipment-lab.md`](docs/inventory-equipment-lab.md).

## Testing

Vitest with jsdom, 409 test files, 7164 tests passing and 3 skipped at the time
of writing. Beyond ordinary unit and component tests (`src/test/TestApp.tsx`
mounts the real provider stack), the suites worth knowing about are:

- registry drift: the generated protocol doc and the item publication runbook
  are rebuilt and compared byte for byte
- boundary tests: import graphs and source text checked against the rules above
- inventory: concurrency, cross-tab races, coin delta invariants, spend
  reconciliation, write topology
- relay reads and presence identity

Relay-facing behaviour is generally exercised through mocks and test doubles.
The test app mounts the real provider stack, and the suite is not structured to
guarantee complete network isolation. There is no browser end-to-end suite.
There is a
GitLab pipeline and there are GitHub workflows, but the GitHub ones watch a
branch that is not where development happens, so do not read GitHub Actions
status as validation of the current code.

## Deployment

`npm run build` produces a static bundle in `dist/` with `404.html` copied from
`index.html` for single-page routing. It can be served from any static host
that falls back to `index.html` for unknown paths. The repo carries
configuration for more than one host; none of it is documented here as the
canonical deployment.

## Status

Pre-alpha, actively developed. The shared-playback kinds are experimental and
may change. The economy is client-trusted by design at this stage; see the
limitations above before building anything on top of balances.
