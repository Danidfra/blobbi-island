/*
 * Blobbi Island — pre-paint theme application.
 *
 * Runs as a BLOCKING <script> in <head>, before the stylesheet has painted
 * anything and long before React mounts, so a player on a non-default theme
 * never sees the default island flash first.
 *
 * ## Why the palettes are duplicated here
 *
 * This file cannot import from `src/lib/island-themes.ts`: it must run before
 * the module graph loads, which is the entire point of it. The duplication is
 * therefore deliberate and it is GUARDED — `src/lib/island-theme.boot.test.ts`
 * parses this file and asserts every palette here matches the registry value
 * for value. A theme added to the registry and not to this file fails the test
 * rather than silently flashing.
 *
 * ## Why being wrong here is survivable
 *
 * Everything this script does is re-done authoritatively by
 * `useApplyIslandTheme` in AppProvider once React mounts. If the script is
 * blocked, throws, or is out of date, the result is a brief flash of the
 * stylesheet's default palette — never a broken or unstyled island. So it is
 * written to fail silently and never to throw into the page.
 */
(function () {
  'use strict';

  // Must match `islandThemes` in src/lib/island-themes.ts. Asserted by
  // src/lib/island-theme.boot.test.ts.
  var THEMES = {
    'cozy-day': {
      page: '38 100% 96%',
      sky: '199 88% 80%',
      ocean: '197 78% 63%',
      focus: '197 78% 40%',
      grass: '113 46% 62%',
      'grass-dark': '115 36% 33%',
      sand: '43 82% 81%',
      wood: '27 40% 54%',
      'wood-dark': '30 42% 35%',
      cream: '43 100% 92%',
      'cream-2': '42 88% 87%',
      purple: '257 73% 66%',
      ink: '30 38% 16%',
      'ink-soft': '31 24% 34%',
      danger: '6 68% 62%',
      warn: '36 80% 57%'
    },
    'lantern-night': {
      page: '256 26% 12%',
      sky: '250 40% 26%',
      ocean: '196 70% 62%',
      focus: '196 70% 62%',
      grass: '135 34% 52%',
      'grass-dark': '138 34% 62%',
      sand: '32 30% 32%',
      wood: '28 34% 58%',
      'wood-dark': '30 30% 82%',
      cream: '258 22% 20%',
      'cream-2': '256 20% 26%',
      purple: '265 78% 74%',
      ink: '40 60% 94%',
      'ink-soft': '38 22% 72%',
      danger: '6 74% 68%',
      warn: '38 86% 64%'
    }
  };

  var DEFAULT_ID = 'cozy-day';

  try {
    var id = DEFAULT_ID;
    var raw = localStorage.getItem('nostr:app-config');
    if (raw) {
      var cfg = JSON.parse(raw);
      // An id this build does not know (a removed theme, or one of the legacy
      // "light"/"dark"/"system" values) falls through to the default — the same
      // resolution `resolveIslandTheme` performs at runtime.
      if (cfg && typeof cfg.theme === 'string' && THEMES[cfg.theme]) {
        id = cfg.theme;
      }
    }

    var palette = THEMES[id];
    var root = document.documentElement;
    for (var key in palette) {
      if (Object.prototype.hasOwnProperty.call(palette, key)) {
        root.style.setProperty('--island-' + key, palette[key]);
      }
    }
    root.setAttribute('data-island-theme', id);

    // The pre-React loading screen in index.html is inert markup with no access
    // to the stylesheet's tokens yet, so it is painted from the resolved
    // palette here. Without this the very first thing a Lantern Night player
    // sees is still a white page.
    var boot = document.getElementById('island-boot');
    if (boot) {
      boot.style.background = 'hsl(' + palette.page + ')';
      boot.style.color = 'hsl(' + palette['ink-soft'] + ')';
      var ring = boot.querySelector('[data-boot-spinner]');
      if (ring) {
        ring.style.borderColor = 'hsl(' + palette.wood + ' / 0.25)';
        ring.style.borderTopColor = 'hsl(' + palette.ocean + ')';
      }
    }
  } catch (e) {
    // Intentionally silent. AppProvider applies the authoritative palette on
    // mount; the worst case here is one frame of the default island.
  }
})();
