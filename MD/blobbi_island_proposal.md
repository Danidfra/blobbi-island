
# 🏝️ Blobbi Island — App Design Proposal

## 📌 Overview

**Blobbi Island** is a new app inspired by classic experiences like Club Penguin, but integrated with the **Nostr** network and focused on customizable characters called **Blobbis**. The proposal includes:

- Modern-style welcome screen
- Login via Nostr
- Character loading via Nostr events (kinds 31124 and 31125)
- Explorable world with clickable areas
- Full support for desktop and mobile (including mandatory landscape on mobile)

---

## 🧭 Home Page Structure

- **Modern, responsive header** (based on `DESIGN_SYSTEM.md`)
  - Blobbi Island logo
  - Login/logout button
  - Gear icon for configuring connected Nostr relays
- **Main screen body**
  - Dimensions: `1046x697` (with landscape support on mobile)
  - If not logged in:
    - Background image with two buttons:
      - **Login with Nostr**
      - **Create Account** (link to [blobbi.pet](https://blobbi.pet))
  - If logged in:
    - Perform requests:
      - `kind 31125` → for `current_companion`
      - `kind 31124` → to list all Blobbis tied to the user's pubkey
    - Display Blobbi selection screen
    - If user selects a different Blobbi:
      - Create new `kind 31125` with updated `current_companion` tag
    - Load selected Blobbi's data:
      - Required tags: `stage`, `base_color`, `secondary_color` (if applicable), `eye_color`
      - Only Blobbis with `stage != egg` are allowed
      - Render appropriate SVG:
        - `baby`: `https://danidfra.github.io/blobbi-designs/baby-stage/baby/blobbi-baby-base.svg`
        - `adult`: `https://danidfra.github.io/blobbi-designs/adult-stage/{adult_type}/{adult_type}-base.svg`
      - Modify SVG based on tag colors (`base_color`, `secondary_color`, `eye_color`)

---

## 🎨 SVG Modification Example (Baby)

```ts
function customizeSvg(svgText: string, blobbi: Blobbi, isSleeping: boolean = false): string {
  let modifiedSvg = svgText;

  if (!blobbi.baseColor && !blobbi.secondaryColor) return modifiedSvg;

  const bodyGradientRegex = /<radialGradient[^>]*id=["']blobbiBodyGradient["'][^>]*>([\s\S]*?)<\/radialGradient>/;
  const match = modifiedSvg.match(bodyGradientRegex);

  if (match && blobbi.baseColor) {
    const newGradient = blobbi.secondaryColor
      ? `<radialGradient id="blobbiBodyGradient" cx="0.3" cy="0.25">
          <stop offset="0%" style="stop-color:${blobbi.secondaryColor}"/>
          <stop offset="60%" style="stop-color:${lightenColor(blobbi.secondaryColor, 20)}"/>
          <stop offset="100%" style="stop-color:${blobbi.baseColor}"/>
        </radialGradient>`
      : `<radialGradient id="blobbiBodyGradient" cx="0.3" cy="0.25">
          <stop offset="0%" style="stop-color:${lightenColor(blobbi.baseColor, 40)}"/>
          <stop offset="60%" style="stop-color:${lightenColor(blobbi.baseColor, 20)}"/>
          <stop offset="100%" style="stop-color:${blobbi.baseColor}"/>
        </radialGradient>`;

    modifiedSvg = modifiedSvg.replace(match[0], newGradient);
  }

  if (blobbi.eyeColor && !isSleeping) {
    const eyeGradientRegex = /<radialGradient[^>]*id=["']blobbiPupilGradient["'][^>]*>([\s\S]*?)<\/radialGradient>/;
    const eyeMatch = modifiedSvg.match(eyeGradientRegex);
    if (eyeMatch) {
      const newEyeGradient = `<radialGradient id="blobbiPupilGradient" cx="0.3" cy="0.3">
        <stop offset="0%" style="stop-color:${lightenColor(blobbi.eyeColor, 30)}"/>
        <stop offset="100%" style="stop-color:${blobbi.eyeColor}"/>
      </radialGradient>`;
      modifiedSvg = modifiedSvg.replace(eyeMatch[0], newEyeGradient);
    }
  }

  return modifiedSvg;
}
```

---

## 🗺️ Game Screen

After the user selects their Blobbi, the image `blobbi-island.png` will be loaded in the center window with the following elements added:

- `nostr-station.png`
- `mine.png`
- `plaza.png`
- `home.png`
- `town.png`
- `beach.png`

**Interactions:**
- `:hover` → zoom effect + pointer cursor
- Positioned using `absolute` and customizable via code

---

## 📱 Mobile

- Central window must adapt to **mandatory landscape mode**
- Rotation warning or guidance if user is in portrait mode

---

## 🔌 Nostr Integration

- Uses the following kinds:
  - `31124` → Blobbi data (tags: `stage`, `base_color`, `eye_color`, etc.)
  - `31125` → Current companion (`current_companion`)
- Relay settings controlled by gear icon
- Defaults to standard relays if none configured

---

## 📚 References & Documentation

- `DESIGN_SYSTEM.md` → for visual consistency
- `old-NIP.md` → for kind and tag structure reference
