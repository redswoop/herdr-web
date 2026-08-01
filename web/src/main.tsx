import { createRoot } from 'react-dom/client';
import App from './App';
import { initWebPlatform } from './platform.web';
import './style.css';

initWebPlatform();
createRoot(document.getElementById('root')!).render(<App />);
