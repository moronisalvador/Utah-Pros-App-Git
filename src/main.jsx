import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import './index.css';

// Notify Capgo that the app booted successfully so a bad OTA bundle isn't
// auto-rolled-back. Defensive try/catch: a top-level module throw here would
// blank the entire app — if notifyAppReady ever changes its web fallback
// behavior, or the plugin isn't loaded for any reason, we swallow it and
// let React mount anyway. The promise is fire-and-forget (no await) and
// unhandled rejections won't stop rendering, but we guard the synchronous
// call site defensively.
try {
  const p = CapacitorUpdater.notifyAppReady();
  if (p && typeof p.catch === 'function') {
    p.catch((err) => console.warn('CapacitorUpdater.notifyAppReady failed:', err?.message || err));
  }
} catch (err) {
  console.warn('CapacitorUpdater.notifyAppReady threw:', err?.message || err);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
