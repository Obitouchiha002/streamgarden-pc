import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installDevShim } from './devShim';
import './styles.css';

// The components capture window.sg when their module first evaluates, so the stand-in has
// to exist before any of them are imported. A top-level `await import` would do it, but
// top-level await isn't allowed by the build target — hence the promise chain.
// Inside Electron the shim sees the real bridge and does nothing.
installDevShim();

import('./App').then(({ default: App }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode><App /></StrictMode>
  );
});
