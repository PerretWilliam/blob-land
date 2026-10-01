import { ChevronDown, ChevronUp, FlaskConical } from "lucide-react";
import { useEffect, useState } from "react";
import { resetKnobs, setKnobs, useKnobs } from "@/lib/dev";

const SPEEDS = [0, 0.25, 1, 5, 20, 100];

/**
 * Dev only (mounted under `DEV`, never shipped): live knobs for the scenes. Not
 * translated, since no player sees it. Past 1x the garden runs out of the
 * timeline the server sent: to run it ahead, set TIME_SCALE on the API.
 */
export function DevPanel({ time }: { time: () => number }) {
  const knobs = useKnobs();
  const [open, setOpen] = useState(true);
  const [shown, setShown] = useState(time);
  useEffect(() => {
    const id = setInterval(() => setShown(time()), 250);
    return () => clearInterval(id);
  }, [time]);

  return (
    <aside className="toon absolute right-4 bottom-4 z-20 w-60 p-2 text-sm">
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
              {SPEEDS.map((s) => (
                <button key={s} type="button" aria-pressed={knobs.speed === s} className="toon-input px-2 py-0.5 aria-pressed:font-bold aria-pressed:ring-2" onClick={() => setKnobs({ speed: s })}>
                  {s === 0 ? "⏸" : `${s}x`}
                </button>
              ))}
            </div>
          </div>
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
            Reset
          </button>
        </div>
      )}
    </aside>
  );
}
