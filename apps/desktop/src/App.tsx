import { notable, type Gait, type Identity, type Personality, type Segment, type Spell } from "@blob-land/sim";
import { normalizeSeed } from "blobatar";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useCallback, useEffect, useRef, useState } from "react";
import { GardenScreen } from "@/components/garden-screen";
import { JoinGardenScreen } from "@/components/join-garden-screen";
import { MainMenu } from "@/components/main-menu";
import { PseudoScreen } from "@/components/pseudo-screen";
import { SettingsScreen } from "@/components/settings-screen";
import { isLanguage, journalLine, language, setLanguage, t, useT, type Language } from "@/i18n";
import {
  ApiError,
  deleteAccount,
  gardenTime,
  getGarden,
  getVisitor,
  resetGarden,
  setGardenSpeed,
  ping,
  setCountry,
  setIdentity,
  setGait,
  setPersonality,
  setVisibility,
  type AuthResponse,
  type GardenBlob,
  type GardenClock,
  type GardenRegion,
} from "@/lib/api";
import { defaultIsland, ISLAND_SIZE, loadIsland, saveIsland, type IslandLayout } from "@/lib/island";
import { advanceLife, farewell, newLife, welcome } from "@/lib/life";
import { useOnline } from "@/lib/online";
import { DEV, devNow, useKnobs } from "@/lib/dev";
import { loadState, resetState, saveState, type AppState } from "@/lib/state";

const PING_INTERVAL_MS = 60_000;
// A sped-up dev garden is lived only minutes ahead of now, in real time: refresh often.
// The server lives the garden this far ahead (the API's LOOKAHEAD): a refresh must land well within it, in garden time.
const GARDEN_LOOKAHEAD_MS = 30 * 60_000;
// Played timeline kept per blob, in garden time: what the API sends in a full answer.
const SEGMENT_HISTORY_MS = 15 * 60_000;
// How often the private blob's life is lived a bit further and saved.
const LIFE_TICK_MS = 60_000;
// Blobs the dev panel's reset seeds the garden with.
const DEV_SEED_BLOBS = 16;

export default function App() {
  const [appState, setAppState] = useState<AppState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [joining, setJoining] = useState(false);
  const { online, check: checkOnline } = useOnline();
  // Dev: the faster the clock, the more often the private blob lives on.
  const { speed } = useKnobs();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  // Redrawn in the language picked.
  useT();
  // Every start opens on the main menu; it says which scene to play.
  const [playing, setPlaying] = useState<"private" | "garden" | null>(null);
  const [blobs, setBlobs] = useState<GardenBlob[]>([]);
  const [gardenClock, setGardenClock] = useState<GardenClock>(() => ({ at: Date.now(), readAt: Date.now(), rate: 1 }));
  // Which region's island is on screen (null: the player's own), and what the server says about the regions.
  const [visiting, setVisiting] = useState<number | null>(null);
  const [regions, setRegions] = useState<{ region: number; home: number; list: GardenRegion[]; size: number; weather: Spell[] } | null>(null);
  const [island, setIsland] = useState<IslandLayout>(() => defaultIsland(ISLAND_SIZE));
  const saveIslandTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The player's country, as the garden last said: kept while visiting other islands.
  const ownCountry = useRef<string | null>(null);

  useEffect(() => {
    Promise.all([
      loadState().then((state) => {
        if (isLanguage(state?.settings.language)) setLanguage(state.settings.language);
        setAppState(state);
      }),
      loadIsland().then(setIsland),
    ]).finally(() => setLoaded(true));
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
    const { blobs: sent, now, rate, region, home, regions: list, size, step, delta, weather } = await getGarden(token, asked, last?.step);
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
      // The garden's clock leapt (the dev panel changed its speed): what we kept is stale and the delta can't fill the gap, so ask for it all rather than leave blobs without a timeline.
      if (blobs.some((b) => b.segments.length === 0)) {
        known.current = null;
        return refreshGarden(token);
      }
    }
    known.current = { asked, step, segments: new Map(blobs.map((b) => [b.seed, b.segments])) };
    setBlobs(blobs);
    setRegions({ region, home, list, size, weather });
    // Kept running as is unless it drifted: re-anchoring on every answer would
    // move the whole garden by the request's latency (times the rate, in dev).
    const fresh = { at: now, readAt: Date.now(), rate: rate ?? 1 };
    setGardenClock((prev) => (prev.rate === fresh.rate && Math.abs(gardenTime(prev) - now) < 1000 * fresh.rate ? prev : fresh));
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
        for (const entry of entries) sendNotification({ title: appState.localPseudo, body: journalLine(entry, (seed) => life.met?.[seed]?.name ?? seed) });
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
        const next = { ...prev, life: advanceLife(prev.localSeed, prev.life, devNow()).life, lastOpenedAt: Date.now() };
        void saveState(next);
        return next;
      });
    }, Math.max(1000, LIFE_TICK_MS / Math.max(1, speed)));
    return () => clearInterval(id);
  }, [appState?.localSeed, speed]);

  // Real time between refreshes: a minute, or at a faster rate a third of the lookahead (1 to 10 s).
  const rate = gardenClock.rate;
  const refreshEvery = rate > 1 ? Math.min(10_000, Math.max(1_000, GARDEN_LOOKAHEAD_MS / (3 * rate))) : PING_INTERVAL_MS;
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
    }, refreshEvery);
    // A hidden window's timers are throttled: catch up the moment it's back.
    const back = () => document.visibilityState === "visible" && refreshGarden(token).catch(() => {});
    document.addEventListener("visibilitychange", back);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", back);
    };
  }, [appState?.account?.token, refreshGarden, refreshEvery, visiting]);

  // A player's blob comes to stay on the private island; no one is told.
  async function handleInvite(name: string) {
    const token = appState?.account?.token;
    if (!token) return;
    const visitor = await getVisitor(token, name);
    // A pseudo taken from the private blob: it can't visit itself.
    if (visitor.seed === appState.localSeed) throw new ApiError(t().errors["no player goes by that pseudo"]!);
    setAppState((prev) => {
      if (!prev) return prev;
      const now = devNow();
      const next = { ...prev, life: advanceLife(prev.localSeed, welcome(prev.localSeed, prev.life, visitor, now), now).life };
      void saveState(next);
      return next;
    });
  }

  function handleFarewell() {
    setAppState((prev) => {
      if (!prev) return prev;
      const now = devNow();
      const next = { ...prev, life: advanceLife(prev.localSeed, farewell(prev.life, now), now).life };
      void saveState(next);
      return next;
    });
  }

  // Dev panel: the server runs the garden faster, then the answers follow at once.
  async function handleGardenSpeed(scale: number) {
    const token = appState?.account?.token;
    if (!token) return;
    const { now, rate } = await setGardenSpeed(scale);
    setGardenClock({ at: now, readAt: Date.now(), rate });
    known.current = null;
    await refreshGarden(token);
  }

  // Dev panel: back to a first start, on a freshly seeded garden.
  async function handleReset() {
    await resetGarden(DEV_SEED_BLOBS);
    await Promise.all([resetState(), saveIsland(defaultIsland(ISLAND_SIZE))]);
    window.location.reload();
  }

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
    // Joined to be there: straight to the garden, not back to where it was asked from.
    setPlaying("garden");
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

  async function handlePersonalityChange(personality: Personality) {
    if (!appState) return;
    const { account } = appState;
    if (account) {
      await setPersonality(account.token, personality);
      setBlobs((list) => list.map((b) => (b.seed === account.seed ? { ...b, personality } : b)));
    }
    const next = { ...appState, life: { ...appState.life, personality } };
    setAppState(next);
    void saveState(next);
  }

  async function handleGaitChange(gait: Gait | null) {
    if (!appState) return;
    const { account } = appState;
    if (account) {
      await setGait(account.token, gait);
      setBlobs((list) => list.map((b) => (b.seed === account.seed ? { ...b, gait } : b)));
    }
    const next = { ...appState, life: { ...appState.life, gait: gait ?? undefined } };
    setAppState(next);
    void saveState(next);
  }

  async function handleVisibleChange(visible: boolean) {
    if (!appState?.account) return;
    await setVisibility(appState.account.token, visible);
    const next = { ...appState, settings: { ...appState.settings, visible } };
    setAppState(next);
    void saveState(next);
  }

  // Gone from the garden for good; the private island stays.
  async function handleDeleteAccount(password: string) {
    if (!appState?.account) return;
    await deleteAccount(appState.account.token, password);
    const next: AppState = { ...appState, account: null, settings: { ...appState.settings, visible: true } };
    setAppState(next);
    void saveState(next);
    setBlobs([]);
    setRegions(null);
    setVisiting(null);
    known.current = null;
    setSettingsOpen(false);
  }

  function handleLanguageChange(next: Language) {
    setLanguage(next);
    if (!appState) return;
    const state = { ...appState, settings: { ...appState.settings, language: next } };
    setAppState(state);
    void saveState(state);
  }

  if (!loaded) return null;
  if (!appState) return <PseudoScreen onChosen={handlePseudoChosen} />;
  if (joining) {
    return (
      <JoinGardenScreen
        online={online}
        onRetry={checkOnline}
        localPseudo={appState.localPseudo}
        identity={appState.life.identity}
        personality={appState.life.personality}
        gait={appState.life.gait}
        onJoined={handleJoined}
        onCancel={() => setJoining(false)}
      />
    );
  }

  // The player's garden blob, when its island is the one loaded: its country, and its other half.
  const mine = appState.account ? blobs.find((b) => b.seed === appState.account!.seed) : undefined;
  if (mine) ownCountry.current = mine.country;
  const partner = mine?.partner ? blobs.find((b) => b.seed === mine.partner) : undefined;
  const settings = settingsOpen ? (
    <SettingsScreen
      seed={appState.localSeed}
      name={appState.localPseudo}
      identity={appState.life.identity}
      onIdentityChange={handleIdentityChange}
      personality={appState.life.personality}
      onPersonalityChange={handlePersonalityChange}
      gait={appState.life.gait ?? null}
      onGaitChange={handleGaitChange}
      partner={partner ? { name: partner.pseudo ?? "", identity: partner } : null}
      account={appState.account}
      onJoin={() => {
        setSettingsOpen(false);
        setJoining(true);
      }}
      country={ownCountry.current}
      onCountryChange={handleCountryChange}
      visible={appState.settings.visible}
      onVisibleChange={handleVisibleChange}
      onDeleteAccount={handleDeleteAccount}
      language={language()}
      onLanguageChange={handleLanguageChange}
      onClose={closeSettings}
    />
  ) : null;

  if (!playing) {
    return (
      <>
        <MainMenu
          seed={appState.localSeed}
          name={appState.localPseudo}
          inGarden={appState.account !== null}
          online={online}
          onPlay={() => setPlaying("private")}
          onGarden={() => setPlaying("garden")}
          onJoin={() => setJoining(true)}
          onSettings={() => setSettingsOpen(true)}
        />
        {settings}
      </>
    );
  }

  return (
    <>
      <GardenScreen
        initialView={playing}
        onMainMenu={() => setPlaying(null)}
        online={online}
        onRetryOnline={checkOnline}
        localPseudo={appState.localPseudo}
        localSeed={appState.localSeed}
        life={appState.life}
        account={appState.account}
        blobs={blobs}
        regions={regions}
        onVisit={(region) => setVisiting(region === regions?.home ? null : region)}
        gardenClock={gardenClock}
        onGardenSpeed={DEV ? handleGardenSpeed : undefined}
        onReset={DEV ? handleReset : undefined}
        onJoinGarden={() => setJoining(true)}
        onInvite={handleInvite}
        onFarewell={handleFarewell}
        onSettings={() => setSettingsOpen(true)}
        island={island}
        onIslandChange={handleIslandChange}
      />
      {settings}
    </>
  );
}
