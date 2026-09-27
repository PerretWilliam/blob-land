import { useCallback, useEffect, useState } from "react";
import { reachable } from "@/lib/api";

// How often to look again while it's out of reach, and while it's fine.
const RETRY_MS = 15_000;
const RECHECK_MS = 60_000;

/**
 * Whether the garden's server can be reached: assumed so until a check says
 * otherwise, so nothing flashes "offline" on start. Looked at again now and
 * then, and whenever the system says the network came or went; `check` looks
 * right away (a Retry button).
 */
export function useOnline(): { online: boolean; check: () => Promise<boolean> } {
  const [online, setOnline] = useState(true);
  const check = useCallback(async () => {
    const ok = navigator.onLine && (await reachable());
    setOnline(ok);
    return ok;
  }, []);
  useEffect(() => {
    void check();
    const id = setInterval(() => void check(), online ? RECHECK_MS : RETRY_MS);
    const now = () => void check();
    window.addEventListener("online", now);
    window.addEventListener("offline", now);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", now);
      window.removeEventListener("offline", now);
    };
  }, [check, online]);
  return { online, check };
}
