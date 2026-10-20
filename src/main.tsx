import { createRoot } from 'react-dom/client';

// Import polyfills first
import './lib/polyfills.ts';
// An older build's World Travel hand-off (a fragment in the address, ids kept in storage) is dropped unread before
// anything else runs: nothing in a URL moves a Blobbi any more (src/worlds/world-travel-departure.ts)
import { dropLegacyHandoff, dropLegacyHandoffStore } from './worlds/world-travel-departure.ts';

import App from './App.tsx';
import './index.css';

// Import Comfortaa font for the design system (only 400 weight to reduce bundle size)
import '@fontsource/comfortaa/400.css';

dropLegacyHandoff();
dropLegacyHandoffStore();

createRoot(document.getElementById("root")!).render(<App />);
