# The My Blobbi inventory — reference study and design principles

Written before the redesign, so the decisions below are traceable to something
other than taste. The brief asked for a game inventory, not a dashboard; this is
what "a game inventory" turns out to mean once you look at several of them.

---

## 1. Reference study

Patterns, not artwork. Nothing here is copied — the point is to understand *why*
these interfaces work and then build the island's own version.

### Club Penguin — the player card

**What works.** The avatar and the item grid share one surface: the player card
shows the penguin, a button flips it to the inventory, and clicking an item wears
it *immediately*. Items are sorted into eight slot-based categories plus an
"everything" ninth. Later revisions (CPIP) added search and scrolling because the
flat grid stopped scaling.

**Why it works.** The feedback loop is one click long. You never ask "what will
this look like on me" — you look. Categories are *slots*, so the mental model is
the character, not a database.

**Blobbi borrows.** The character stays visible while browsing wearables; one tap
to try something; slot-shaped thinking for cosmetics.

**Blobbi does NOT copy.** The flip-card metaphor (Blobbi's stage and tabs are
already side by side, so flipping would hide the thing you are dressing), the
proprietary chrome, or the flat ungrouped grid that forced them to bolt on search.

### Destiny 2 / Diablo IV — grid + detail

**What works.** Hundreds of items stay manageable because the grid carries only
art, a stack count and a rarity rim, while everything else — stats, description,
comparison — appears in a panel when an item is selected.

**Why it works.** Visual hierarchy. The scanning task (find the thing) and the
deciding task (should I use it) are separated, so neither crowds the other.

**Blobbi borrows.** Art-first tiles; selection reveals detail; exactly one primary
action per selected item.

**Blobbi does NOT copy.** Density and stat blocks. Blobbi has tens of items, not
hundreds, and no numbers worth comparing.

### Animal Jam / Webkinz / Toontown — the collection feeling

**What works.** Framed cells, a consistent tile shape, and generous artwork make
an inventory read as *a collection of things I got* rather than a list of rows.

**Why it works.** The frame is a container metaphor. It implies the set is
finite and worth completing.

**Blobbi borrows.** A consistent framed tile (`ItemTile` already is one) and a
grid that keeps its shape whether it holds three items or thirty.

**Blobbi does NOT copy.** Fake locked slots to pad the grid. Inventing phantom
items to make a collection look bigger is a dark pattern, and the brief rules it
out.

### Neopets — categories as navigation

**What works.** A small, stable set of category entries, each with an icon,
sitting above the grid.

**Why it works.** Filtering beats sectioning once you have more than about three
groups: sections force the player to scroll past everything they are not looking
for.

**Blobbi borrows.** A horizontal category strip that filters one grid.

**Blobbi does NOT copy.** Category *counts* in the hundreds, or nested
subcategories.

### General game-UI guidance

The literature is consistent on two points that matter here: an inventory should
share the art style of the game around it, or opening it breaks immersion; and
critical information belongs above secondary detail in the visual hierarchy.
Both argue against the shadcn-cards-in-a-modal look the island had.

---

## 2. Blobbi inventory design principles

1. **Art first.** A tile is artwork, a quantity badge, and a short name. No
   description, no category label, no buttons, no diagnostics.
2. **Selection reveals detail.** One item is selected at a time; its description,
   rarity and single primary action live in a detail panel, not in every tile.
3. **The Blobbi stays visible.** Cosmetics are chosen by looking at the Blobbi
   wearing them. The stage is already beside the tabs, so this costs nothing.
4. **Categories are a lightweight filter, not sections.** One horizontal strip of
   chips over one grid. A category with nothing in it is not shown.
5. **Equipped is legible at a glance.** A ring plus a corner mark on the tile, and
   a stated "Equipped" in the detail — never colour alone.
6. **One collection language, two verbs.** Wearables and consumables look alike
   and behave differently: *Wear* / *Take off* versus *Use*. The verb lives in
   the detail panel, where there is room to say what it will do.
7. **Rarity is a rim, not a fill.** A subtle border treatment that survives every
   theme; never a saturated card background.
8. **Mobile is a touch-first collection browser.** The strip scrolls horizontally,
   the grid keeps big tap targets, and the detail panel becomes a panel beneath
   the grid rather than a squeezed sidebar.

---

## 3. What this replaces

| Before | After |
| --- | --- |
| Two stacked panels (`Wearables`, `Items`), each with its own header, tabs and empty state | One grid, one category strip, one detail panel |
| `EquipmentPanel`'s nested Owned/Worn tabs inside the modal's tabs inside the window | No nested tabs — worn items are marked in place |
| Six category sections stacked vertically, all expanded | Six filter chips over one grid |
| Every tile carrying name + slot + quantity + a `worn` badge | Art, quantity badge, name; state as a ring |
| Transform sliders always mounted under the worn list | Shown in the detail panel, for the selected worn item |
| Raw `bg-amber-50/50` / `dark:` diagnostics boxes | Tokenised, collapsed by default |

---

## 4. Manual visual checklist

Browser automation is unavailable in this environment, so the checks below have
**not** been performed. They are what to walk when it is.

### Opening the window

| Step | Expect |
| --- | --- |
| Click your own Blobbi in the world | My Blobbi opens on the **Blobbi** tab |
| Press "My Blobbi" in the bottom dock | the same window, same tab |
| Look at the upper-right corner of the island | Arcade pass / ticket chip only — **no 🎒** |
| Click somebody else's Blobbi | read-only: the Blobbi tab alone, no Items, no Effects, no background control |

### Blobbi tab

| Check | Expect |
| --- | --- |
| Badge row | stage · generation, condition, and Coins on the right |
| A Blobbi that needs something | one alert naming the need — and **not** repeated below |
| "How they are doing" | five stat bars, two columns from `sm` up |
| "About them" | XP, streak, personality, trait, mood as a two-column list |
| "Appearance" | a row with a backdrop thumbnail, its name, and a chevron |
| Press it | the background picker opens; choosing one repaints the stage immediately |
| A very long Blobbi name | truncates in the window title, never wraps the header |

### Items tab

| Check | Expect |
| --- | --- |
| First open | grid of artwork, `All` chip selected, "Pick something…" prompt |
| Chips | only categories you actually own; counts match |
| Tap a wearable | detail shows slot, count, description; one **Wear it** button |
| Wear it | the Blobbi changes on the stage; the tile gains a `Worn` mark |
| Tap the worn item | **Take it off**, plus Size/Tilt sliders and a Save button once dragged |
| Drag it on the stage | position follows; Save publishes once |
| Tap a food/care item | **Use it** → the shared consume dialog |
| Tap a coin/ticket | no verb, an explanation instead |
| Empty inventory | "Your bag is empty" |
| Many items (20+) | grid scrolls; the tab strip and stage stay put |

### Effects tab

| Check | Expect |
| --- | --- |
| Owned / active / previewing / unavailable | four visibly different states, none by colour alone |
| Preview | the Blobbi changes; leaving the tab restores it |
| Equip over an occupied slot | the card says which effect will be replaced, and the button reads **Replace** |

### Responsive

| Viewport | Expect |
| --- | --- |
| Desktop | stage left, tabs right; detail panel beside the grid from `lg` |
| Mobile portrait | sheet; stage ~30dvh on top, tabs under it, detail **below** the grid |
| Mobile landscape | stage and tabs side by side; no horizontal scroll |
| All | one scroll region — the tab content — and the tab strip always reachable |

### Themes

Walk the Items tab in **Cozy Day**, **Lantern Night**, and one community theme
with a custom font. Item artwork is art and does not change; every frame, chip,
badge and button must follow the palette, and the window title must pick up a
theme's display font.
