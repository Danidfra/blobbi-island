# Connected Experiences

The Nostr Station is where Blobbi Island points players at independent
Nostr-powered apps and games. This document describes the first product-facing
milestone: one connected experience, Nostr Farm, launched externally.

## 1. The product idea

Grow food in Nostr Farm and bring it back to feed your Blobbi.

The Station communicates that idea and hands the player over. Nothing more is
built into the Island: no embed, no shared session, no bridge. What the player
earns in Farm reaches the Island the way everything else from another game
does, as Nostr events read back by the inventory (`docs/INVENTORY_ARCHITECTURE.md`).

## 2. Where things live

| Concern | Module |
| --- | --- |
| The registry: name, copy, destination, launch mode | `src/connected-experiences/connected-experiences-config.ts` |
| The one-time launch note (local, best effort) | `src/connected-experiences/launch-hint.ts` |
| The Station's one interface, the Nostr Hub, and its section navigation | `src/components/NostrHubModal.tsx` |
| The Connected Experiences section (the Farm card and its launch) | `src/components/blobbi/nostr-station/ConnectedExperiencesSection.tsx` |
| Opening the tab: capability, validation, confirmation, opener isolation | `src/external-egress/` (`docs/external-egress-safety.md`) |
| Farm produce in the inventory, with its source label | `src/inventory/trusted-issuers.ts`, `src/inventory/useExternalInventoryEvents.ts` |
| The moment after a feed: the Blobbi's reaction, the real stat gain, the source | `src/inventory/care-feedback.ts`, `src/components/blobbi/CareReaction.tsx`, `src/components/blobbi/useCareReaction.ts` |
| The live store for the whole session, and the arrival notice on return | `src/components/ExternalInventoryController.tsx`, `src/inventory/external-arrivals.ts`, `src/inventory/useExternalInventoryArrivals.ts` |
| Independence guard | `src/connected-experiences/boundaries.test.ts` |

The official Farm URL, `https://farm.blobbi.pet`, is written once, as
`NOSTR_FARM_URL`. A structural test fails if the host appears anywhere else in
`src/`. `VITE_CONNECTED_EXPERIENCE_URL_NOSTR_FARM` points a build at a local or
staging deployment without touching the registry.

## 3. The registry

```ts
interface ConnectedExperience {
  id: string;                 // stable; storage keys hang off it
  name: string;
  tagline: string;            // one line, what the player does there
  description: string;        // player language only
  interoperability: string;   // why it belongs here: what comes back
  url: string;                // absolute https:
  launchMode: 'external';     // the only mode today
  sourceLabel?: string;       // the inventory's label for items from here
  image?: string;
}
```

`launchMode` is a union so `embedded` or `auto` can be added in one place later.
Nothing implements them, and nothing should until the questions an embed raises
(signer availability, partitioned storage, session ownership, mobile browsers)
have answers. The registry knows nothing about a partner's protocol, issuer key
or item schema; a change on either side never requires a change on the other.

## 4. The Station interaction

The four VR chairs are the Station's terminals.

1. A click on a chair walks the Blobbi to its approach point.
2. On confirmed arrival the Blobbi sits (VR headset on, see
   `docs/blobbi-actor-architecture.md` §7.1) and the Nostr Hub, the Station's
   existing terminal interface, opens over the room straight into its
   Connected Experiences section (`NostrHubModal initialSection`). The hub's
   other sections (Educational, Social, Future Box) keep their place and
   their expand-in-place navigation.
3. Closing the hub leaves the Blobbi seated. A click on the occupied chair
   opens it again without standing up (`RoomSeat.onSeatedClick`).
4. Walking anywhere stands the Blobbi up, as in every room.

The section shows Nostr Farm: name, tagline, description, an interoperability
line, a "Works with Blobbi Island" mark, and one launch action. Below it a
single non-interactive line says more experiences are coming. There are no
placeholder cards. The Escape key inside the egress confirmation closes the
confirmation only; the hub stays open underneath.

## 5. Launch lifecycle

```
Open Nostr Farm
  → requestEgress({ class: 'external-link', url, label: 'Nostr Farm' })
      → capability check (externalLinks)          denied → false, nothing opens
      → destination validation (https:, external) refused → false
      → "Leaving Blobbi Island" confirmation       Cancel → false, nothing opens
      → performEgress: window.open(url, '_blank', 'noopener,noreferrer')
  → true
      → first launch on this device: the panel shows
        "Harvest food in Farm, then come back here. Your produce will appear
        in your inventory automatically." and remembers that it did.
```

The Island tab never navigates. The hub stays open on the section, the Blobbi
stays seated, the live inventory subscription stays connected. The confirmation names
the parsed host (`farm.blobbi.pet`) as the authority and the experience's name
as context under it.

Under the Family profile `externalLinks` is off. The section says so in player
words and disables the action; the egress boundary would refuse regardless.

## 6. The return path

There is no return protocol. The player comes back to the Island tab. The
external-inventory live tail (`useExternalInventoryLiveTail`, run by
`ExternalInventoryController` at the app root for the whole session) holds one
relay subscription per relay and applies Farm's kind:31633 snapshots as they
arrive, so produce harvested while the Island tab was in the background is
already there. When the tab becomes visible again the tail also issues one
authoritative refetch, covering a socket that a browser silenced without
dropping. No polling was added; both triggers are events, like `online`.

The tail and the visibility refetch used to run only while the My Blobbi
window was open, so the return showed nothing until the bag was next opened.
Now the store is live everywhere on the Island, and when an item's effective
quantity in a Farm inventory rises the player sees the same toast every other
Island moment uses:

```
+1 Strawberry
[🍓] Received from Nostr Farm
```

The number is the rise in the EFFECTIVE quantity (snapshot, pending spends and
fold chain, the number the bag shows), so feeding a Strawberry here and the
Farm folding that spend later never reads as an arrival; the first load after
opening the Island hydrates silently; the same state seen twice (both relays,
live then refetch, a remount) is one notice. Details and the guarantees:
`docs/INVENTORY_ARCHITECTURE.md`, "Arrivals".

### What the player sees, back on the Island

The whole cross-game idea has to be legible without a word about event
kinds, so the produce carries its origin at every step:

```
inventory tile      "Farm" pill on the Strawberry (the issuer's short label)
consume dialog      "From Nostr Farm" under the item, the button says "Feed Blobbi"
after the feed      the stage Blobbi bounces once; "+25 Hunger" floats off it,
                    then "From Nostr Farm" a beat later
```

The number is the applied change carried on the consumption result (the
clamped per-stat delta of that one action, times its quantity: a batch of two
shows `+50 Hunger`, a Blobbi at 90 shows `+10`), never a constant. The
provenance is the trusted issuer's product name; the item is never asked what
it is, so a new crop needs nothing here. Island's own food gets the same
reaction and no provenance cue. The moment plays only from the mutation's
success path with the effect present: a refused or unconfirmed spend, an owed
effect, or a resume that found the effect already on the pet shows the
existing toast and no reaction. It is keyed on the spend id, so one logical
consumption is one reaction however many times it is reported. Reduced motion
keeps the readout and drops the bounce and the float.

## 7. Independence

Blobbi Island does not import Farm code or components, use a Farm runtime API,
share a signer, share storage, use `postMessage`, or call a Farm-specific
endpoint. `src/connected-experiences/boundaries.test.ts` asserts the parts of
that which source can show: no Farm-shaped import or dependency, no iframe to
the Farm, no `window.open` / `postMessage` / message listener in the Station,
and the Farm host written once.

## 8. Not in this milestone

iframe embedding, nsite resolution, NIP-5A, discovery of experiences from
relays, changes to the Farm, other games, an educational curriculum, shared
auth, `postMessage`, new protocol kinds, new inventory semantics, Farm-specific
Island APIs, and a popup-blocked fallback (egress opens with `noopener`, so the
browser reports nothing either way; see `docs/external-egress-safety.md`).
