// Imported first: it patches AudioNode.prototype before any audio node exists.
import './installTap';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { reportErrors } from './reportErrors';
import '@xterm/xterm/css/xterm.css';
import './theme.css';

reportErrors();

// No StrictMode. Its double-invoked effects would spawn the harness twice and
// build a second AudioContext, and neither is a cheap rehearsal here.
createRoot(document.getElementById('root')!).render(<App />);
