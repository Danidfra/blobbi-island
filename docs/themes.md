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

**Not derived from three core colours.** Ditto derives its nineteen tokens from
`{background, text, primary}`, which is right for a social client where any
user-picked colour must still produce a usable UI. The island's palette is art
direction — sand is not a computed tint of cream, it is a specific warm sand —
so every colour is authored. A theme costs sixteen values instead of three, and
buys the ability to be *designed*.

**Not a Nostr event.** Theme choice is a local display preference. It publishes
nothing, and there is no theme kind. It rides in the existing
`nostr:app-config` localStorage blob beside the relay URL.

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
- **Publishing themes to Nostr** (Ditto's kind 16767), the encrypted-settings
  sync, and `autoShareTheme`. Theme is a local display preference here.
- **User-authored themes, font pickers and background images.** Ditto's themes
  can carry a font and a background photo, which suits a social feed. The island
  is a drawn world; a photographic background behind the wood frame would fight
  the art. Left out until there is a reason.
- **Ditto's own palettes.** Borrowing its violet-on-near-black would make the
  island look like a Ditto skin. What was borrowed is the discipline.

## 6. Implementation

| Concern | Where |
| --- | --- |
| Registry, resolution, application | `src/lib/island-themes.ts` |
| Default palette, in CSS, for a no-JS render | `:root` in `src/index.css` |
| Pre-paint application | `public/island-theme.js`, blocking in `index.html` |
| Persistence + runtime application | `src/components/AppProvider.tsx` |
| Read/set hook | `src/hooks/useTheme.ts` |
| Picker UI | `src/components/shell/ThemePicker.tsx` |
| Entry point | Account menu → Appearance → Theme |

### Persistence and fallback

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
| Theme picker | both cards readable; the check mark; focus ring visible |
| A dialog (Elevator, Arcade Pass, No Pass) | panel, plaque, buttons, close |
| A bottom sheet (any modal at < 768px) | safe area, drag handle, close |
| Shop / economy | prices, coin balance, the accent purchase button |
| Inventory / item bag | item cards, quantities, empty state |
| Mine, Arcade, Beach | overlays over their own art |
| Loading / empty / error | `StateCard`, `PageLoading` |
| Focus | Tab through a dialog — the ring must be visible on every stop |
| Reduced motion | OS setting on: no spinner spin, no card lift, states still change |

Viewports: desktop, mobile portrait, mobile landscape.

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
