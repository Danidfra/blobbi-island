# Safe user-authored names

**Status:** built in full. **No Nostr kind, tag or schema changed**: the name
is still a plain `name` tag on kind 31124, published by the same writer.

| | Built | Selected by a shipped profile |
|---|---|---|
| **own naming** (`ownFreeTextNaming`) | ✅ | ✅: Family is curated |
| **stranger names** (`strangerAuthoredNames`) | ✅ | ❌, **dormant**, see below |

> ### Update (2026-08-25, Phase F.1): remote-name substitution is dormant
>
> The shipped Family policy now sets `strangerAuthoredNames: true`, so a
> curated player currently sees the names other players chose. Everything in
> §3, §5 and §6 below still works and is still tested, against a hand-built
> policy rather than a profile, because no shipped profile selects that branch
> today.
>
> **Why:** not a failure of the implementation, a product question underneath
> it. An island where every stranger is "Sunny Fox", and two of them share that
> alias because the generator's space is small, is not obviously better for a
> child than one where names are real. Friends, local nicknames and
> relationship-aware naming all change the answer, and none of them exist yet.
> Alias disambiguation, pubkey suffixes and collision handling were all
> considered and deliberately NOT built: they are answers to a question that has
> not been asked properly.
>
> **What did not change:** own naming is still curated under Family and still
> validated at the writer; free-text chat is still dropped rather than masked;
> the classifier is still defence in depth with one consumer. The capability
> matrix was updated to say `true` rather than leaving it `false` and rendering
> authored names anyway, an honest gap beats a matrix that lies.
>
> **To restore it:** set the capability back to `false`. There is nothing to
> rebuild.

- Rationale: [`family-safety-audit.md`](./family-safety-audit.md) (finding H-1)
- Capability model: [`family-safety-policy.md`](./family-safety-policy.md)
- Chat, which is deliberately different: [`communication-v2.md`](./communication-v2.md)

---

## 1. The threat

A Blobbi name is up to thirty-two characters of free text. Its owner publishes it
in kind 31124 and it is rendered above their Blobbi to everyone in the room.

After Phases B–E it was the **last** surface where a stranger could put words of
their own choosing in front of a curated player. Chat is structured, item names
are issuer-locked, theater media is catalogued, a name field was the way
through.

Two separate problems, and they need different answers:

| | Problem | Answer |
|---|---|---|
| **Stranger names** | someone else's text on your screen | deterministic alias |
| **Own naming** | a child typing their real name, school or age into a box the game invited them to fill in | approved-word composer, enforced at the writer |

## 2. The name lifecycle

```
OWN NAME
  hatching ceremony (input | composer)
    → admitOwnBlobbiName(policy, name)      ← THE WRITER BOUNDARY
      → kind 31124  ["name", "…"]
        → local HUD, cards, modals

REMOTE NAME
  kind 31124  ["name", "…"]
    → getBlobbiDisplayName(tags)             existing tag-priority resolver
      → resolveRemoteBlobbiDisplayName(…)    ← THE DISPLAY BOUNDARY
        → BlobbiVisual.name
          → hover label · title · aria-label · actor tooltip · info modal
```

**There is no rename.** `finalizeAdoption` is the only writer of a Blobbi name,
which is why one check covers the whole own-name path. A boundary test asserts no
second module writes a `name` tag alongside kind 31124, so adding a rename fails
that test: which is exactly when the decision to route it through the same
validator has to be made.

## 3. Where the boundaries are

### Remote names: at the model, not the components

A stranger's authored text becomes `BlobbiVisual.name` in **two** places, and
both now resolve through the same function:

- `MultiplayerLayer.fetchBlobbi31124`: the presence-driven visual;
- `PlayingView.handleOtherBlobbiClick`: the info modal's later refresh from the
  full event, which would otherwise have undone the first.

Everything downstream reads `visual.name`: the hover label, its `title` and
`aria-label`, the actor tooltip, the read-only modal's heading. Patching each
would have been six chances to miss one, and the seventh gets added next month.

The stranger's own event is untouched. Nothing is rewritten on a relay; their
words simply never become display text.

### Own names: at the writer, not the composer

`admitOwnBlobbiName` runs as the **first statement** of the adoption run,
before the profile is read, before anything is signed, before anything reaches a
relay. A test asserts that ordering and that `signEvent` is never called for a
refused name.

The composer is how a player produces something that passes. It is not what
makes the rule true.

## 4. Standard behaviour

Unchanged, deliberately: and since Phase F.1, this is what **both** shipped
profiles do for stranger names.

- Stranger names render as authored, exactly as before.
- Own naming keeps the free-text field, the 32-character limit, and the existing
  trim/non-empty rules.
- **Standard is not quietly censored.** The prohibited-text classifier is not
  applied to it. Adding a restriction to an existing experience is a product
  change, and this phase does not smuggle one in, a test asserts a hostile
  authored name still renders under Standard.

## 5. Curated behaviour

### Stranger names → deterministic alias, always

> Dormant since Phase F.1: no shipped profile sets this capability `false`. The
> rule below is what happens when one does, and it is tested that way.

`strangerAuthoredNames: false` means **never show an authored name**, not "show
it if it passes a profanity check".

That distinction is the whole design. A filter would pass `come find me on
discord`, which is clean, and which is the message that actually matters. So the
substitution is unconditional: even a perfectly innocent `Rocket` becomes an
alias, because the rule is about *whose words reach the screen*, not about which
words they are.

### Own names → approved vocabulary

```
  Choose a name
  [ Sunny  ▼ ]  [ Puff  ▼ ]
        Sunny Puff
```

Sixteen adjectives × sixteen nouns = **256 combinations**, every word and every
pairing read. The longest, `Bouncy Sparkle`, is fourteen characters, comfortably
inside the existing limit.

Validation is **structural, not filter-based**: exactly two words, single space,
both from the lists, in that order. `Hello Friend` is refused. `message me on
telegram` is refused. `Rocket` is refused. A modified client does not send
profanity: it sends a clean sentence, and only a closed vocabulary refuses one.

The published name is an ordinary name string. No new kind, no naming event, no
`curated_name` tag.

## 6. The alias

`safeBlobbiAlias(pubkey)` **reuses the existing `genUserName`** rather than
inventing a second identity-naming system. It already satisfies everything an
alias needs: deterministic from a pubkey, no relay lookup, no authored input,
stable across renders and reloads, ASCII letters and one space, bounded length,
and its vocabulary is clean. A test asserts a broad sample of outputs against the
prohibited-text classifier, so "clean" is checked rather than assumed.

It is wrapped under its own name so the intent is legible at the call site and so
the vocabulary can diverge later without touching consumers.

**Not a security identifier.** The generator's hash is small and collisions are
common: two strangers can share an alias. That is fine for a label whose job is
"something to call them". Where identity matters, the pubkey is used instead: the
block/mute settings list shows an abbreviated npub for exactly this reason.

## 7. The prohibited-text classifier

`src/user-text/`: a small, reusable primitive that safety surfaces invoke
**deliberately**. It is not applied to every string in the app; a boundary test
asserts it has exactly one consumer today.

### Normalization

NFKD → drop combining marks → drop control characters → lowercase → optional
digit/symbol folding. That covers case, accents, full-width Latin, zero-width
characters and `sh1t`/`$hit`.

Matching is done against **both** the folded and unfolded forms, because the two
goals conflict: folding `1`→`i` catches `sh1t` and simultaneously destroys the
digit boundary that catches `fuck123`. Checking twice can only add matches, never
false positives.

### Matching, and false positives

Each term compiles to a pattern requiring a **letter** boundary on each side,
with `[\W_]*` between its letters to absorb separators (`f.u.c.k`, `f u c k`,
`f-u-c-k`). Separators exclude letters and digits, so an intervening real word
breaks the match rather than being skipped.

Digits are deliberately not boundaries: `fuck123` is the same word with a number
on it.

The naive version, `value.includes('ass')`, blocks *class*, *grass*, *pass* and
*assassin*. The test suite pins a list of words that must survive: `Scunthorpe`,
`Penistone`, `Sussex`, `Essex`, `Middlesex`, `unisex`, `peacock`, `cockatoo`,
`shiitake`, `Matsushita`, `analysis`, `therapist`, `assassin`, `Dickens`,
`Cumbria`. A filter that blocks those teaches players the safety system is
broken, and a player who believes that stops reporting what it misses.

Mild profanity and ambiguous words are absent by choice: blocking `damn` buys
nothing, and blocking `ass` breaks innocent words for people who did nothing.

### Vocabulary scope

Small, curated, English, grouped so another language can be added as a sibling
list. **Explicitly not exhaustive.**

## 8. Chat is different, and stays different

**Communication V2 is untouched.** A free-text message under a curated policy is
**dropped at ingest** and never rendered.

It is not run through the classifier and rendered masked, and that is a
deliberate refusal rather than an omission:

- `$%&#@` still tells a child that someone is shouting at them;
- the classifier would pass `come find me on discord` unchanged, which is the
  message that matters;
- dropping is structural and works on text nobody has written yet.

Three boundary tests enforce this: the communication layer must not import
`@/user-text`, `chat-admission.ts` must not mention it, and the free-text
capability check must still decide by class rather than by content.

## 9. Existing names are not migrated

A player who named a Blobbi under free-text naming and later moves to a curated
experience keeps that name. Nothing rewrites their kind 31124, and nothing
renames their pet.

`ownFreeTextNaming` restricts **what may be created**, not what already exists,
its own documentation calls it "name your own Blobbi with free text", which is an
authoring capability. Destroying a name a child chose, in the name of protecting
them, would be a worse outcome than the one being prevented.

The asymmetry is deliberate and worth stating: **the player keeps seeing their
own historical name; strangers under a curated policy never see an authored name
at all**, theirs included. The protection is about what arrives on *your* screen
from someone else, and a player's own pet is not that.

## 10. Policy changes recompute

Remote names are resolved where a stranger's event becomes a visual, and that
result is cached per Blobbi address. A naming-policy change now clears that cache
and drops the cached visuals, so already-visible players re-resolve.

Without it, changing the policy would leave authored names on screen until a
reload: and a safety control that needs a page refresh is one that did not take
effect. Family is not selectable yet, and since Phase F.1 both shipped profiles
agree on this capability anyway, so this cannot fire today; it is here so that
the day it can, the architecture already behaves.

## 11. UI and accessibility

The composer uses native `<select>` elements: the best touch control on every
phone with no work, keyboard- and screen-reader-correct by default, and rendered
in place rather than through a portal (the ceremony runs inside the island's own
frame). Each has an `sr-only` label, and the assembled name is announced through
`aria-live="polite"` so a screen reader hears it change.

There is no disabled text field and no copy explaining what the player may not
do: an experience without free-text naming simply has a chooser instead. No age
language anywhere.

## 12. Limitations

**A denylist is not moderation.** It can be evaded by new spellings, other
languages, coded language, homographs, context, and innocent words used cruelly.
It is defence in depth and nothing more.

The protections that actually hold are structural:

| Surface | Protection | Why it holds |
|---|---|---|
| curated free-text chat | no free text at all | works on text nobody has written |
| curated own names | approved vocabulary only | refuses clean sentences too |
| curated stranger names | deterministic alias | never consults the text |

Also unresolved, and out of scope here:

- **Both shipped profiles render whatever a stranger typed** (Phase F.1). The
  restriction exists and is unselected; see the status note at the top.
- **Alias identity is unsolved, and that is why the substitution is dormant.**
  No disambiguation, no pubkey suffix, no local nickname, no contact-aware
  naming: deliberately unbuilt. Deciding the social identity model comes
  first.
- **`useThemePublish` publishes kind 36767 with a player-chosen theme name**,
  player-authored public content with no capability governing it. Recorded as a
  consumer for a future user-authored public-content pass. Blobbi-name vocabulary
  must NOT be applied to theme names; they are a different domain.
- **`EditProfileForm`** remains dead code that would upload an avatar and publish
  kind 0. It is not on the Blobbi-name path. Still pre-activation debt.
