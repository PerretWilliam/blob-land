import type { InteractionKind } from "@blob-land/sim";
import { Blobatar } from "@blobatar/react";
import { Images, X } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState, LoadFailed } from "@/components/empty-state";
import { MomentArt } from "@/components/interaction-fx";
import { Button } from "@/components/ui/button";
import { language, useT } from "@/i18n";
import { getAlbum, type Milestone } from "@/lib/api";

// The picture on each card: a first is drawn as itself, the rest as the moment that best says it.
const PICTURE: Record<Exclude<Milestone["kind"], "first">, InteractionKind> = {
  friends: "high_five",
  best_friends: "piggyback",
  crush: "flirt",
  couple: "kiss",
  child: "group_hug",
  made_up: "make_up",
};

/** One big moment: who was there, its picture, what it was and when. */
function Card({ seed, milestone }: { seed: string; milestone: Milestone }) {
  const t = useT();
  const { kind, key, at, with: others } = milestone;
  const name = others[0]!.name;
  const caption =
    kind === "first" ? t.album.firsts[key]?.(name) : kind === "child" ? t.album.moments.child(name, others[1]?.name ?? "") : t.album.moments[kind](name);
  // A first the app doesn't know how to tell (a newer server): skipped rather than shown blank.
  if (!caption) return null;
  const date = new Intl.DateTimeFormat(language(), { dateStyle: "long" }).format(at);
  return (
    <li className="rounded-lg border-2 border-ink bg-white p-2">
      <div className="flex items-end justify-center gap-1" aria-hidden="true">
        <Blobatar name={seed} size={44} />
        <MomentArt kind={kind === "first" ? (key as InteractionKind) : PICTURE[kind]} className="size-14 shrink-0" />
        {others.map((o, i) => (
          <Blobatar key={o.seed} name={o.seed} size={kind === "child" && i === 1 ? 30 : 44} />
        ))}
      </div>
      <p className="mt-1 text-center text-sm font-medium">{caption}</p>
      <p className="text-center text-xs text-muted-foreground">{date}</p>
    </li>
  );
}

/** The player's blob's album: its first friend, its couples and children, its firsts. From the garden, for now. */
export function AlbumPanel({ seed, token, onClose }: { seed: string | null; token: string | null; onClose: () => void }) {
  const t = useT();
  const [album, setAlbum] = useState<Milestone[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  // Bumped by "Try again".
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!token) return;
    let live = true;
    setError(null);
    getAlbum(token).then(
      (r) => live && setAlbum(r.milestones),
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [token, attempt]);

  return (
    <aside aria-label={t.album.title} className="absolute top-4 right-4 z-10 flex max-h-[calc(100%-2rem)] w-80 flex-col toon">
      <header className="flex items-center gap-2 rounded-t-[1rem] border-b-[3px] border-ink bg-grass px-3 py-2">
        <Images className="size-4" />
        <h2 className="flex-1 truncate text-base font-bold">{t.album.title}</h2>
        <Button variant="ghost" size="icon-sm" aria-label={t.album.close} onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="overflow-y-auto p-2">
        {!seed || !token ? (
          <EmptyState face="sleepy" title={t.album.noGarden}>
            {t.album.noGardenText}
          </EmptyState>
        ) : error ? (
          <LoadFailed error={error} title={t.album.failed} offline={t.album.offline} onRetry={() => setAttempt((n) => n + 1)} />
        ) : !album ? (
          <p className="p-1 text-sm text-muted-foreground" aria-live="polite">
            {t.common.loading}
          </p>
        ) : album.length === 0 ? (
          <EmptyState face="thinking" seed={seed} title={t.album.noneYet}>
            {t.album.noneYetText}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {album.map((m) => (
              <Card key={`${m.kind}|${m.key}`} seed={seed} milestone={m} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
