import { createRoot } from 'react-dom/client';
import App from './App';
import { initWebPlatform } from './platform.web';
import { applyTheme, loadTheme } from './theme';
import { initPrefs } from './prefs';
import './style.css';
import '@redswoop/cyberdos/web/cyber.css';
import './theme-cyber.css'; // herdr's adapter onto the skin: must follow the skin

applyTheme(loadTheme());
initWebPlatform();
initPrefs();
createRoot(document.getElementById('root')!).render(<App />);
