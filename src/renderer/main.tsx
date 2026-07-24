import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installDevShim } from './devShim';
import './styles.css';

// The components capture window.sg when their module first evaluates, so the stand-in has
// to be in place before any of them are imported — hence the dynamic import below rather
// than a plain top-level one. Inside Electron the shim sees the real bridge and does nothing.
installDevShim();

const { default: App } = await import('./App');

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
);
