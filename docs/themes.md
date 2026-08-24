# Blobbi Island — themes

How the island changes its clothes without changing its components.

See [`design-system.md`](./design-system.md) for the token layers this sits on.

---

## 1. What a theme is

A **palette**. Sixteen HSL channel triplets, and nothing else.

Everything downstream is derived from them by reference — the shadcn semantic
tokens, every shadow, and all ~650 `text-island-ink` / `bg-island-cream` /
`border-island-wood/30` utilities across the game. So a theme is data, and
adding one is an entry in `src/lib/island-themes.ts`.

If a theme ever requires a component to change, that component is hardcoding a
colour it should be reading from a token. Fix the component, not the theme.

## 2. What a theme is deliberately *not*

**Not light/dark mode.** Blobbi Island has no generic dark mode. What a browser
calls dark mode would flip the cozy daytime world into a grey social app, which
is the one outcome this system exists to prevent. An evening island is a
*theme*, authored with the game's own colours. The `.dark` selector in
`index.css` is kept but **empty of colour**, so a stray `dark:` utility or a
`system` preference reaching `<html>` resolves to the active theme instead of a
stale palette. Themes do not respond to `prefers-color-scheme`.

**Not derived from three core colours — when it is authored here.** Ditto
derives its nineteen tokens from `{background, text, primary}`, which is right
for a social client where any user-picked colour must still produce a usable UI.
The island's BUILT-IN palettes are art direction — sand is not a computed tint of
cream, it is a specific warm sand — so every colour is authored. A built-in theme
costs sixteen values instead of three, and buys the ability to be *designed*.

An **external** theme gets no such luxury and does not need one: it arrives with
three colours and is expanded by `island-theme-adapter.ts`. See §5b.

**Not a UI theme and a Blobbi stage background at the same time.** They are
different customization domains and they live apart: a theme is
Account → Appearance → Themes, and the scene behind your Blobbi is My Blobbi →
the stage's own control (`src/lib/blobbi-stage-backgrounds.ts`). Nothing about
one touches the other.

## 3. The themes

| id | name | |
| --- | --- | --- |
| `cozy-day` | Cozy Day | the default: warm sand, painted wood, bright afternoon sky |
| `lantern-night` | Lantern Night | the island after dusk, lantern-lit |

Lantern Night exists to prove the architecture, and was chosen to be the hardest
case: it **inverts the lightness relationship the whole app was built on**.
Panels become darker than the page is in Cozy Day, and text becomes light on
dark. If a surface is hardcoding a colour, this is the theme that exposes it —
so check any new surface under it before shipping.

## 4. Adding a theme

1. Add an `IslandTheme` to `islandThemes` in `src/lib/island-themes.ts`.
2. Copy the same palette into `THEMES` in `public/island-theme.js`. This
   duplication is required — that script must run before the module graph loads
   — and `island-themes.test.ts` asserts the two match value for value, so
   forgetting fails a test rather than causing a silent flash.
3. Nothing else. No component, no Tailwind class, no CSS.

Then check it. `src/lib/island-theme-contrast.test.ts` runs against every theme
in the registry automatically, so `npm test` will tell you if any real pairing
falls below WCAG AA before you ever open the app. After that, open the picker
(account menu → Appearance → Theme) and walk the manual matrix in §7.

### Authoring guidance

Think in the **roles**, not the hues. `cream` means "the panel", `ink` means
"text", `wood` means "the frame". A theme where `cream` is a dark violet is
perfectly valid; a theme where `cream` and `ink` have similar lightness is not.

- Keep `ink` vs `cream` at a comfortable contrast — body text sits on `cream`,
  and `ink-soft` sits on it too, so check the *muted* pairing, not just the
  strong one.
- `wood-dark` is used as label text on `sand` as well as an edge. In a dark
  theme it usually needs to become *lighter* than `wood`, not darker. Lantern
  Night does exactly this.
- `focus` is the focus ring, and is a separate token from `ocean` for a reason:
  a ring must clear 3:1 against `cream`, `cream-2` **and** `page`, and a pretty
  sea usually cannot. In a dark theme the same colour often serves both.
- `grass` is a fill (the online dot, a tint); `grass-dark` is the green used as
  *text* on `cream`, so it must clear 4.5:1 there. In a dark theme `grass-dark`
  is the *lighter* of the two — the name means "the readable one", not "the
  darker one". `wood-dark` works the same way.
- `purple`, `grass`, `danger` and `warn` carry `cream` as their foreground via
  the `-foreground` semantic tokens, so they must contrast with `cream` in *this*
  theme, not with white.

## 5. What was taken from Ditto, and what was not

Reference: `/Users/filemon/Developer/ditto`, `src/themes.ts`,
`src/hooks/useTheme.ts`, `src/components/ScopedTheme.tsx`, `public/theme.js`.

**Adopted:**

- **CSS custom properties as the only theming mechanism**, with Tailwind reading
  them. Components never branch on the theme.
- **A pre-paint blocking boot script** that reads localStorage and applies the
  palette before first paint, so there is no flash — including onto the
  pre-React loading screen.
- **Scoped palettes for previews.** Ditto's `ScopedTheme` applies a palette to a
  container; the island's theme cards apply one to a card, so a preview is built
  from the same tokens as the real thing and cannot drift from it.
- **A theme registry with picker metadata** — id, label, emoji, description.
- **Storing theme in the app-config blob** rather than inventing a store.

**Deliberately not adopted:**

- **Deriving tokens from three core colours** (`deriveTokensFromCore`). Right
  for arbitrary user colours; wrong for authored art direction. See §2.
- **`light` / `dark` / `system` / `custom` as theme identities.** The island has
  named themes, full stop.
- **`autoShareTheme` as a user-facing toggle.** Island publishes its selection
  unconditionally when signed in, because there is no second theme to keep
  separate here — Ditto's toggle exists so a user can show one theme on their
  profile and use another in the app. Island's selection *is* both.
- **`titleFont` rendering.** Read, cached and republished; not applied. See the
  scope table in §5b.
- **`blurhash` / `dimensions` / `mimeType`.** Read and republished; not used.
  Island has no progressive-load placeholder to spend them on.
- **Ditto's own palettes.** Borrowing its violet-on-near-black for a BUILT-IN
  would make the island look like a Ditto skin. What was borrowed is the
  discipline — and, now, the protocol.

## 5b. Themes on Nostr

Island reads and writes **Ditto's theme protocol**, unchanged. The full event
schema, the tag vocabulary and the compatibility boundary are in
[`NIP.md`](../NIP.md#kinds-36767--16767--themes-dittos-protocol-reused); this is
the short version.

| Kind | Class | Question |
| --- | --- | --- |
| `36767` | Addressable | "Here is a theme." `36767:<pubkey>:<d>` |
| `16767` | Replaceable | "Here is the palette I show publicly." |
| `30078` | Addressable | "Here is the theme I am **using**." NIP-78, encrypted |

> **Correction.** An earlier version of this document, and Island's first
> implementation, treated kind 16767 as "the theme this user has selected". It is
> not. In Ditto, 16767 is read by `ProfilePage` and `FollowPage` to decorate a
> profile; the theme Ditto *renders* is `theme` + `customTheme` inside the
> NIP-78 blob at `d = "ditto/metadata"`. Publishing only a 16767 leaves a Ditto
> account looking exactly as it did — which is precisely what happened. Island
> now writes both, and reads the blob first.

A theme is three colours — `background`, `text`, `primary`, hex-encoded in `c`
tags with a role marker — plus an optional **font** (`f`) and **background
image** (`bg`). Island reads and republishes all of them. `island-theme-adapter.ts` expands them into the island's
sixteen, **solving** every role that carries text against the surfaces it sits on
until it clears its WCAG threshold — so a community theme is held to the same
contrast contract as a built-in one (`island-theme-adapter.test.ts` runs it
against deliberately hostile palettes). Scenery blends the island's own hues a
third of the way toward the theme's background rather than deriving from its
primary, because a purple ocean is not a theme.

Going the other way, a built-in publishes as `page → background`,
`ink → text`, `purple → primary`. Lossy by construction; those are the three
roles that mean the same thing in both models.

**Identity.** Built-ins keep bare slugs (`cozy-day`); Nostr themes are
`nostr:36767:<pubkey>:<d>`. A bare slug has no colon, so one `AppConfig.theme`
field holds both without ambiguity — and built-ins were deliberately NOT renamed
to `builtin:*`, because every stored preference in the wild is a bare slug and a
rename would have reset every player on a non-default theme.

**Trust.** A theme is a stranger's data colouring the whole UI. A colour must
match `#rgb`/`#rrggbb` and is then parsed into numbers and re-emitted from those
numbers, so it cannot carry a payload. The two fields that *are* strings reaching
a stylesheet — a font family and a media URL — get their own module
(`island-theme-media.ts`): https-only URLs re-serialised by the URL parser, and
families through a Unicode allowlist. Free text is stripped of control characters
and capped. No arbitrary CSS from an event ever enters a `<style>` element.

Contrast is *reported*, never enforced — the picker and the create form both say
which pairing is short — because blocking would mean refusing themes Ditto
happily renders.

### Font and background scope

| Field | Island behaviour |
| --- | --- |
| `colors` | Expanded into the sixteen-colour palette by the adapter. |
| `font` (body) | **Applied**, via `--island-font-body` on `<html>`, with the island's own Comfortaa stack as the fallback and `font-display: swap` — a dead font host leaves the game readable. |
| `titleFont` | **Applied**, via `--island-font-display`, to game-window titles and settings section headings only. |
| `background` | **Applied to the page around the game window only.** Ditto puts it on `body`, which suits a feed scrolling over it. Town, Beach, Mine and the Arcade are drawn art — a theme may dress the room the game sits in, never the game. Both of Ditto's modes (`cover`, `tile`) are honoured. |
| `dimensions`, `mimeType`, `blurhash` | Read and republished; not used for rendering. Island has no progressive-load placeholder to spend a blurhash on. |

#### Fonts: the URL Ditto does not send

Ditto **bundles** twenty-five curated families and loads them with a dynamic
`import()`. Its `FontPicker` therefore stores the family ALONE:

```ts
applyFont({ family });   // ditto/src/components/FontPicker.tsx — handleSelect
```

A URL appears only when a theme is *published*, where `resolveFontUrl`
substitutes the fontsource CDN link. But Island prefers kind:30078 — the channel
Ditto renders from — and that holds the unpublished value. So Island received
`{ family: 'Playfair Display' }`, correctly declined to invent a URL, and the
browser fell straight through to Comfortaa because Playfair Display is not
installed on a normal machine. **Indistinguishable from no font at all**, which
is exactly what manual testing found.

`src/lib/theme-fonts.ts` mirrors Ditto's registry and supplies the same file
Ditto would have published. Precedence: the theme's own URL, then the registry —
and an explicit URL that fails validation falls back to the registry rather than
costing the theme its font.

Variable faces are declared `font-weight: 100 900`. Without it a variable
`.woff2` matches 400 only, and the island's hundreds of `font-bold` labels get a
synthetic smear instead of the file's real bold axis.

#### The font cascade

One declaration site, one inherited variable:

```
  html { font-family: var(--island-font-body) }      ← the ONLY family rule
     ↓ inherited by body, #root, every component
  .island-display { font-family: var(--island-font-display) }   ← opt-in
```

A component that sets its own `font-family` becomes a hole a theme cannot reach,
and nothing looks wrong until a themed player opens it. `theme-fonts.test.ts`
fails the build on a new one. The deliberate exceptions:

| Exception | Why |
| --- | --- |
| `.font-mono` on hex addresses, event ids, filenames | A proportional face makes those genuinely harder to read. No theme should change them. |
| `NostrHubModal` title | A glowing monospace terminal treatment — art direction, the same category as an arcade cabinet's display. |
| Theme preview cards and the create-theme preview | Scoped previews, which is the point of them. |

`font-bold` / `font-semibold` / `font-medium` are **weight**, not family, and are
untouched.

## 6. Implementation

| Concern | Where |
| --- | --- |
| Registry, resolution, application | `src/lib/island-themes.ts` |
| Default palette, in CSS, for a no-JS render | `:root` in `src/index.css` |
| Pre-paint application | `public/island-theme.js`, blocking in `index.html` |
| Persistence + runtime application | `src/components/AppProvider.tsx` |
| Ditto's encrypted settings (kind 30078) | `src/lib/ditto-settings.ts` |
| Reading those settings | `src/hooks/useDittoThemeSettings.ts` |
| Font + background application | `src/lib/island-theme-media.ts` |
| Read/set hook (relay-free) | `src/hooks/useTheme.ts` |
| Read/set + discovery + publish | `src/hooks/useThemeSelection.ts` |
| Ditto protocol (parse/build/validate) | `src/lib/nostr-theme.ts` |
| Three colours → sixteen | `src/lib/island-theme-adapter.ts` |
| Last-known palette, for boot | `src/lib/island-theme-cache.ts` |
| Discovery reads | `src/hooks/useNostrThemes.ts` |
| Publishing | `src/hooks/useThemePublish.ts` |
| Cross-device reconciliation | `src/components/IslandThemeSync.tsx` |
| Picker UI | `src/components/shell/ThemePicker.tsx` |
| Create flow | `src/components/shell/ThemeCreateDialog.tsx` |
| Entry point | Account menu → Appearance → Theme |

`useTheme` is deliberately relay-free — the account menu row that shows the
current theme's name must not drag a signer, a mutation and a subscription into
its dependency graph. Everything that needs a relay is in `useThemeSelection`,
which only the picker uses.

### Persistence and fallback

**Authority order.** A relay outage is never a theme change:

```
  pre-paint boot script   config id → built-in table → palette cache
       ↓
  AppProvider             the same offline resolution, authoritatively;
                          also applies the theme's font and background
       ↓
  IslandThemeSync         refreshes the cache from the live kind:36767, and
                          adopts the ACCOUNT's selection — once per session,
                          never on an unusable read
```

Within that last step, the account is asked in this order:

```
  kind:30078  theme === 'custom' ? customTheme : (a built-in mode — nothing to adopt)
       ↓  unreadable (no NIP-44 signer, or a relay carrying only public events)
  kind:16767  the self-contained config it carries
```

A NAMED theme — one the event points at with an `a` tag, or one Island tagged
itself — is adopted by name, so the island follows the author's later edits. A
name this build cannot resolve falls through to the colours rather than
abandoning the event: an active-theme event is self-contained, and refusing to
use it was the Ditto → Island bug.

**Same-second selections.** Both writes use `nextReplaceableCreatedAt`, so a
revision is always strictly newer than the one it replaces. Without it, NIP-01
breaks a tie between two replaceable events on the lower event id — which has
nothing to do with which one the player chose.

The stored id is never overwritten by a failed read. A community theme survives
an offline boot from its cached palette; only a selection that is BOTH unreadable
and uncached shows a notice, and even then the choice is remembered.

The cache lives under its own key (`nostr:island-theme-cache`), not in the config
blob: it is a disposable derivative, and a corrupt entry there must not cost the
player their relay. Every value is re-validated as a plain HSL triplet before it
is applied, in both the module and the boot script.

Stored as `theme` in `nostr:app-config`. `AppConfig.theme` is typed `string`,
not a union of the current ids, because **a stored preference outlives the build
that wrote it**: a removed seasonal theme, or a player on a cached bundle.
`resolveIslandTheme` maps any unknown id to the default at the point of use,
which is the only error handling theme ids get and the only place the question
is asked.

The id is stored **unchanged**, never overwritten with the fallback, so a theme
that returns in a later build is re-selected rather than silently lost.

The zod schema `.catch()`es per field. `useLocalStorage` discards the whole blob
when its deserializer throws, so without that a bad theme id would also cost the
player their relay.

The legacy `"light"` / `"dark"` / `"system"` values are **not migrated** — they
take the same unknown-id path to the default.

### Application

`applyIslandTheme` writes the palette as inline custom properties on
`<html>` and sets `data-island-theme`. Inline properties outrank the `:root`
defaults without `!important`, there is exactly one place the active palette
lives, and it is trivially inspectable and assertable.

Switching a theme is **only** that write. No component unmounts, no provider
changes identity, no query is invalidated — so a player can change theme in the
middle of a mining session or a rhythm track without disturbing it.
`island-theme.test.tsx` holds that line.

## 7. Manual validation matrix

Automated tests cover the registry, resolution, persistence, fallback,
no-remount, and the picker's behaviour. What still needs eyes:

For **each theme** (`cozy-day`, `lantern-night`):

| Surface | Check |
| --- | --- |
| Boot | no flash of the other palette; the loading spinner is themed |
| World / HUD / dock | frame, chips, action dock legible over the world |
| Account menu (desktop dropdown) | rows, dividers, the Appearance row |
| Account menu (landscape modal) | compact layout, scrolling |
| Theme browser | built-in cards readable; check mark; focus ring visible |
| A dialog (Elevator, Arcade Pass, No Pass) | panel, plaque, buttons, close |
| A bottom sheet (any modal at < 768px) | safe area, drag handle, close |
| Shop / economy | prices, coin balance, the accent purchase button |
| My Blobbi → Wardrobe | clothing + effects, Blobbi visible beside them |
| My Blobbi → Items | chips + grid + pager; a consumable click opens Use item directly |
| My Blobbi stage | backdrop fills the box with no crop; the Blobbi stands on the floor |
| Mine, Arcade, Beach | overlays over their own art |
| Loading / empty / error | `StateCard`, `PageLoading` |
| Focus | Tab through a dialog — the ring must be visible on every stop |
| Reduced motion | OS setting on: no spinner spin, no card lift, states still change |

Viewports: desktop, mobile portrait, mobile landscape.

### Cross-app, same Nostr account

The one thing automated tests cannot prove. `cross-app-theme.test.ts` pins the
resolution on both sides, but only two real apps against a real relay show
whether it works.

**Ditto → Island**

| Step | Expected |
| --- | --- |
| Select a built-in Ditto theme (light/dark), reload Island | Island adopts it as `ditto:active` |
| Select a Ditto preset / edited palette, reload Island | same — this is the self-contained case |
| Select a community 36767 in Ditto, reload Island | Island shows that named theme, checked in the picker |
| Select a theme with a custom font | Island's body type changes |
| Select a theme with a background image | image dresses the page around the frame, world art intact |

**Island → Ditto**

| Step | Expected |
| --- | --- |
| Select a community theme in Island, reload Ditto | Ditto renders it (mode flips to `custom`) |
| Select an Island built-in, reload Ditto | Ditto renders its three colours under its name |
| Create + publish a theme in Island, reload Ditto | colours, font and background all present |
| Check Ditto's other settings afterwards | feed settings, filters, relays unchanged |

### Diagnosing a font that does not change

Fonts are the one theme field that can fail *outside* the app — a host that
refuses cross-origin requests is not something Island can fix. This sequence
separates "Island did not apply it" from "the host would not serve it".

With DevTools open on a theme that has a custom body font:

| # | Where | Expect |
| --- | --- | --- |
| 1 | Elements → `<html>` → Computed → `font-family` | the theme's family FIRST, then `Comfortaa, system-ui, sans-serif` |
| 2 | Elements → `<head>` → `<style id="island-theme-font">` | `--island-font-body: "<Family>", Comfortaa, …` |
| 3 | `<style id="island-theme-font-faces">` | one `@font-face` with an `https://` `src` and `font-display: swap` |
| 4 | A modal title (`.island-display`) | the TITLE font when the theme sets one, else the body font |
| 5 | Ordinary paragraph text, an Account-menu row, a button label | all the body font — a button showing Comfortaa while `<html>` shows the theme font means something re-declared the family |
| 6 | Network → filter `Font` | one request for the `@font-face` URL |
| 7 | That request's **Status** | `200`. A `404` means the URL is wrong |
| 8 | That request's response headers | `access-control-allow-origin`. Missing ⇒ the host refuses cross-origin use |
| 9 | Console | a CORS or `downloadable font` error names the failing host |

Reading the result:

- **1–3 correct, 6 shows no request** → the family resolved to no URL. It is not
  one of Ditto's curated families and the theme did not carry a link.
- **1–3 correct, 7 is 200, but text is unchanged** → the file downloaded and the
  browser rejected it (wrong format, corrupt). Console step 9 says so.
- **1–3 correct, 8 missing** → the host's CORS policy. Not an Island bug; the
  fallback is working as intended.
- **1 shows only `Comfortaa`** → Island did not apply it. That is a bug here.
- **1 correct but 5 shows Comfortaa on some element** → that component
  re-declares `font-family`. `theme-fonts.test.ts` should have caught it.

**Resilience**

| Condition | Expected |
| --- | --- |
| Font host down / CORS refused | UI stays in Comfortaa and remains readable; no retry storm, no user-facing error |
| Relay offline at boot | last theme still painted, selection remembered |
| Corrupt palette cache | default palette, selection remembered |
| Selected definition deleted | cached palette retained, notice only if never cached |
| Signer without NIP-44 | 16767 still written; settings channel skipped silently |

### Nostr themes and stage backgrounds

Automated tests cover the protocol both directions, discovery (replacement,
malformed, empty, offline), selection, publication, the palette cache, and the
adapter's contrast contract. What still needs eyes:

| Flow | Check |
| --- | --- |
| Themes → From the community | discovered cards render; a "Low contrast" badge where earned |
| Apply a community theme | the whole island repaints; nothing in progress is disturbed |
| Reload after applying one | painted from cache with no flash of Cozy Day |
| Relay off, then reload | still the chosen theme; the notice only if never cached |
| Create a theme | preview tracks the colour pickers; app behind it does NOT change |
| Publish | appears under "Yours" and applies; republishing the same name replaces |
| A theme published from Ditto | appears in the community list and renders |
| A theme with a font | body type changes; a dead font URL leaves Comfortaa |
| A theme with a title font | window titles + settings headings change; body copy does not |
| A theme with a background image | dresses the page around the frame; the world art is untouched |
| Stage background | picker lists both; switching does not remount the world |
| Bag shortcut (🎒) | GONE — My Blobbi → Items is the only inventory |

## 7b. Manual validation — the visible-redesign pass

Automated tests cover the token contract, contrast in both themes, the window
primitive's presentations, the row and tile semantics, and every migrated
surface's behaviour. What they cannot cover is whether it LOOKS like one
product. Nothing below was verified visually in the session that wrote it — no
browser was available — so it is a checklist, not a report.

Walk it in **both themes** × **desktop / mobile portrait / mobile landscape**.

### The window frame — check once, then spot-check

Open any migrated surface and confirm the shared frame reads correctly:
header band separated by a hairline, icon chip, title, muted subtitle, one
close button, body scrolling under a fixed header, footer band with the
primary action on the right (desktop) or on top (mobile).

### Surfaces

| Open | Expect |
| --- | --- |
| Account menu (desktop) | dropdown; four labelled sections; rows press and show a focus ring |
| Account menu (landscape) | centred modal; sections in **two columns**; scrolls |
| Appearance → Theme | both cards; the miniature island matches the theme it names; check mark on the active one |
| Blobbi care sheet | in-frame; named after the Blobbi; segmented tabs; stat panels; stage art not clipped |
| → Inventory tab | equipment grid; placement overlay still aligns to the Blobbi |
| → Effects tab | preview applies to the stage and reverts on leaving the tab |
| Island map | fills the game window; markers aligned; hover label readable; description names your location |
| Shop | tiles in a grid; stepper 36px; **basket stays visible while scrolling**; total turns danger when unaffordable |
| Item bag | tiles; count badge one colour; currency section not clickable |
| Use item | stepper 44px; totals lead; "Per item" folds open |
| Arcade Pass / No Pass / Elevator | in-frame cards with a rim of game visible around them |
| Mine → instructions / results / low energy | in-frame; results show swings, finds with prices, settlement block |
| Mine → in cave | status panel is a HUD card, readable over the cave art |
| Beach → treasure hunt | HUD chips, tool docks, pause overlay; exit confirmation matches the window surface |
| Arcade → after a game | reward chip colour matches its state; prize cards |

### Cross-cutting

- **Loading / empty / error / pending** — open the bag with a slow relay, and
  with nothing in it.
- **Focus** — Tab through one window end to end. The ring must be visible on
  every stop, including on the cream header band and on the sand plaque.
- **Reduced motion** — turn the OS setting on. No spinner spin, no card lift,
  no tile hop; every state still *changes*, just without the tween.
- **Mobile portrait** — every migrated window is a bottom sheet. Check the
  footer clears the home indicator and nothing scrolls sideways.
- **Long labels** — a long Blobbi name must truncate, not wrap the header.

### Known to look unmigrated

Chest, refrigerator, photo booth, share, Nostr hub, theater, and the arcade
minigame playfields. See the table below.

## 8. Migration status

Every surface a player meets on the common journey, and where it stands.

| Surface | Presentation | Status |
| --- | --- | --- |
| Account menu | dropdown / modal | **migrated** — SettingsRow + SettingsSection |
| Theme picker | dialog | **migrated** |
| Blobbi care sheet (`BlobbiInfoModal`) | in-frame `full` | **migrated** |
| Island map | in-frame `full` | **migrated** |
| Shop (`FoodShopModal`) | in-frame `lg` | **migrated** — ItemTile, sticky basket |
| Item bag | in-frame `md` | **migrated** — ItemTile |
| Use item (`ConsumeItemModal`) | in-frame `sm` | **migrated** |
| Arcade Pass | in-frame `sm` | **migrated** |
| Elevator | in-frame `sm` | **migrated** — SettingsRow floors |
| No Pass | in-frame `sm` | **migrated** |
| Social share | in-frame `lg` | **migrated** |
| Mine instructions / results / low energy | in-frame `sm` | **migrated** |
| Mine in-cave status | HUD panel | **migrated** |
| Beach treasure hunt HUD, docks, pause | in-place | **tokens only** — surface is correct, mechanism deliberately local |
| Beach exit confirmation | in-place `alertdialog` | **tokens only** — see below |
| Arcade reward panel, prize counter, prize cards | in-place | **tokens only** |
| Equipment / Effects panels | inside the care sheet | **partial** — inherit the frame, own chrome still stock |
| Chest | hand-rolled overlay | **deferred** |
| Refrigerator | hand-rolled overlay | **deferred** |
| Photo booth | hand-rolled overlay | **deferred** |
| Share (photo) | hand-rolled overlay | **deferred** |
| Nostr hub | dialog | **deferred** |
| Theater controls / session / stage | in-place | **deferred** |
| Hatching ceremony | full-bleed cinematic | **intentionally excluded** |
| Game item tools, `/dev/*` harnesses | various | **last** — internal surfaces |

### Why the deferrals are deferrals and not laziness

- **Refrigerator** measures its own container and positions food on shelf
  coordinates derived from that measurement. Changing its container changes
  where the food sits.
- **Chest** and **Photo booth** are the same shape of problem: draggable items
  and a capture stage positioned against a measured box.
- **Beach exit confirmation** layers over a *paused* minigame inside the
  treasure field's own stacking context. Portalling it out would put it behind
  the field. It wears the shared surface language without the shared mechanism,
  which is the right trade.
- **Hatching ceremony** is a deliberate full-bleed cinematic — a dark space with
  its own light. It is art direction, not an unmigrated panel.
- **Theater** is a coherent feature area of its own and deserves one batch, not
  a partial pass.

A `dark:` variant anywhere in the codebase is dead: `.dark` carries no colour.
They are harmless and are being removed as each surface is migrated rather than
in a sweep of their own.

### Colours that are legitimately not tokens

Three, and only three:

1. **Artwork** — sprite palettes, effect gradients, canvas draw calls. Pictures
   of things in the world, not UI surfaces.
2. **Brand marks** — Facebook blue, Reddit orange in the share sheet. Facts
   about other companies, not decisions this system gets to make.
3. **Dev-harness overlays** — the treasure hunt's black-and-white diagnostic
   markers. Deliberately harsh, never shown to a player.

Everything else that still holds a stock Tailwind colour is a migration
backlog item, not an exception.
