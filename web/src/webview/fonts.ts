/* The cyber skin's faces, inlined. The web app pulls them from Google Fonts
 * at runtime; a WebView on the phone has no business phoning Google, and a
 * file:// page can't reach a sibling directory under Expo's asset rules, so
 * the build turns these into data: URIs (assetsInlineLimit is unbounded in
 * vite.webview.config.ts). Same files Capra registers natively through
 * expo-font, so the two renderers agree glyph for glyph. */
import chakra400 from '../../../node_modules/@expo-google-fonts/chakra-petch/400Regular/ChakraPetch_400Regular.ttf?url';
import chakra500 from '../../../node_modules/@expo-google-fonts/chakra-petch/500Medium/ChakraPetch_500Medium.ttf?url';
import chakra600 from '../../../node_modules/@expo-google-fonts/chakra-petch/600SemiBold/ChakraPetch_600SemiBold.ttf?url';
import chakra700 from '../../../node_modules/@expo-google-fonts/chakra-petch/700Bold/ChakraPetch_700Bold.ttf?url';
import orbitron700 from '../../../node_modules/@expo-google-fonts/orbitron/700Bold/Orbitron_700Bold.ttf?url';
import orbitron900 from '../../../node_modules/@expo-google-fonts/orbitron/900Black/Orbitron_900Black.ttf?url';
import mono400 from '../../../node_modules/@expo-google-fonts/share-tech-mono/400Regular/ShareTechMono_400Regular.ttf?url';

const FACES: [family: string, weight: number, url: string][] = [
  ['Chakra Petch', 400, chakra400],
  ['Chakra Petch', 500, chakra500],
  ['Chakra Petch', 600, chakra600],
  ['Chakra Petch', 700, chakra700],
  ['Orbitron', 700, orbitron700],
  ['Orbitron', 900, orbitron900],
  ['Share Tech Mono', 400, mono400],
];

export function installFonts() {
  const css = FACES.map(
    ([family, weight, url]) =>
      `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;font-display:swap;src:url("${url}") format("truetype")}`,
  ).join('\n');
  const el = document.createElement('style');
  el.id = 'tx-fonts';
  el.textContent = css;
  document.head.appendChild(el);
}
