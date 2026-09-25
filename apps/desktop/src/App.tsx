import { journal } from "@blob-land/sim";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useCallback, useEffect, useState } from "react";
import { AuthScreen } from "@/components/auth-screen";
import { GardenScreen } from "@/components/garden-screen";
import { getGarden, ping, setVisibility, type AuthResponse, type GardenBlob } from "@/lib/api";
import { loadState, saveState, type AppState } from "@/lib/state";

const PING_INTERVAL_MS = 60_000;

export default function App() {
  const [appState, setAppState] = useState<AppState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [blobs, setBlobs] = useState<GardenBlob[]>([]);

  useEffect(() => {
    loadState()
      .then(setAppState)
      .finally(() => setLoaded(true));
  }, []);

  const refreshGarden = useCallback(async (state: AppState) => {
    const { blobs } = await getGarden(state.token);
    setBlobs(blobs);
  }, []);

  // Notable-journal notifications since the last visit, once per session.
  useEffect(() => {
    if (!appState) return;
    const now = Date.now();
    const entries = journal(appState.seed, appState.lastOpenedAt, now);
    if (entries.length > 0) {
      void (async () => {
        const granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
        if (!granted) return;
        for (const entry of entries) sendNotification({ title: appState.pseudo, body: entry.text });
      })();
    }
    const next = { ...appState, lastOpenedAt: now };
    setAppState(next);
    void saveState(next);
    // Deliberately keyed on the account (token), not on every appState change,
    // so this runs once per login/app-start rather than on each ping refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState?.token]);

  // Presence ping + garden refresh while the app is active.
  useEffect(() => {
    if (!appState) return;
    void refreshGarden(appState);
    const id = setInterval(() => {
      ping(appState.token)
        .then(() => refreshGarden(appState))
        .catch(() => {});
    }, PING_INTERVAL_MS);
    return () => clearInterval(id);
  }, [appState?.token, refreshGarden]);

  function handleAuthenticated(pseudo: string, response: AuthResponse) {
    const now = Date.now();
    const state: AppState = {
      pseudo,
      seed: response.seed,
      token: response.token,
      createdAt: now,
      lastOpenedAt: now,
      settings: { visible: true },
    };
    void saveState(state);
    setAppState(state);
  }

  async function handleToggleVisibility() {
    if (!appState) return;
    const visible = !appState.settings.visible;
    await setVisibility(appState.token, visible);
    const next = { ...appState, settings: { visible } };
    setAppState(next);
    void saveState(next);
  }

  if (!loaded) return null;
  if (!appState) return <AuthScreen onAuthenticated={handleAuthenticated} />;

  return (
    <GardenScreen
      pseudo={appState.pseudo}
      blobs={blobs}
      visible={appState.settings.visible}
      onToggleVisibility={handleToggleVisibility}
    />
  );
}
