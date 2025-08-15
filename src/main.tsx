import { createRoot } from 'react-dom/client';

// Import polyfills first
import './lib/polyfills.ts';

import App from './App.tsx';
import './index.css';

// Import Comfortaa font for the design system
import '@fontsource/comfortaa';

createRoot(document.getElementById("root")!).render(<App />);
