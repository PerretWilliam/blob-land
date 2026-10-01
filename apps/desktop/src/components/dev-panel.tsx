import { ChevronDown, ChevronUp, FlaskConical } from "lucide-react";
import { useEffect, useState } from "react";
import type { GardenBlob } from "@/lib/api";
import { resetKnobs, setKnobs, useKnobs } from "@/lib/dev";

const SPEEDS = [0, 0.25, 1, 5, 20, 100];

// The garden's clock is the server's: it runs ahead there (the API needs DEV_TOOLS=1), and can't go back.
const GARDEN_SPEEDS = [1, 5, 20, 100];

/**
 * Dev only (mounted under `DEV`, never shipped): live knobs for the scenes. Not
 * translated, since no player sees it. In the garden, `garden` says its speed
 * and asks the server to change it; the private island's runs on this clock.
 */
export function DevPanel({ time, garden, onReset }: { time: () => number; garden?: { rate: number; set?: (scale: number) => Promise<void>; blobs: GardenBlob[] }; onReset?: () => Promise<void> }) {
  const knobs = useKnobs();
  const [open, setOpen] = useState(true);
  const [shown, setShown] = useState(time);
  const [failed, setFailed] = useState(false);
  const speeds = garden ? GARDEN_SPEEDS : SPEEDS;
  const speed = garden ? garden.rate : knobs.speed;
  const pick = (s: number) => {
    if (!garden) return setKnobs({ speed: s });
    setFailed(false);
    garden.set?.(s).catch(() => setFailed(true));
  };
  useEffect(() => {
    const id = setInterval(() => setShown(time()), 250);
    return () => clearInterval(id);
  }, [time]);

  return (
    <aside className="toon absolute bottom-4 left-4 z-20 w-60 p-2 text-sm">
      <button type="button" className="flex w-full items-center gap-1.5 font-semibold" onClick={() => setOpen((o) => !o)}>
        <FlaskConical className="size-4" /> Dev
        <span className="ml-auto font-normal tabular-nums">{new Date(shown).toISOString().slice(11, 19)} UTC</span>
        {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <div>
            Time speed
            <div className="mt-1 flex flex-wrap gap-1">
              {speeds.map((s) => (
                <button key={s} type="button" aria-pressed={speed === s} className="toon-input px-2 py-0.5 aria-pressed:font-bold aria-pressed:ring-2" onClick={() => pick(s)}>
                  {s === 0 ? "⏸" : `${s}x`}
                </button>
              ))}
            </div>
            {failed && <p className="mt-1 text-xs">The API refused: DEV_TOOLS=1 in apps/api/.env?</p>}
          </div>
          {garden && <Timeline blobs={garden.blobs} now={shown} />}
          <label className="flex flex-col">
            <span className="flex justify-between">
              Sky <button type="button" className="underline" onClick={() => setKnobs({ sky: null })}>{knobs.sky === null ? "auto" : "reset"}</button>
            </span>
            <input type="range" min={0} max={1} step={0.05} value={knobs.sky ?? 1} onChange={(e) => setKnobs({ sky: Number(e.target.value) })} />
          </label>
          <label className="flex flex-col">
            Blob size {knobs.blobSize.toFixed(2)}x
            <input type="range" min={0.5} max={2.5} step={0.05} value={knobs.blobSize} onChange={(e) => setKnobs({ blobSize: Number(e.target.value) })} />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={knobs.reducedMotion} onChange={(e) => setKnobs({ reducedMotion: e.target.checked })} /> Reduced motion
          </label>
          <button type="button" className="underline self-start" onClick={resetKnobs}>
            Reset knobs
          </button>
          {onReset && (
            <button
              type="button"
              className="toon-input px-2 py-0.5 font-semibold"
              onClick={() => {
                if (!window.confirm("Wipe the garden's database and this device's blob and island, then seed a new garden?")) return;
                setFailed(false);
                onReset().catch(() => setFailed(true));
              }}
            >
              Reset everything
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

/** What the garden's timelines hold against the clock: where a stall shows (blobs out of timeline, or with none). */
function Timeline({ blobs, now }: { blobs: GardenBlob[]; now: number }) {
  const ends = blobs.map((b) => b.segments[b.segments.length - 1]?.end ?? -Infinity);
  const none = blobs.filter((b) => b.segments.length === 0).length;
  const out = ends.filter((e) => e < now).length;
  const ahead = Math.round((Math.min(...ends) - now) / 60_000);
  return (
    <p className="text-xs tabular-nums">
      {blobs.length} blobs · {none} without timeline · {out} past its end · least ahead {isFinite(ahead) ? `${ahead} min` : "n/a"}
    </p>
  );
}
