import { createRoot } from 'react-dom/client';

// Import polyfills first
import './lib/polyfills.ts';
// A World Travel hand-off in the address is taken out of it before anything else runs (src/worlds)
import './worlds/handoff-capture.ts';

import App from './App.tsx';
import './index.css';

// Import Comfortaa font for the design system (only 400 weight to reduce bundle size)
import '@fontsource/comfortaa/400.css';

createRoot(document.getElementById("root")!).render(<App />);
