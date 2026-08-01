import * as SecureStore from 'expo-secure-store';

const URL_KEY = 'herdr.serverUrl';
const TOKEN_KEY = 'herdr.token';

export interface ServerSettings {
  baseUrl: string;
  token: string;
}

export async function loadSettings(): Promise<ServerSettings> {
  const [baseUrl, token] = await Promise.all([
    SecureStore.getItemAsync(URL_KEY),
    SecureStore.getItemAsync(TOKEN_KEY),
  ]);
  return {
    baseUrl: baseUrl ?? '',
    token: token ?? '',
  };
}

export async function saveSettings(s: ServerSettings): Promise<void> {
  await SecureStore.setItemAsync(URL_KEY, s.baseUrl.trim().replace(/\/$/, ''));
  if (s.token.trim()) await SecureStore.setItemAsync(TOKEN_KEY, s.token.trim());
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}
