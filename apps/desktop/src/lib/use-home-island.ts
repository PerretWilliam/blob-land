import type { Spell } from "@blob-land/sim";
import { useCallback, useEffect, useRef, useState } from "react";
import { closeIsland, getIsland, openIsland, type GardenBlob } from "@/lib/api";

export interface HomeIsland {
  blobs: GardenBlob[];
  weather: Spell[];
  /** When each visitor goes home. */
  stays: Map<string, number>;
}

// Opening and closing go out one after the other, so a quick close-and-open
// (leaving the island and coming straight back) reaches the server in order.
let queue: Promise<unknown> = Promise.resolve();
const inOrder = <T>(call: () => Promise<T>): Promise<T> => {
  const next = queue.then(call, call);
  queue = next.catch(() => {});
  return next;
};

/**
 * The player's island on the server while `active`: their blob comes home
 * from the garden (and its visitors live there too), and goes back when it
 * isn't any more. Read again every `every` ms; `refresh` reads it now.
 */
export function useHomeIsland(token: string | null, active: boolean, every: number): { island: HomeIsland | null; refresh: () => Promise<void> } {
  const [island, setIsland] = useState<HomeIsland | null>(null);
  const live = useRef(false);
  const refresh = useCallback(async () => {
    if (!token) return;
    const r = await getIsland(token);
    if (!live.current) return;
    setIsland(r.open ? { blobs: r.blobs, weather: r.weather, stays: new Map(r.stays.map((s) => [s.seed, s.until])) } : null);
  }, [token]);

  useEffect(() => {
    if (!token || !active) return;
    live.current = true;
    inOrder(() => openIsland(token)).then(refresh, () => {});
    // The app closing: everyone goes home now (else the server sends them after a few quiet minutes).
    const bye = () => void closeIsland(token).catch(() => {});
    window.addEventListener("beforeunload", bye);
    return () => {
      live.current = false;
      setIsland(null);
      window.removeEventListener("beforeunload", bye);
      void inOrder(() => closeIsland(token)).catch(() => {});
    };
  }, [token, active, refresh]);

  // Kept apart from opening, so a change of pace doesn't close the island.
  useEffect(() => {
    if (!token || !active) return;
    const id = setInterval(() => refresh().catch(() => {}), every);
    return () => clearInterval(id);
  }, [token, active, every, refresh]);

  return { island, refresh };
}
