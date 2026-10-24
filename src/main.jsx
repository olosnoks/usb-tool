import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Skon\'s USB Tool caught runtime crash:', error, errorInfo);
  }

  handleReset = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((r) => r.unregister());
        });
      }
      if ('caches' in window) {
        caches.keys().then((keys) => {
          keys.forEach((k) => caches.delete(k));
        });
      }
    } catch (e) {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#020617] text-slate-200 font-mono p-6 flex flex-col items-center justify-center">
          <div className="max-w-xl w-full bg-[#0a0f1d] border border-rose-500/40 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <span className="text-2xl">⚠️</span>
              <div>
                <h1 className="text-base font-bold tracking-wider">WORKBENCH RUNTIME CRASH</h1>
                <p className="text-xs text-slate-400">An unexpected exception occurred during UI rendering.</p>
              </div>
            </div>

            <div className="p-3 bg-black/60 border border-slate-800 rounded-xl text-xs text-rose-300 overflow-x-auto">
              <code>{String(this.state.error?.message || this.state.error)}</code>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl text-xs font-bold transition"
              >
                Reload Page
              </button>
              <button
                onClick={this.handleReset}
                className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 rounded-xl text-xs font-bold transition"
              >
                Clear Cache & Force Reset
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Register PWA Service Worker for offline field use
if ('serviceWorker' in navigator && (import.meta.env?.PROD || process.env.NODE_ENV === 'production')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      // Force checking for updated sw.js immediately
      reg.update().catch(() => {});
    }).catch(err => {
      console.warn('PWA service worker registration notice:', err);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
