import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import App from './App.js';
import { ThemeProvider } from './hooks/useTheme.js';
import { queryClient } from './lib/queryClient.js';
import { useUiPreferences } from './lib/uiPreferences.js';
import './index.css';

function AppWithPreferences() {
  const { preferences } = useUiPreferences();
  const reducedMotion = preferences.motion === 'reduce' ? 'always' : preferences.motion === 'full' ? 'never' : 'user';
  return (
    <MotionConfig reducedMotion={reducedMotion}>
      <App />
    </MotionConfig>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AppWithPreferences />
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
