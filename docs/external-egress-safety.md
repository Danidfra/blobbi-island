# External egress safety

**Status:** implemented. There is one boundary for leaving Blobbi Island, and it
owns the capability check, the URL validation, the confirmation and the browser
call. **No new Nostr kind, event or tag was created**: this phase touches no
protocol at all.

- Rationale: [`family-safety-audit.md`](./family-safety-audit.md) (findings H-3, H-4, H-6, M-3, M-4)
- Capability model: [`family-safety-policy.md`](./family-safety-policy.md)

---

## 1. The problem

Six places could take a player out of the island, each implementing it
themselves:

```
ShareModal          window.open(shareUrl, '_blank', 'width=600,height=400')
SocialShareModal    window.open(shareUrl, '_blank', 'width=600,height=400')
ShareModal          navigator.share(...)
GameItemTools       <a target="_blank">
ImageManager        <a target="_blank"> ← an author-typed URL
NoteContent         <a target="_blank"> ← an arbitrary URL from a Nostr note
```

Three consequences, all of them findings:

1. **No policy could apply.** `externalLinks`, `socialPlatformSharing` and
   `nativeShareSheet` had been declared in Phase A and enforced nowhere.
2. **No opener isolation.** None of those calls passed `noopener`, so every
   opened page received a live `window.opener` handle able to navigate this tab.
3. **Two copies of the same seven-case switch** built the same seven share URLs
   (audit H-6): two places to get encoding wrong, two to add a platform, two for
   a fix to land in.

## 2. Architecture

```
feature ──▶ requestEgress({ class, … })
                 │
                 ├─ capability  (EGRESS_CAPABILITY)      denied ──▶ false
                 ├─ URL         (classifyDestination)    invalid ─▶ false
                 ├─ confirm?    (EGRESS_REQUIRES_…)      cancel ──▶ false
                 └─ performEgress ──▶ window.open / navigator.share
```

A feature names its **intent** and awaits an answer. It does not build a URL,
read a capability, know a dialog exists, or call a browser API.

| File | Role |
|---|---|
| `src/external-egress/classes.ts` | the five classes and the one capability table |
| `src/external-egress/url.ts` | `classifyDestination`: scheme, host, internal-vs-external |
| `src/external-egress/social.ts` | the trusted platform catalog; the only place a share URL is built |
| `src/external-egress/egress.ts` | `decideEgress` (pure) and `performEgress` (**the only browser call**) |
| `src/external-egress/ExternalEgressProvider.tsx` | mounts the decision, the confirmation, the pending promise |
| `src/external-egress/EgressRouteGuard.tsx` | a route that only exists when the capability does |

`decideEgress` is pure: policy and request in, decision out, which is what
lets every rule be tested without a window and stops the decision drifting into
the component that renders the dialog.

## 3. Egress classes and capability mapping

| Class | Capability | Confirms? | What it is |
|---|---|---|---|
| `external-link` | `externalLinks` | ✅ | a named destination in a new tab |
| `social-share` | `socialPlatformSharing` | ✅ | a share intent handed to a named platform |
| `native-share` | `nativeShareSheet` | ❌ | the OS share sheet |
| `relay-management` | `relaySelection` | ❌ | pointing the client at a different relay |
| `authoring-tool` | `authoringTools` | ❌ | reaching the internal authoring tools |

One table, in `classes.ts`. A feature asks for a **class**; it never names a
capability and never names a profile.

The last two are surfaces rather than destinations; nothing opens, the player
stays where they are. They share the table because they are the same kind of
decision ("may this experience reach outside its own boundaries"), and only the
first three ever reach `performEgress`.

**Theater and YouTube are deliberately absent.** A media embed has its own
concerns: an open catalog, host-controlled media replacement after a guest has
joined, embed privacy, fullscreen, session consent, and calling it an
`external-link` to make this phase look complete would bury all of them under a
confirmation dialog that addresses none of them. Its own phase.

### Confirmation rules, and why they are not universal

A dialog in front of every action is a dialog nobody reads.

- **`external-link` and `social-share` confirm.** Both hand the player somewhere
  that is not Blobbi Island, and the audit's finding was precisely that they did
  so with no warning at all.
- **`native-share` does not.** The OS share sheet *is* a confirmation. A dialog
  in front of a dialog teaches players to dismiss both.
- **`relay-management` and `authoring-tool` do not.** Nothing opens. They are
  gated, not announced.

## 4. URL validation

**`https:` and nothing else.** Every destination the product actually has is
HTTPS, so a wider allow-list would be flexibility nobody asked for:

| Scheme | Why refused |
|---|---|
| `javascript:` | executes in this origin, script injection with extra steps |
| `data:`, `blob:` | render attacker-controlled content the address bar presents as a page |
| `http:` | a downgrade; nothing needs it |
| `file:`, `about:`, … | browser-internal |
| `wss:`, `ws:` | **a relay address, not a place to navigate**: refused with its own reason, because relay URLs are the one non-HTTP string the app routinely handles and confusing the two is the mistake this module exists to prevent |

Also refused: empty input, unparseable input, and a URL with no host. The
classifier never throws: a malformed URL is ordinary input here.

**Same-origin is not egress.** `/settings` and
`https://island.example/anything` classify as `internal` and are *refused* by
`decideEgress` rather than performed: a caller reaching for the external API to
move around inside the island has made a mistake worth surfacing.

**The host is the truth.** The confirmation shows the hostname parsed from the
URL about to be opened, lowercased, `www.` stripped, never a label the caller
passed in. A label is presentation; a wrong one can mislabel a button and must
never be able to mis-state a destination.

## 5. Standard behaviour

Everything that worked still works, with two deliberate improvements the audit
asked for:

- **A confirmation before leaving.** Previously there was none at all. It names
  the host, not the 300-character share URL, showing the query string would be
  noise nobody reads.
- **Opener isolation everywhere** (§8).

Social sharing, the native share sheet, relay selection and the authoring tools
are all still available.

Two share-panel actions are **not** egress and deliberately stay outside the
boundary: *Instagram* saves a file to this device, and *Copy Link* writes to the
clipboard. Neither leaves the island.

## 6. Family behaviour

Family is still not user-selectable; tests inject `FAMILY_POLICY`.

| Class | Family |
|---|---|
| `external-link` | denied |
| `social-share` | denied |
| `native-share` | denied |
| `relay-management` | denied |
| `authoring-tool` | denied |

**Denied below the UI, not by hiding it.** The capability is checked *before*
the URL is parsed and long before a browser API is reached, so a component that
still holds the callback, or a modified build that calls it directly, gets
nothing. Tests assert `window.open` and `navigator.share` were never called,
rather than that a button was missing.

Surfaces are also hidden where appropriate (the relay picker returns `null`, the
tools route does not mount), but that is presentation layered on top of
enforcement, never instead of it.

**Denied copy says nothing about age.** A profile is an experience
configuration, not an age assertion, so the route guard says *"The Game Item
tools aren't part of this experience."*, and nothing about capabilities,
policies or profiles, because a denied view is not a debugging surface.

One subtlety worth stating: when the share sheet is unavailable, `ShareModal`
falls back to the social panel. That is safe because the panel is gated by its
**own** capability: an experience that refuses the sheet does not get social
platforms through the back door, it gets a panel whose buttons are equally
refused.

## 7. Confirmation UX

```
  Leaving Blobbi Island
  This will open soapbox.pub outside Blobbi Island.
  [ Cancel ]  [ Continue ]
```

For a social share the title names the platform from the trusted local catalog:
*"Share with Telegram?"*.

Built on `BlobbiModal`, so focus management, Escape, mobile presentation and
portal behaviour come from the shared primitive. Cancel and Continue are
distinguished by their **labels**, not by colour alone. Dismissing by any route,
Cancel, Escape, the backdrop, resolves the caller's promise as "did not
happen", so an awaiting feature never hangs and never acts as though it did.

## 8. Opener isolation

Every window opens `noopener,noreferrer`. Without `noopener` the opened page
gets a live `window.opener` handle to this tab and can navigate it, the
`target="_blank"` tabnabbing that all six previous call sites were exposed to.
Centralising means it is now true by construction rather than in the places
somebody remembered.

The compact popup geometry for a social share is preserved, so a share window
still opens as a popup rather than a full tab.

## 9. Chokepoints

**`window.open` and `navigator.share` appear nowhere in `src/` except
`src/external-egress/egress.ts`.** Enforced twice:

- **ESLint**: `no-restricted-properties` for both, plus `no-restricted-syntax`
  banning `target="_blank"` in JSX, scoped to `src/**` and exempting the egress
  module and tests. No custom plugin.
- **`src/external-egress/boundaries.test.ts`**: scans the real source with
  comments stripped, so prose discussing `window.open` does not trip it and a
  call the ESLint selector does not model still fails.

## 10. Migrations

| Surface | Before | After |
|---|---|---|
| `SocialShareModal` | 7-case switch + `window.open` | `requestEgress({ class: 'social-share', platform, payload })` |
| `ShareModal` (social) | the same switch again | same call; the URL catalog is shared |
| `ShareModal` (native) | `navigator.share` + hand-rolled feature detection | `requestEgress({ class: 'native-share', data })`; the button label now reflects what pressing it will actually do |
| `GameItemTools` | `<a target="_blank">` to soapbox.pub | button → `external-link` |
| `ImageManager` | `<a target="_blank">` to an **author-typed URL** | button → `external-link`, so the URL is parsed and refused unless `https:` |
| `RelaySelector` | wrote the relay directly | hidden when disallowed; the write is gated in `AppProvider` |
| `/tools/game-items` | unlinked but reachable by typing the path | `EgressRouteGuard` |
| `NoteContent.tsx` | dead code that linkified arbitrary URLs | **deleted** |

### The relay gate is on the writer

`RelaySelector` is mounted **three** times, the account menu, the account
switcher, the theme browser's empty state, and all three write through
`AppProvider.updateConfig`. Gating the component would have left three working
callbacks and a fourth mount away from being wrong, so the gate is on the
writer: a refused relay change is dropped while the rest of the update still
applies, so a caller changing the theme and the relay together keeps the theme.

### NoteContent was deleted

It linkified arbitrary URLs with `target="_blank"` and rendered stranger `kind:0`
metadata, and had no production importer, a dormant unsafe helper one careless
import away from putting a stranger-controlled exit inside a chat bubble (audit
M-3). A boundary test asserts it stays gone.

### Untrusted URLs

The one user-controlled URL that still reaches a navigation is the image URL
typed into the authoring tool. As an anchor it would happily navigate to
`javascript:` or `data:`; through the boundary it is parsed, refused unless
`https:`, and the confirmation names the host it actually resolves to rather
than whatever was typed.

## 11. Capabilities that now have real enforcement

| Capability | Before | Now |
|---|---|---|
| `externalLinks` | declarative | enforced at `decideEgress` |
| `socialPlatformSharing` | declarative | enforced at `decideEgress` |
| `nativeShareSheet` | declarative | enforced at `decideEgress` |
| `relaySelection` | declarative | enforced in `AppProvider.updateConfig` |
| `authoringTools` | declarative | enforced at the route |

## 12. Deferred and remaining

- **Theater / YouTube**: the whole media-embed problem, untouched and next.
- **`publicNotePublishing` and `mediaUploads`** still declarative. The
  PhotoBooth's Nostr publish and Blossom upload are *publishing*, not egress, so
  they were out of this phase's scope.
- **Blossom and asset hosts** are subresource fetches (`<img src>`), not
  navigations. They leak the player's IP to the asset host, which is a
  content-pipeline concern rather than an egress one.
- **`window.location.reload()`** in the error boundaries is not egress; it
  reloads this origin.
- The nsec download and the polaroid download create local files and do not
  leave the origin.
