# Who is a remote actor

**Status:** fixed. The local player's Blobbi appears exactly once. The rule
lives at the presence ingest; nothing about the wire format changed.

- Presence protocol: `NIP.md` (kind 31950) and `src/lib/multiplayer.ts`
- The rule itself: `src/lib/presence-identity.ts`

---

## 1. What was seen

> Click to walk. The Blobbi moves normally — and a second, visually identical
> Blobbi appears behind it and follows.

## 2. What was actually happening

Presence is a **broadcast**. Every kind 31950 this client publishes comes
straight back down its own subscription, along with everybody else's, because
the filter is `#t: island / location` and not "not me". So "is this event mine?"
is not a detail of the ingest — it is the question that decides whether an actor
exists at all.

The client answered it by comparing the event's author against the local pubkey,
captured **by value** when the presence subscription was opened. That
subscription is opened once, at init, and rebuilt only on a location change. So
the comparison could be made against a value that was empty, or stale, and in
both cases the answer came back "not me".

The consequence is specific, and it is exactly what was reported. The echo
carries our own Blobbi address, so the visual fetch loads *our own* kind 31124 —
identical colours, identical name. It carries our own published movement goal,
which the remote path interpolates from `anchor` toward `goal.to` rather than
driving directly, so the copy arrives a beat late. A visually identical Blobbi,
walking our path, behind us.

### Three reproductions, all through the real world layer

`src/components/blobbi/MultiplayerLayer.identity.test.tsx` wires the round trip
up honestly — the publish mock stamps the author onto the template and pushes it
into the live subscription, exactly as a relay does — and each of these failed
before the fix:

| Trigger | Why the old check missed it |
|---|---|
| **identity resolves after the presence hook initialises** | the subscription captured `''`, so nothing ever matched it |
| **the player switches account under a mounted island** | the subscription still held the previous key |
| **a NIP-07 extension is switched to another account** | every event comes back authored by a key the app does not know is ours — identity *cannot* catch this one |

That last row is why there are two invariants rather than one.

### It was not caused by the naming work

Phase F touched all three files involved, which is suggestive and wrong. Its
changes are name resolution and a cache invalidation; neither creates, keys or
admits an actor. The identity comparison, the closure it lived in and the
`|| ''` fallback all predate it. Phase F is not implicated.

## 3. Actor identity

```
pubkey        WHO. One account is one actor.
sessionId     WHICH CLIENT. Random per mounted presence hook. Published as the
              `d` tag (`session:<id>`), which makes presence addressable — one
              live event per session.
blobbiD       WHAT they are wearing. The `a` tag is `31124:<pubkey>:<blobbiD>`.
              Appearance, never identity: two players can own identical Blobbis.
player key    `${pubkey}:${sessionId}` — the map key and the React key.
```

**The invariant:**

> A presence event becomes a REMOTE actor only if we know who we are, it is not
> authored by us, and it does not carry our own session id.
>
> The local actor is `MovableBlobbi`'s, rendered by `PlayingView`. It is never
> in the players map, and no presence event ever produces it.

Two independent rules, because they fail differently. Identity is canonical.
The session id is the backstop that still works when identity is unknown or
wrong — we generated it and we published it, so an event carrying it is ours
whatever we believe about our key.

And one precondition: **an unknown local identity admits nobody.** If we cannot
say who we are, we cannot say that somebody else is not us, and the safe answer
to "is this a stranger?" is no. Presence is advisory and self-healing, so the
cost is a briefly empty room against a phantom that never leaves.

## 4. Same account, twice

One pubkey is deliberately **one visible actor**. The ingest keeps only the
newest session per author (`latestSessionByPubkeyRef`) and evicts the others, so
a second tab or a phone moves that account's Blobbi to the newer session rather
than drawing two. There is therefore no legitimate case where the local player's
own key should appear as a remote actor — not another tab, not another device,
not a reconnect. The invariant costs nothing that the product wanted.

## 5. Where it is enforced

```
kind 31950 arrives
  → validatePresenceEvent            shape
  → admitRemotePresence(…)           ← IDENTITY BOUNDARY: before JSON.parse,
                                       before the visual fetch, before any
                                       state write
  → players map                      (`pubkey:sessionId`)
  → visiblePlayers                   ← defence in depth: never draw our own key
  → RemoteBlobbiSprite
```

At the ingest, not at the render. An actor filtered in JSX still exists: it
holds a map entry, an animation target, a live position the gaze loop reads, a
seat claim and an anchor a chat bubble can portal into. Hiding the last step
leaves all of that in place. The render filter is kept as a second wall — the
local player is drawn elsewhere, so a remote entry with our key is a visible
duplicate and worth refusing twice — but it is not the rule.

The same pass also stopped the subscription from pinning the ingest by value:
it now calls through a ref, so identity, policy and player state cannot age
behind a live subscription. That is what closes the class rather than the three
known paths into it.

## 6. Limitations

- **A hostile client can still publish presence claiming any Blobbi address.**
  Presence is unauthenticated beyond the event signature; this decides who *we*
  draw, not what anyone may publish.
- **`admitRemotePresence` cannot tell two honest sessions apart from one
  malicious pair.** It does not need to: the newest-session rule collapses them
  either way.
- **The relay-change path is separate and still open.** Changing relays rebuilds
  the pool but does not rebuild the presence subscription, so remote players go
  quiet until a location change. Unrelated to duplication; recorded here because
  it lives in the same lifecycle.
