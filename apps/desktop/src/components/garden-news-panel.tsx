import { Blobatar } from "@blobatar/react";
import { Baby, Heart, HeartCrack, type LucideIcon, Newspaper, Swords, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getGardenJournal, type GardenEvent } from "@/lib/api";

// Often enough to feel live; a sped-up dev garden changes faster, but this is news, not a feed.
const REFRESH_MS = 20_000;

const STYLE: Record<GardenEvent["kind"], { icon: LucideIcon; row: string; badge: string; text: (e: Names) => string }> = {
  couple: { icon: Heart, row: "border-rose-400 bg-rose-500/10", badge: "bg-rose-500 text-white", text: ({ a, b }) => `${a} and ${b} are a couple!` },
  birth: { icon: Baby, row: "border-violet-400 bg-violet-500/10", badge: "bg-violet-500 text-white", text: ({ a, b, c }) => `${a} and ${b} welcomed ${c}.` },
  breakup: { icon: HeartCrack, row: "border-stone-400 bg-stone-500/10", badge: "bg-stone-500 text-white", text: ({ a, b }) => `${a} and ${b} broke up.` },
  fight: { icon: Swords, row: "border-red-500 bg-red-600/10", badge: "bg-red-600 text-white", text: ({ a, b }) => `${a} and ${b} had a big fight.` },
};
type Names = { a: string; b: string; c: string };

const ago = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function since(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return ago.format(-min, "minute");
  const h = Math.round(min / 60);
  return h < 48 ? ago.format(-h, "hour") : ago.format(-Math.round(h / 24), "day");
}

/** What's been happening in the garden: couples, breakups, births and big fights. */
export function GardenNewsPanel({ token, onClose }: { token: string; onClose: () => void }) {
  const [news, setNews] = useState<{ now: number; events: GardenEvent[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      getGardenJournal(token).then(
        (r) => live && (setNews(r), setError(null)),
        (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
      );
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [token]);

  return (
    <aside
      aria-label="Garden news"
      className="absolute top-4 right-4 z-10 flex max-h-[calc(100%-2rem)] w-80 flex-col toon"
    >
      <header className="flex items-center gap-2 rounded-t-[1rem] border-b-[3px] border-ink px-3 py-2 bg-sun">
        <Newspaper className="size-4" />
        <h2 className="flex-1 text-base font-bold">Garden news</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close garden news" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="overflow-y-auto p-2" aria-live="polite">
        {error && !news ? (
          <p className="p-1 text-sm text-destructive" role="alert">
            Couldn't load the news: {error}
          </p>
        ) : !news ? (
          <p className="p-1 text-sm text-muted-foreground">Loading…</p>
        ) : news.events.length === 0 ? (
          <p className="p-1 text-sm text-muted-foreground">Nothing big yet. Give the garden a little time.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {news.events.map((e) => {
              const style = STYLE[e.kind];
              const Icon = style.icon;
              const names = { a: e.aName ?? "a blob", b: e.bName ?? "a blob", c: e.cName ?? "a little one" };
              return (
                <li key={`${e.kind}-${e.a}-${e.b}-${e.at}`} className={`flex items-center gap-3 rounded-lg border-l-4 p-2 ${style.row}`}>
                  <span className="relative flex shrink-0">
                    <Blobatar name={e.a} size={32} />
                    <Blobatar name={e.kind === "birth" && e.c ? e.c : e.b} size={32} className="-ml-3" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm">{style.text(names)}</span>
                    <span className="text-[11px] text-muted-foreground">{since(news.now - e.at)}</span>
                  </span>
                  <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${style.badge}`}>
                    <Icon className="size-3.5" aria-hidden="true" />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
