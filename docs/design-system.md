# Blobbi Island — design system

The rules that let the island's look change without its components changing.

Companion document: [`themes.md`](./themes.md) covers the theme registry and how
to add a theme. This one covers the layers underneath it.

---

## 1. Goals

The island already had a coherent visual identity — warm sand, painted wood, a
bright sky — but it was welded to the build. The Tailwind `island-*` colours
were literal hex, so "change how the island looks" meant "edit components", and
in practice that meant nobody did.

The system exists so that:

- **A colour has exactly one home.** No component decides what warm wood is.
- **A theme is data.** Adding one is a palette, never a component edit.
- **A game still looks like a game.** Clarity and consistency borrowed from
  Ditto; the cozy toy-like identity kept.

---

## 2. The layers

Strict dependency order. Nothing may reach past its own layer.

```
   theme palette          --island-*            15 HSL channel triplets
        ↓                 (src/lib/island-themes.ts + :root in index.css)
   semantic roles         --card, --primary…    references INTO the palette
        ↓                 (@layer base in index.css)
   primitives             Button, Dialog, Card  spend the tokens
        ↓                 (src/components/ui/)
   composed primitives    BlobbiModal, StateCard
        ↓
   feature surfaces       shops, chests, HUD, settings
```

### Layer 1 — the palette

Fifteen colours, held as **bare HSL channels** (`27 40% 54%`), never as
colours. That is what lets Tailwind declare them as
`hsl(var(--island-wood) / <alpha-value>)`, which in turn is what makes
`border-island-wood/30` — the opacity modifier included — follow the theme.

| Token | Role |
| --- | --- |
| `page` | the page behind the wood frame |
| `sky` | sky plate, decorative fills |
| `ocean` | focus rings, informational accents |
| `grass` / `grass-dark` | success, "play", online |
| `sand` | secondary surface, the title plaque |
| `wood` | the frame, and the default cozy CTA |
| `wood-dark` | frame edge, strong label text on cream |
| `cream` | **the panel** — cards, popovers, modals, HUD |
| `cream-2` | the panel one step down: muted rows, chips |
| `purple` | mascot accent — highlights, active state, the accent CTA |
| `ink` / `ink-soft` | text / muted text |
| `danger` | destructive, failure |
| `warn` | caution, cost, attention |

These names are art direction, not hues. `cream` means "the panel"; in Lantern
Night it is a dark violet. Read them as roles and they never lie.

### Layer 2 — semantic roles

The shadcn/Radix contract (`--background`, `--card`, `--primary`, `--ring`, …),
every value a **reference** into layer 1. This is why a stock `<Card>` or
`<Button>` already looks like it belongs on the island, and why the two sets
cannot drift.

| Semantic | Island |
| --- | --- |
| `background` | `page` |
| `card`, `popover` | `cream` |
| `muted` | `cream-2` |
| `secondary`, `input` | `sand` |
| `primary` | `wood` |
| `accent` | `purple` |
| `success` | `grass` |
| `destructive` | `danger` |
| `border` | `wood` (consumed at low alpha) |
| `ring` | `ocean` |
| `foreground`, `muted-foreground` | `ink`, `ink-soft` |

### Layer 3 — composites

Shadows and radii, built from layer 1.

- `shadow-cozy-soft` / `-raised` / `-frame` / `-inset` — the elevation scale.
  Each is the theme's **own ink** at low alpha, so a theme with a cool or dark
  ink casts a shadow that belongs to it rather than a generic black.
- `rounded-lg/md/sm` — the shadcn radius scale, from `--radius` (1rem).
- `rounded-panel` (1.25rem) — a cozy card.
- `rounded-frame` (1.5rem) — a framed modal, or the wood frame itself.

Game surfaces are rounder than form controls. That is the whole radius rule.

---

## 3. What NOT to hardcode

| Never write | Write |
| --- | --- |
| `#B9855B`, `rgba(58,42,26,.1)` | `bg-island-wood`, `shadow-cozy-soft` |
| `text-white` on a themed background | `text-accent-foreground`, `text-island-cream` |
| `bg-slate-100`, `text-gray-600` | `bg-island-cream-2`, `text-island-ink-soft` |
| `rounded-[1.5rem]` | `rounded-frame` |
| `shadow-[0_8px_20px_...]` | `shadow-cozy-raised` |
| a new purple CTA class string | `<Button variant="accent">` |

`text-white` deserves its own note: it is not a colour, it is an assumption —
that the surface underneath is always the darker half of the pair. Lantern
Night makes `purple` and `ocean` the *light* half, and every `text-white` on
them became unreadable. Use the `-foreground` token for the surface, which
already knows the answer in every theme.

Raw hex is legitimate in exactly one place: **artwork**. A sprite's palette, an
effect's gradient, a canvas draw call. Those are pictures of things in the
world, not UI surfaces, and they do not follow the theme.

---

## 4. Primitives

Canonical, in `src/components/ui/`. **Extend these; never add a parallel
`NewButton` / `BetterDialog`.**

### Button

| Variant | Use |
| --- | --- |
| `playful` | the primary cozy CTA — warm wood |
| `accent` | the mascot-purple CTA (login, hatch, confirm, purchase) |
| `success` | play / go / start |
| `soft` | secondary, cancel, list rows |
| `hud` | HUD and dock pills |
| `default` / `outline` / `ghost` / `link` / `destructive` | stock shadcn |

Sizes add `xl`, `icon-lg` and `pill` to the stock scale. Touch targets on game
surfaces should be at least 44px — pass `min-h-[44px]` where a size does not
already give it.

### Dialog

`src/components/ui/dialog.tsx` is the canonical dialog and already models the
island's **two overlay contexts**, which is a distinction worth internalising:

- **App chrome** — account menu, auth, settings. Viewport-level and `fixed`.
  Portal into `useFullscreenPortalContainer()` so it still renders above a
  fullscreened shell.
- **In-world surfaces** — a shop, a chest, an arcade cabinet. These portal into
  `useStageOverlayHost()` with `inFrame`, so they dim only the game window and
  leave the wood frame and the page around it visible. An in-world surface that
  blacks out the browser reads as "the website opened a dialog", not as "you are
  standing at a machine".

  `inFrame` supplies **positioning only**. A dialog moved into the frame must
  bring its own padding and side margins — use `inFrameDialogPanelClass`.

### BlobbiModal

The cozy game modal, composed over `Dialog` and vaul's `Drawer`. Use it for a
new modal surface. It gives you, for free:

- a centered card on desktop and a **bottom sheet on a phone** — not the desktop
  card shrunk until it fits;
- the plaque title treatment;
- focus trap, ESC, backdrop dismiss, scroll lock, restore-focus, `aria-modal`;
- safe-area padding and `dvh` sizing on the sheet.

`title` is required and typed `string`, because an unnamed dialog is announced
as nothing at all. Use `hideTitle` when the content carries its own heading —
the accessible name survives.

### StateCard

Loading / empty / error, with the mascot. Reach for it before writing another
bare spinner or "No items found".

---

## 5. Migration rules

1. **By layer, not by feature.** Tokens → primitives → shell → dialogs →
   settings → shared game panels → feature surfaces → dev surfaces last.
2. **Every batch must remove more style than it adds.** If a migration produces
   the same markup with a hundred new Tailwind classes, it is a repaint, not a
   migration.
3. **Three call sites of the same composition is a primitive.** Two is a
   coincidence.
4. **Preserve component APIs.** Other worktrees are building features against
   them.
5. **Never move business logic to make a screen prettier.** Isolate styling.
   Purchase handlers, settlement, presence and relay semantics are out of scope
   for any visual change.

---

## 6. Responsive

- **Desktop** — the framed island: wood frame, header, footer, page behind.
- **Narrow mobile** — modals become bottom sheets. `BlobbiModal` does this by
  viewport; force it with `variant`.
- **Landscape mobile** — vertical space is the scarce resource. The account menu
  becomes a compact centered modal rather than a dropdown for exactly this
  reason; follow that pattern rather than letting a tall surface scroll.
- **Safe areas** — any surface anchored to a screen edge uses
  `pb-[max(1rem,env(safe-area-inset-bottom))]`, and `dvh` rather than `vh`.
- **Touch** — 44px minimum. Drag surfaces (the hockey table, the treasure field,
  dance lanes) set `touch-action: none` and `overscroll-behavior: contain` so a
  drag never scrolls the page.
- **Long labels** — assume translations are longer. `truncate` on a fixed row,
  wrap everywhere else; never size a control to a specific string.

---

## 7. Accessibility

Non-negotiable, and cheaper to keep than to retrofit:

- **Focus is always visible.** `focus-visible:ring-2 focus-visible:ring-ring`,
  with `ring-offset` matched to the surface behind it. `ring` is `ocean`, which
  is chosen to read against both cream and dusk panels.
- **Colour is never the only signal.** The theme picker pairs each swatch with a
  name and a description; a selected card carries a check, not just a border.
- **Every dialog has an accessible name**, and its description lives in the
  Description slot — never nested inside the title, which would make a screen
  reader read the whole paragraph on every focus entry.
- **Decorative art is `aria-hidden`.** Emoji icons, arrows, preview swatches.
- **Semantic controls.** A thing that does something is a `<button>`. A
  single-choice set is `radiogroup` + `radio`, not a row of toggles.
- **Reduced motion** is honoured in CSS (so it applies before React hydrates)
  and via `motion-reduce:` on interactive transforms. Under reduced motion a
  state change must still be *visible* — keep the state, drop the tween.

---

## 8. Relationship to Ditto

See [`themes.md` §5](./themes.md#5-what-was-taken-from-ditto-and-what-was-not)
for the theme-architecture comparison. In short: the discipline is Ditto's, the
look is the island's.
