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

## 4. Second pass: splitting the collection

The first pass consolidated two duplicate *windows* into one Items tab. Manual
review found that it had also merged two different *activities*.

**Wearing a hat is customization; eating a sandwich is care.** One has the
Blobbi as its feedback loop and wants the pet visible beside it; the other is a
bag you reach into. Merged, a player looking for a hat scrolled past sandwiches,
and a player feeding a hungry Blobbi scrolled past hats.

So the window is now:

```
  Blobbi      the pet — mood, needs, progression, character, scene
  Wardrobe    everything that changes how it LOOKS: clothing + effects
  Items       everything you can USE or spend: food, toys, care, coins
```

**Effects stopped being a top-level tab.** An effect is plainly a kind of
appearance, and a three-tab window spending a third of its primary navigation on
four aura slots was over-weighting them. They are the second half of the
Wardrobe's segmented control — one strip of two buttons, not a second level of
`<Tabs>`.

`useInventoryCollection` was **not** undone: it still merges wearables and
carried items into one model. What changed is that each surface looks at it
through a `categories` lens. One model, two lenses, two activities.

### Virtual-pet reference study (the Blobbi tab)

| Reference | What works | Blobbi borrows | Blobbi does NOT copy |
| --- | --- | --- | --- |
| **Webkinz** | Meters sit *next to the avatar*, not in a separate panel; a small fixed set (happiness / hunger / energy) plus a care heart | Needs as icon-led meters, read beside the pet | The care-heart scoring economy, and its four-meter cap |
| **Tamagotchi-style pets** | The pet's *state* is the interface — one glanceable mood, and everything else is secondary | One mood headline as the hero, chosen by precedence | Obscuring numbers entirely; Blobbi's owners want the values |
| **Neopets** | Compact character descriptors as collectible flavour | Personality / trait / mood as chips | Raw stat tables and battle numbers |
| **General game-UI guidance** | Status bars that update in real time "without cluttering the UI"; critical info above secondary detail | Bars carry the meaning, numbers are small and secondary | Equal visual weight for "starving" and "generation 2" |

**Principles applied to the Blobbi tab**

1. **One headline.** A pet has a mood. `blobbiMood` picks it by precedence —
   asleep, then the urgent need, then the condition — from state that already
   existed. No new calculation, no new threshold.
2. **Needs are meters, not a table.** Icon, word, bar, small number. Generated
   from one list so a need cannot be dropped or mislabelled.
3. **Meters agree with urgency.** `needLevel` uses `getStatUrgency`'s own
   boundaries, so a bar that looks fine while the headline says "Hungry" is
   impossible.
4. **Progression looks like progression** — three trophies, not a definition
   list. And **no fake level**: the game has raw XP and no thresholds, so
   drawing a progress bar would mean inventing a ceiling.
5. **Character is chips**, one per value. The model stores `string | string[]`
   and the old card joined arrays with commas — a database field printed
   verbatim.

### The Blobbi owns its stage

The banner felt huge and the Blobbi small because the renderer box was **128
fixed pixels** (`size="xl"`) inside a stage roughly 540px tall — under a quarter
of the height. The previous pass had made the stage bigger to fix a crop bug and
the Blobbi had not grown with it.

The box is now a **fraction of the stage** (`h-[46%]` of a 2:3 scene, so about
69% of its width), which also removes the need for a viewport breakpoint: the
protagonist is the same size relative to its scene on a phone and on a desktop.

This is safe because *everything the renderer paints is already a percentage of
that box* — accessory x/y, accessory base size (`ACCESSORY_BASE_RATIO`), every
effect polygon — so the Blobbi and everything on it scale as **one unit**. The
placement overlay's drag maths is rect-relative for the same reason. No
accessory-by-accessory compensation exists, or is needed. `size="xl"` is still
passed: it remains the token the renderer reports; only the box is overridden,
through the override the size table already sanctions.

The stage itself got **narrower** (38%→32%, and 24% on Items where a grid of
food gains nothing from a large portrait), so the two changes pull the same way:
background as context, Blobbi as protagonist.

---

## 5. Manual visual checklist

Browser automation is unavailable in this environment, so the checks below have
**not** been performed. They are what to walk when it is.

### Opening the window

| Step | Expect |
| --- | --- |
| Click your own Blobbi in the world | My Blobbi opens on the **Blobbi** tab |
| Press "My Blobbi" in the bottom dock | the same window, same tab |
| Upper-right corner of the island | Arcade chips only — **no 🎒** |
| Click somebody else's Blobbi | read-only: the Blobbi tab alone |

### Blobbi tab — does it feel like a pet?

| Check | Expect |
| --- | --- |
| **The Blobbi dominates its stage** | roughly half the stage height, the backdrop framing it rather than dwarfing it |
| Mood headline | one line — "Feeling great", "Hungry", "Needs a wash" — with a face, at the top |
| A neglected Blobbi | the headline turns loud, names the need, and suggests the fix |
| A sleeping Blobbi | "Fast asleep", and nothing else claims priority |
| Needs | five icon-led bars, green / amber / red, numbers small |
| Very low need | the number goes bold and red as well as the bar — never colour alone |
| Progression | three trophies: XP, streak, generation + stage. **No fake level bar** |
| Character | one chip per personality/trait/mood, never a comma-joined string |
| Appearance row | backdrop thumbnail + name + chevron; opens the picker |

### Wardrobe

| Check | Expect |
| --- | --- |
| Clothing / Effects strip | two buttons, one selected, no nested tab chrome |
| Blobbi visible beside it | yes, at full size |
| Select a wearable | detail panel: slot, count, description, **Wear it** |
| Wear it | the Blobbi changes on the stage **immediately** |
| The worn tile | gains a "Worn" mark and a green rim |
| Select the worn item | **Take it off**, plus Size / Tilt |
| Drag it on the Blobbi | it follows; Save publishes once |
| **Hat / glasses / necklace alignment** | unchanged at the new larger size — nothing drifts, detaches or floats |
| Effects half | preview draws on the real Blobbi; Activate / Remove |
| Leave Effects | the preview ends and the persisted look returns |
| No food, no coins anywhere in the Wardrobe | correct |

### Items

| Check | Expect |
| --- | --- |
| Grid | food, toys, care, coins — **no wearables** |
| Chips | only appear when more than one category is owned |
| Stage | visibly smaller here than on the other tabs, and does not jump jarringly |
| Select a food item | description, quantity, **Use it** → consume dialog |
| Select a coin/ticket | no verb, an explanation |

### Responsive

| Viewport | Expect |
| --- | --- |
| Desktop | stage left (~30%), tabs right; detail beside the grid from `lg` |
| Mobile portrait | stage ~26dvh on top and **not clipped**; tabs immediately reachable; Blobbi still large enough to read |
| Mobile portrait, Items | stage drops to ~18dvh; the grid gets the room |
| Mobile landscape | stage and content side by side; no horizontal scroll |
| All | one scroll region; the tab strip never scrolls away |

### Forms, art and themes

Walk the Blobbi and Wardrobe tabs for:

- a **baby** Blobbi and an **adult** one — both should fill the stage similarly;
- with a wearable on, and with an effect active;
- the **default** stage background and **Island Sky**;
- **Cozy Day**, **Lantern Night**, and one community theme with a custom font —
  every frame, chip, meter and trophy follows the palette; the window title and
  the mood headline pick up the display font.
