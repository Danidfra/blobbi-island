import { createRoot } from 'react-dom/client';

// Import polyfills first
import './lib/polyfills.ts';

import App from './App.tsx';
import './index.css';

// Import Comfortaa font for the design system (only 400 weight to reduce bundle size)
import '@fontsource/comfortaa/400.css';

createRoot(document.getElementById("root")!).render(<App />);
