# Presence data minimization

**Status:** implemented. `detailedPresence` is enforced at a real boundary, and
it was the last capability that was only declarative.

**No new kind, tag or schema.** Kind 31950 is unchanged; one existing optional
field gains a reserved value, recorded in [`NIP.md`](../NIP.md#kind-31950--island-presence-addressable-nip-40-expiration).

- Capability model: [`family-safety-policy.md`](./family-safety-policy.md)
- Who is a remote actor: [`multiplayer-identity.md`](./multiplayer-identity.md)

---

## 1. The wire, as it stands

One addressable event per browser session, renewed every ~25 s and expiring at
35 s (NIP-40). Six publishers, login, move, hide, sit, activity, heartbeat,
all funnel through `buildPresence31950`.

```
tags   d            session:<uuid>          one presence per session
       a            31124:<pubkey>:<d>      which Blobbi is being shown
       t            blobbi:presence         global index
       t            island:<id>             island scope
       t            loc:<location>          room scope, relay-level filtering
       expiration   <unix-seconds>          NIP-40

content
       state        idle | moving | emote
       location     <locationId>
       anchor       { x, y, ts }            percentages of the playable area
       goal?        { from, to, v, ts }     a walk, interpolated by the receiver
       hiddenIn?    <hiding-spot-id>
       seatId?      <theater-seat-id>
       activity?    { type, session }
       seq?         <monotonic counter>
       blobbiD?     <blobbiD>               never published; see §2
```

## 2. Field by field

The question asked of every field was the same: **if this disappeared, could
another client still render this player and play alongside them?** Only one
field failed it.

| Field / tag | Produced by | Consumed by | Why it exists | Required? | Coarse decision |
|---|---|---|---|---|---|
| `d` = `session:<uuid>` | every publisher | `admitRemotePresence`, the player key, newest-session-per-pubkey | identity of one client, and the backstop that stops your own presence becoming a second copy of you | yes | **keep** |
| `a` = `31124:pk:d` | every publisher | visual fetch, `parseA` | which Blobbi to draw | yes | **keep** |
| `t: blobbi:presence` | every publisher | subscription filter | finding presence at all | yes | **keep** |
| `t: island:<id>` | every publisher | subscription filter | island scope | yes | **keep** |
| `t: loc:<location>` | every publisher | subscription filter, location-change eviction | relay-level room filtering | yes | **keep**: see §11 |
| `expiration` | every publisher | `isPresenceAlive`, validator | stale players disappear on their own | yes | **keep**: see §12 |
| `state` | every publisher | `hasActiveGoal` | distinguishes a walk from a heartbeat | yes | **keep** |
| `location` | every publisher | actor filtering, location mismatch eviction | a player in another room must not be drawn in this one | yes | **keep** |
| `anchor` | every publisher | position, walkability search, gaze | where the Blobbi is | yes | **keep**: see §7, §9 |
| `goal` | move | `posAt` interpolation, walk target | smooth remote motion | yes | **keep**: see §8 |
| `hiddenIn` | hide, heartbeat | `visualHidden`, gaze exclusion | conceals a hidden Blobbi | the FACT, yes; the ID, no | **value withheld**: §6 |
| `seatId` | sit, activity, heartbeat | `resolveRemoteSeatOccupancy`, seated render | two players cannot share a chair | yes | **keep**: see §10 |
| `activity` | move, sit, activity, heartbeat | participant lists, co-play | who is watching together | yes | **keep**: see §10 |
| `seq` | every publisher | `isSupersededPresence` | orders two events in the same second | yes | **keep** |
| `anchor.ts` | every publisher | nothing | a second timestamp beside `created_at` | no consumer | kept, part of an interoperable shape, and not disclosure |
| `blobbiD` (content) | **nothing** | overwritten from the `a` tag on read | historical | already dead | nothing to remove |

## 3. Standard

Unchanged, byte for byte. `projectPresenceForPolicy` returns the very same
object under a detailed policy, and the existing presence suites, hiding,
seating, activity, ground conversion, location resume, pass without a single
assertion being touched. That is the proof, not the claim.

## 4. Coarse

One change: the **value** of `hiddenIn` becomes the reserved marker `"hidden"`.
Everything else is published exactly as Standard publishes it, at full
precision.

That is a smaller result than the phase set out to find, and it is the honest
one. Every other field has a consumer that breaks without it, and each of those
is proven by a test rather than asserted here.

## 5. What was NOT removed, and why the alternative was worse

Two fields look like obvious candidates and are not.

**Omitting `hiddenIn` entirely un-hides the player.** A remote client with no
hiding claim renders the Blobbi normally, standing, visible, at the coordinates
they are hiding at. Minimizing the field harder would take somebody who is
invisible and put them in plain sight, in the bush, for everyone. There is a
test that renders exactly that.

**Omitting `goal` stops remote players moving.** With no goal the receiver's
target falls back to the anchor, which is where the walk *began*, so a remote
Blobbi stands still until the next heartbeat up to twenty-five seconds later.
Privacy minimization is not allowed to invent worse gameplay.

## 6. `hiddenIn`: the reason this capability exists

A player hides in a bush. Every stock client draws nothing. And the event says
`hiddenIn: "town-bush-3"`: a machine-readable statement of the one thing the
player just asked the game to conceal.

The spot id has **no rendering value**. The remote path tests it for truthiness
and nothing more: `MultiplayerLayer` builds `{ kind: 'hidden', spotId }`,
`resolveActorRender` returns `visualHidden: true`, and the gaze pass excludes
anyone hidden so nobody stares at the bush and gives them away. The only place
an exact id is compared against a real spot is a bush asking whether the LOCAL
player is inside it; never a remote's.

So the fact is load-bearing and the identifier is not. Coarse presence keeps the
fact and withholds the identifier.

`"hidden"` is a reserved, non-identifying member of an existing optional field's
vocabulary: not a new field, tag, kind or schema. It must be a non-empty
string, because every consumer decides by truthiness and an empty one would read
as "not hidden". Tests assert it collides with no configured bush and no seat.

**A coarser representation was considered and rejected.** `state: "hidden"`
would have been cleaner, but `state` is a closed enum meaning *motion*, other
clients validate against it, and adding a member is a schema change this phase
is not authorised to make. The reserved value is additive and degrades correctly
on every client that already exists.

## 7. Coordinate precision, deliberately unchanged

Quantizing was considered and rejected. These are percentages of a virtual
room's playable area. `47.183729 → 47.2` changes no meaningful privacy property,
the player is still identifiably next to the same bush, while introducing
visible stepping into interpolated motion and pushing walk targets off the
walkability grid. There is no single canonical quantizer because there should
not be one, and a test asserts coordinates survive the projection intact.

## 8. `goal`: kept, at full precision

It is the only reason remote motion is smooth: a walk is broadcast once as
start/end/velocity/timestamp and each client interpolates locally, rather than
streaming positions. It does disclose a destination up to a second or two before
the player arrives there, recorded honestly, and worth far less than the
movement it buys.

## 9. The anchor still says where a hidden player is

Stated plainly because it is the limit of what §6 achieves: the position is
published while hidden, and in a room whose geometry is public that is enough to
work out which bush.

Withholding the position instead was measured and rejected. A reveal walks the
Blobbi from its last known position, so a false one there makes the player step
out of the wrong place, a visible, permanent artefact traded for a marginal
gain against an observer who already has the coordinates. Fixing that properly
means changing how a reveal is rendered, which is a gameplay change and not this
phase.

## 10. `seatId` and `activity`: kept

`seatId` is not decoration: `resolveRemoteSeatOccupancy` uses it to decide who
wins a contested chair (lowest hex pubkey), and coordinates cannot answer the
question: three seat rows overlap, chairs are 96 px apart, and the published
anchor is the walk-to cushion point rather than the render anchor. Without it,
two players sit in one seat on every screen.

`activity` carries a session ADDRESS and nothing else; no revision, no
playhead, no media. It is what lets the room answer "who is watching this
together?" without enumerating relay state. Both are virtual, in-room facts that
a player standing in the same room can already see.

## 11. `loc` stays a tag

The room is in a tag because that is how a relay filters presence to the room
the player is standing in. Removing it would not hide the room; it would leave
the player unable to find anybody in it, and would move the same information
into the content anyway. A test asserts both policies publish identical tags.

**This means a coarse client still discloses which VIRTUAL ISLAND AREA a player
is in**: Town, Beach, the theater. That is a room in a game, not a geographic
location, and nothing here reports or infers where anybody physically is.

## 12. Expiry is untouched

Heartbeat ~25 s, `expiration` at 35 s, client staleness at `EXP_SECONDS + 5`.
Unchanged: no privacy is bought by letting stale events live longer, and doing
so would leave ghost actors standing in rooms their players had left.

## 13. Mixed profiles

There is one protocol and one room. A coarse client understands every field a
detailed one sends, and a detailed client renders a coarse one with fields
missing: they were already optional. Tested in both directions: movement,
hiding, seats and shared activities all work across the pair, and neither
profile filters the other out.

## 14. What a coarse presence still reveals

Not a private mode. A coarse presence still tells anyone reading the relay:

- the **pubkey** publishing it;
- that the account is **active in Blobbi Island right now**;
- which **island and room** they are in;
- which **Blobbi** they are showing (the `a` tag);
- their **position** and, while walking, their **destination**;
- that they are **hidden**, seated, or in a shared activity, and which session;
- **timestamps and an expiry**, inherent to the event.

And the limits of the mechanism itself:

- it constrains what **this client publishes**, and nothing else;
- a **modified client** can publish whatever it likes, at any detail;
- a **relay** sees and may retain everything, and can see an IP;
- presence is **public**: anybody may subscribe;
- the room's geometry is public, so coordinates imply what §9 describes.

## 15. Runtime behaviour

The policy is read at PUBLISH time, from a ref. A heartbeat interval is built
once per location and lives for the whole visit, so a policy captured by value
would keep publishing at the old detail level until something rebuilt it, for a
player standing still, never. A change therefore takes effect on the next
publish with no reload, and destroys no runtime state: the session, the
subscription and the player map all survive it.

The local runtime keeps everything. The game still knows exactly which bush its
player is in, because it has to; this phase changes **disclosure, not
simulation**.

## 16. Pre-activation note

Presence publishes as soon as the world mounts, and the safety context currently
defaults to Standard when no provider resolved a profile. Today that is correct,
Standard is the only shipped experience, but once a profile can be selected,
a login presence could be published at full detail before the stored choice
resolves. **Recorded as an activation requirement**, not fixed here: the fix is
to make the absence of a resolved policy a bug rather than an answer, which is
the same precondition `family-safety-policy.md` already records for the
provider.
