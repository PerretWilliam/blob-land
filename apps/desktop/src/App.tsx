import { notable, type Identity, type Segment } from "@blob-land/sim";
import { normalizeSeed } from "blobatar";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useCallback, useEffect, useRef, useState } from "react";
import { GardenScreen } from "@/components/garden-screen";
import { JoinGardenScreen } from "@/components/join-garden-screen";
import { PseudoScreen } from "@/components/pseudo-screen";
import { getGarden, ping, setCountry, setIdentity, setVisibility, type AuthResponse, type GardenBlob, type GardenClock, type GardenRegion } from "@/lib/api";
import { defaultIsland, ISLAND_SIZE, loadIsland, saveIsland, type IslandLayout } from "@/lib/island";
import { advanceLife, newLife } from "@/lib/life";
import { loadState, saveState, type AppState } from "@/lib/state";

const PING_INTERVAL_MS = 60_000;
// A sped-up dev garden is lived only minutes ahead of now, in real time: refresh often.
const FAST_GARDEN_REFRESH_MS = 10_000;
// Played timeline kept per blob, in garden time: what the API sends in a full answer.
const SEGMENT_HISTORY_MS = 15 * 60_000;
// How often the private blob's life is lived a bit further and saved.
const LIFE_TICK_MS = 60_000;

export default function App() {
  const [appState, setAppState] = useState<AppState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [joining, setJoining] = useState(false);
  const [blobs, setBlobs] = useState<GardenBlob[]>([]);
  const [gardenClock, setGardenClock] = useState<GardenClock>(() => ({ at: Date.now(), readAt: Date.now(), rate: 1 }));
  // Which region's island is on screen (null: the player's own), and what the server says about the regions.
  const [visiting, setVisiting] = useState<number | null>(null);
  const [regions, setRegions] = useState<{ region: number; home: number; list: GardenRegion[]; size: number } | null>(null);
  const [island, setIsland] = useState<IslandLayout>(() => defaultIsland(ISLAND_SIZE));
  const saveIslandTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    Promise.all([loadState().then(setAppState), loadIsland().then(setIsland)]).finally(() => setLoaded(true));
  }, []);

  // A drag paints many cells in a row; save once it settles, so overlapping
  // async writes can't land out of order and leave a stale island on disk.
  function handleIslandChange(next: IslandLayout) {
    if (next === island) return;
    setIsland(next);
    clearTimeout(saveIslandTimer.current);
    saveIslandTimer.current = setTimeout(() => void saveIsland(next), 400);
  }

  const visitingRef = useRef(visiting);
  visitingRef.current = visiting;
  // What the last answer held, so the next asks only for what's new since.
  const known = useRef<{ asked: number | undefined; step: number; segments: Map<string, Segment[]> } | null>(null);
  const refreshGarden = useCallback(async (token: string): Promise<void> => {
    const asked = visitingRef.current ?? undefined;
    const last = known.current?.asked === asked ? known.current : null;
    const { blobs: sent, now, rate, region, home, regions: list, size, step, delta } = await getGarden(token, asked, last?.step);
    // The player moved on to another island while this one was loading.
    if ((visitingRef.current ?? undefined) !== asked) return;
    let blobs = sent;
    if (delta && last) {
      // Someone new (born, joined, back from hiding): the timeline they've
      // already lived isn't in an answer about what's new, so ask for all.
      if (sent.some((b) => !last.segments.has(b.seed))) {
        known.current = null;
        return refreshGarden(token);
      }
      blobs = sent.map((b) => ({ ...b, segments: [...last.segments.get(b.seed)!.filter((s) => s.end > now - SEGMENT_HISTORY_MS), ...b.segments] }));
    }
    known.current = { asked, step, segments: new Map(blobs.map((b) => [b.seed, b.segments])) };
    setBlobs(blobs);
    setRegions({ region, home, list, size });
    setGardenClock({ at: now, readAt: Date.now(), rate: rate ?? 1 });
  }, []);

  // Catch the private blob up on the time the app was closed, and notify
  // about the notable bits, once per session — whether or not an account exists yet.
  useEffect(() => {
    if (!appState) return;
    const now = Date.now();
    const { life, lived } = advanceLife(appState.localSeed, appState.life, now);
    const entries = notable(lived.filter((s) => s.start > appState.lastOpenedAt && s.start <= now));
    if (entries.length > 0) {
      void (async () => {
        const granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
        if (!granted) return;
        for (const entry of entries) sendNotification({ title: appState.localPseudo, body: entry.text });
      })();
    }
    const next = { ...appState, life, lastOpenedAt: now };
    setAppState(next);
    void saveState(next);
    // Deliberately keyed on localSeed, not on every appState change, so this
    // runs once per app-start rather than on each ping refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState?.localSeed]);

  // Keep living while the app is open: the timeline stays a little ahead of now.
  useEffect(() => {
    if (!appState?.localSeed) return;
    const id = setInterval(() => {
      setAppState((prev) => {
        if (!prev) return prev;
        const next = { ...prev, life: advanceLife(prev.localSeed, prev.life, Date.now()).life, lastOpenedAt: Date.now() };
        void saveState(next);
        return next;
      });
    }, LIFE_TICK_MS);
    return () => clearInterval(id);
  }, [appState?.localSeed]);

  const fast = gardenClock.rate > 1;
  // Presence ping + garden refresh while the app is active — only once an
  // account exists, since /garden and /me/ping both require a token.
  useEffect(() => {
    const token = appState?.account?.token;
    if (!token) return;
    // The API may still be starting: the next tick retries.
    refreshGarden(token).catch(() => {});
    const id = setInterval(() => {
      ping(token)
        .then(() => refreshGarden(token))
        .catch(() => {});
    }, fast ? FAST_GARDEN_REFRESH_MS : PING_INTERVAL_MS);
    return () => clearInterval(id);
  }, [appState?.account?.token, refreshGarden, fast, visiting]);

  function handlePseudoChosen(pseudo: string, identity: Identity) {
    const now = Date.now();
    const state: AppState = {
      localPseudo: pseudo,
      localSeed: normalizeSeed(pseudo),
      createdAt: now,
      lastOpenedAt: now,
      settings: { visible: true },
      account: null,
      life: newLife(identity, now),
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

  // One identity for both: the private blob and its garden sprout.
  async function handleCountryChange(country: string | null) {
    const account = appState?.account;
    if (!account) return;
    await setCountry(account.token, country);
    setBlobs((list) => list.map((b) => (b.seed === account.seed ? { ...b, country } : b)));
  }

  async function handleIdentityChange(identity: Identity) {
    if (!appState) return;
    const { account } = appState;
    if (account) {
      await setIdentity(account.token, identity);
      // The garden list only refreshes with the next ping: show the change now.
      setBlobs((list) => list.map((b) => (b.seed === account.seed ? { ...b, ...identity } : b)));
    }
    const next = { ...appState, life: { ...appState.life, identity } };
    setAppState(next);
    void saveState(next);
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
    return (
      <JoinGardenScreen
        localPseudo={appState.localPseudo}
        identity={appState.life.identity}
        onJoined={handleJoined}
        onCancel={() => setJoining(false)}
      />
    );
  }

  return (
    <GardenScreen
      localPseudo={appState.localPseudo}
      localSeed={appState.localSeed}
      life={appState.life}
      onIdentityChange={handleIdentityChange}
      onCountryChange={handleCountryChange}
      account={appState.account}
      blobs={blobs}
      regions={regions}
      onVisit={(region) => setVisiting(region === regions?.home ? null : region)}
      gardenClock={gardenClock}
      visible={appState.settings.visible}
      onToggleVisibility={handleToggleVisibility}
      onJoinGarden={() => setJoining(true)}
      island={island}
      onIslandChange={handleIslandChange}
    />
  );
}
