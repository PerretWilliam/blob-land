import { useEffect, useState } from "react";
import type { IslandLayout } from "./island";

// Islands already laid out, by region and size: the same for everyone, so never twice.
const laidOut = new Map<string, Promise<IslandLayout>>();

/**
 * Region `region`'s garden island of side `size`, laid out in a worker: a big one takes a
 * few hundred milliseconds of heavy arithmetic, which would freeze the page,
 * and the webview's engine keeps the memory that took long after it's done.
 * A worker's goes when it closes. Until it's ready, the last island shown
 * (or null, the first time).
 */
export function useGardenIsland(size: number | null, region = 0): IslandLayout | null {
  const [island, setIsland] = useState<IslandLayout | null>(null);
  useEffect(() => {
    if (size === null) return;
    let cancelled = false;
    const key = `${region}:${size}`;
    let job = laidOut.get(key);
    if (!job) {
      job = new Promise<IslandLayout>((resolve, reject) => {
        const worker = new Worker(new URL("./world-gen.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (e: MessageEvent<IslandLayout>) => {
          resolve(e.data);
          worker.terminate();
        };
        worker.onerror = (e) => {
          reject(new Error(e.message));
          worker.terminate();
        };
        worker.postMessage({ size, region });
      });
      job.catch(() => laidOut.delete(key));
      laidOut.set(key, job);
    }
    job.then(
      (layout) => !cancelled && setIsland(layout),
      (error: unknown) => console.error("The garden island couldn't be laid out", error),
    );
    return () => {
      cancelled = true;
    };
  }, [size, region]);
  return island;
}
