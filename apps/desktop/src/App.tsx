import { journal } from "@blob-land/sim";
import { normalizeSeed } from "blobatar";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useCallback, useEffect, useState } from "react";
import { GardenScreen } from "@/components/garden-screen";
import { JoinGardenScreen } from "@/components/join-garden-screen";
import { PseudoScreen } from "@/components/pseudo-screen";
import { getGarden, ping, setVisibility, type AuthResponse, type GardenBlob } from "@/lib/api";
import { loadState, saveState, type AppState } from "@/lib/state";

const PING_INTERVAL_MS = 60_000;

export default function App() {
  const [appState, setAppState] = useState<AppState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [joining, setJoining] = useState(false);
  const [blobs, setBlobs] = useState<GardenBlob[]>([]);

  useEffect(() => {
    loadState()
      .then(setAppState)
      .finally(() => setLoaded(true));
  }, []);

  const refreshGarden = useCallback(async (token: string) => {
    const { blobs } = await getGarden(token);
    setBlobs(blobs);
  }, []);

  // Notable-journal notifications since the last visit, once per session —
  // always about the local blob, whether or not an account exists yet.
  useEffect(() => {
    if (!appState) return;
    const now = Date.now();
    const entries = journal(appState.localSeed, appState.lastOpenedAt, now);
    if (entries.length > 0) {
      void (async () => {
        const granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
        if (!granted) return;
        for (const entry of entries) sendNotification({ title: appState.localPseudo, body: entry.text });
      })();
    }
    const next = { ...appState, lastOpenedAt: now };
    setAppState(next);
    void saveState(next);
    // Deliberately keyed on localSeed, not on every appState change, so this
    // runs once per app-start rather than on each ping refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState?.localSeed]);

  // Presence ping + garden refresh while the app is active — only once an
  // account exists, since /garden and /me/ping both require a token.
  useEffect(() => {
    const token = appState?.account?.token;
    if (!token) return;
    void refreshGarden(token);
    const id = setInterval(() => {
      ping(token)
        .then(() => refreshGarden(token))
        .catch(() => {});
    }, PING_INTERVAL_MS);
    return () => clearInterval(id);
  }, [appState?.account?.token, refreshGarden]);

  function handlePseudoChosen(pseudo: string) {
    const now = Date.now();
    const state: AppState = {
      localPseudo: pseudo,
      localSeed: normalizeSeed(pseudo),
      createdAt: now,
      lastOpenedAt: now,
      settings: { visible: true },
      account: null,
    };
    void saveState(state);
    setAppState(state);
  }

  function handleJoined(pseudo: string, response: AuthResponse) {
    if (!appState) return;
    const next: AppState = { ...appState, account: { pseudo, seed: response.seed, token: response.token } };
    void saveState(next);
    setAppState(next);
    setJoining(false);
  }

  async function handleToggleVisibility() {
    if (!appState?.account) return;
    const visible = !appState.settings.visible;
    await setVisibility(appState.account.token, visible);
    const next = { ...appState, settings: { visible } };
    setAppState(next);
    void saveState(next);
  }

  if (!loaded) return null;
  if (!appState) return <PseudoScreen onChosen={handlePseudoChosen} />;
  if (joining) {
    return <JoinGardenScreen localPseudo={appState.localPseudo} onJoined={handleJoined} onCancel={() => setJoining(false)} />;
  }

  return (
    <GardenScreen
      localPseudo={appState.localPseudo}
      localSeed={appState.localSeed}
      account={appState.account}
      blobs={blobs}
      visible={appState.settings.visible}
      onToggleVisibility={handleToggleVisibility}
      onJoinGarden={() => setJoining(true)}
    />
  );
}
