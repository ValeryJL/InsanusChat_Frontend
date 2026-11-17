import React from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';
import { VSCodeChatApp } from './VSCodeChatApp';

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <VSCodeChatApp />
    </React.StrictMode>
  );
}
