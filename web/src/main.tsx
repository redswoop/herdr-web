import { createRoot } from 'react-dom/client';
import App from './App';
import { initWebPlatform } from './platform.web';
import { applyTheme, loadTheme } from './theme';
import { initPrefs } from './prefs';
import './style.css';
import '@redswoop/cyberdos/cyber.css';

applyTheme(loadTheme());
initWebPlatform();
initPrefs();
createRoot(document.getElementById('root')!).render(<App />);
