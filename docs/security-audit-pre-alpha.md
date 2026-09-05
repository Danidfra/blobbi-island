# Pre-alpha security audit (September 2026)

Findings from the pass made before sharing Blobbi Island with early testers,
kept here because two of them are architectural and were deliberately NOT
fixed in that pass. The finding that was fixed is described so the test that
guards it (`MultiplayerLayer.visual-injection.test.tsx`) makes sense.

## Platform

Blobbi Island is a browser-only single-page app: Vite + React, served as static
files (GitHub Pages workflow, `nostr-deploy-cli`, an `_redirects` fallback).
There is no Android/iOS wrapper, no Capacitor, Cordova, Electron, Tauri or
React Native. `public/sw.js` is a self-destroying service worker that only
unregisters an old one; nothing registers a worker. The manifest is a plain PWA
manifest with no protocol handlers. The Ditto Android class of bug (native
code building JavaScript from a link) has no equivalent surface here: the only
"native → UI" edge is the browser's own URL bar, and React Router hands the
path over as data.

## Fixed: stranger-authored colours reached an HTML sink

`MultiplayerLayer` reads `base_color` / `secondary_color` / `eye_color` from
another player's kind 31124 and passes them to `@blobbi-kit/renderer`. The V1
artwork customizer splices those strings into SVG attribute values (for
example `style="stop-color:…"`) without escaping, and `BlobbiRenderer` mounts
the result through `dangerouslySetInnerHTML`. A stranger could therefore put
arbitrary markup into every player's page just by walking onto the island
with a crafted colour tag. The page CSP (`script-src 'self'`, no
`unsafe-inline`) stops that markup from running script, but not from drawing
UI, links or tracking images.

The fix is `src/lib/blobbi-visual-colors.ts`: only `#rgb` / `#rrggbb` pass the
parse boundary. The local player's own colours already go through
`@blobbi-kit/core`, which validates hex, so no other path was affected.

## Fixed upstream, pending a release: the renderer trusted its caller

The sink lives in the shared library. In `@blobbi-kit/renderer` 0.1.0,
`normalizeBlobbiRenderModel` sanitises the instance id but not the colours,
and the V1 customizers accept any string. The blobbi-kit source now validates
colours at the artwork boundary itself (hex only, every entry point), so a
host is safe by construction once it consumes a renderer release that carries
that change. Island's `sanitizeBlobbiColor` gate stays as defence in depth;
until the upgraded renderer is installed here it is also the only gate, so
any new call site that renders a Blobbi from relay data must go through it.

## Not fixed here: the secret key is stored in plaintext

Both Island and Nostr Farm use `@nostrify/react`'s `NostrLoginProvider`, which
persists every login, including the raw `nsec`, as JSON in `localStorage`
(`nostr:login` here, `nostr-worlds:login` on the Farm). Any script running in
the origin can read it; nothing in the app logs it, puts it in a URL or sends
it anywhere, but a future XSS would be a key-theft bug rather than a
defacement bug. This is the mkstack default and is shared with every mkstack
app; changing it means a signer-in-worker or encrypted-at-rest design in the
login layer, which is a product decision for after alpha. Extension (NIP-07)
and bunker (NIP-46) logins never hold the user's key in the page.

## Defence in depth

The CSP is a `<meta>` tag because static hosting cannot set headers. A meta
CSP cannot carry `frame-ancestors`, so the app has no clickjacking protection
on GitHub Pages; if it ever moves to a host that supports headers, add
`Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options:
nosniff` and a `Referrer-Policy`.
