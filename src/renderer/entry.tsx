import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LocaleProvider } from './i18n';
import './styles/bubble-zip.css';
import './styles/monitor.css';

const mount = () => {
  const existingRoot = document.getElementById('app');
  if (existingRoot) {
    return existingRoot;
  }

  const fallbackRoot = document.createElement('div');
  fallbackRoot.id = 'app';
  document.body.innerHTML = '';
  document.body.appendChild(fallbackRoot);
  return fallbackRoot;
};

const rootElement = mount();
const root = createRoot(rootElement);

root.render(
  <React.StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </React.StrictMode>,
);
