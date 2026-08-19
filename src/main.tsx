import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Service Worker Registration for OPFS streaming
import swUrl from './sw.ts?worker&url';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(swUrl, { type: 'module' })
      .then((registration) => {
        console.log('StudyNet Service Worker registered with scope:', registration.scope);
      })
      .catch((error) => {
        console.warn('StudyNet Service Worker registration failed:', error);
      });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
