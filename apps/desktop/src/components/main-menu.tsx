import { Blobatar } from "@blobatar/react";
import { Play, Trees, UserPlus, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import cloudLarge from "@/assets/iso/cloud-large.png";
import cloudSmall from "@/assets/iso/cloud-small.png";
import island from "@/assets/menu-island.png";
import { Button } from "@/components/ui/button";

// The two blobs under yours, as on the app's icon (scripts/brand.mjs).
const STACK = ["mochi", "land"];

// Clouds drifting across the sky, above and below the title: where they fly
// (% of the height), how big (% of the width), how slow (s).
const CLOUDS = [
  { src: cloudLarge, top: 3, width: 22, duration: 95, delay: -30 },
  { src: cloudSmall, top: 12, width: 13, duration: 70, delay: -55 },
  { src: cloudLarge, top: 80, width: 18, duration: 120, delay: -90 },
  { src: cloudSmall, top: 88, width: 11, duration: 80, delay: -10 },
];

/**
 * The menus' world: a sky with clouds drifting by, and the little floating
 * island with three blobs stacked on it, `seed` on top. `children` sit next to
 * it, under the title.
 */
export function MenuScreen({ seed, children }: { seed: string; children: ReactNode }) {
  return (
    <main className="menu-sky fixed inset-0 overflow-hidden select-none">
      {CLOUDS.map((c, i) => (
        <img
          key={i}
          src={c.src}
          alt=""
          className="menu-cloud pointer-events-none absolute left-0 opacity-90"
          style={{ top: `${c.top}%`, width: `${c.width}vw`, animationDuration: `${c.duration}s`, animationDelay: `${c.delay}s` }}
        />
      ))}
      {/* m-auto, not justify-center: centred, yet still scrolls from the top when too tall. */}
      <div className="relative flex h-full overflow-y-auto p-6 md:px-10">
        <div className="m-auto flex w-full max-w-4xl flex-col items-center gap-4 md:flex-row md:justify-center">
          <div className="flex w-full max-w-sm shrink-0 flex-col items-center gap-5 md:items-start">
            <h1 className="toon-title text-6xl md:text-7xl">Blob Land</h1>
            {children}
          </div>
          <Island seed={seed} />
        </div>
      </div>
    </main>
  );
}

function Island({ seed }: { seed: string }) {
  const stack = [...STACK, seed || "blob"];
  return (
    // Sized off its own width (cqw), so the blobs keep to the island at any size.
    <div
      className="menu-float @container relative order-first w-full max-w-60 shrink md:order-none md:max-w-md [@media(max-height:520px)]:max-md:hidden"
      aria-hidden="true"
    >
      <img src={island} alt="" className="w-full" draggable={false} />
      {/* Feet on the middle of the island; each blob sits a little into the one below. */}
      <div className="absolute bottom-[calc(38%-8cqw)] left-1/2 flex -translate-x-1/2 flex-col-reverse items-center">
        {stack.map((name, i) => (
          <div
            key={`${i}-${name}`}
            className="menu-hop toon-outline"
            style={{ width: `${[46, 39, 34][i]}cqw`, marginBottom: `-${[0, 15.7, 13.6][i]}cqw`, animationDelay: `${i * 0.18}s` }}
          >
            <Blobatar name={name} animate="always" className="block size-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The main menu: into your island, into the garden, or join it. */
export function MainMenu({
  seed,
  name,
  inGarden,
  online,
  onPlay,
  onGarden,
  onJoin,
}: {
  seed: string;
  name: string;
  inGarden: boolean;
  /** Whether the garden's server can be reached: the garden needs it, your island doesn't. */
  online: boolean;
  onPlay: () => void;
  onGarden: () => void;
  onJoin: () => void;
}) {
  return (
    <MenuScreen seed={seed}>
      <p className="text-center text-lg font-medium text-ink/80 md:text-left">
        Hi, <span className="font-bold text-ink">{name}</span>!
      </p>
      <nav aria-label="Main menu" className="flex w-full max-w-72 flex-col gap-3">
        <Button size="lg" onClick={onPlay} autoFocus>
          <Play className="fill-current" /> My island
        </Button>
        {inGarden ? (
          <Button size="lg" variant="secondary" onClick={onGarden} disabled={!online}>
            <Trees /> The garden
          </Button>
        ) : (
          <Button size="lg" variant="secondary" onClick={onJoin} disabled={!online}>
            <UserPlus /> Join the garden
          </Button>
        )}
        {!online ? (
          <p className="flex items-start gap-2 rounded-xl border-2 border-ink bg-card px-3 py-2 text-sm font-medium" role="status">
            <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            No connection: the garden needs the internet. Your own island keeps living offline.
          </p>
        ) : null}
      </nav>
    </MenuScreen>
  );
}
