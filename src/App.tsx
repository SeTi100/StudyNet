import React, { useState, useEffect } from 'react';
import { Dashboard } from './components/dashboard/Dashboard';
import { ReaderView } from './components/reader/ReaderView';

export default function App() {
  const [currentView, setCurrentView] = useState<'dashboard' | 'reader'>('dashboard');

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#/, '');
      if (hash === 'dashboard') {
        setCurrentView('dashboard');
      } else if (hash.startsWith('doc=')) {
        setCurrentView('reader');
      } else if (!hash) {
        setCurrentView('dashboard'); // Default
      }
    };

    // Initial check
    handleHashChange();

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <>
      {currentView === 'dashboard' ? (
        <Dashboard />
      ) : (
        <ReaderView />
      )}
    </>
  );
}
