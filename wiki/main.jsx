import React from 'react';
import ReactDOM from 'react-dom/client';
import WikiApp from '../src/wiki/WikiApp';
import '../src/index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WikiApp />
  </React.StrictMode>
);
