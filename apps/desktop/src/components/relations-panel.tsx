import { STATUSES, type RelationStatus } from "@blob-land/sim";
import { Blobatar } from "@blobatar/react";
import { Hand, Heart, HeartCrack, HeartHandshake, House, type LucideIcon, Smile, Sparkles, Star, Swords, UserRound, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getRelationships, type Relation } from "@/lib/api";

/** How each status looks: its own colour, icon and words. Full class names, so Tailwind sees them. */
const STYLE: Record<RelationStatus, { label: string; icon: LucideIcon; badge: string; row: string }> = {
  lovers: { label: "In love", icon: Heart, badge: "bg-rose-500 text-white", row: "border-rose-400 bg-rose-500/10" },
  crush: { label: "Crush", icon: Sparkles, badge: "bg-pink-400 text-white", row: "border-pink-300 bg-pink-400/10" },
  best_friends: { label: "Best friends", icon: Star, badge: "bg-amber-400 text-amber-950", row: "border-amber-300 bg-amber-400/10" },
  friends: { label: "Friends", icon: Smile, badge: "bg-emerald-500 text-white", row: "border-emerald-400 bg-emerald-500/10" },
  family: { label: "Family", icon: House, badge: "bg-violet-500 text-white", row: "border-violet-400 bg-violet-500/10" },
  acquaintances: { label: "Acquaintances", icon: Hand, badge: "bg-sky-500 text-white", row: "border-sky-300 bg-sky-500/10" },
  strangers: { label: "Strangers", icon: UserRound, badge: "bg-slate-400 text-white", row: "border-slate-300 bg-slate-400/10" },
  complicated: { label: "It's complicated", icon: Zap, badge: "bg-orange-500 text-white", row: "border-orange-400 bg-orange-500/10" },
  rivals: { label: "Rivals", icon: Swords, badge: "bg-red-600 text-white", row: "border-red-500 bg-red-600/10" },
  ex: { label: "Ex", icon: HeartCrack, badge: "bg-stone-500 text-white", row: "border-stone-400 bg-stone-500/10" },
};

// Warmest first: love and friendship at the top, feuds at the bottom.
const ORDER: RelationStatus[] = ["lovers", "crush", "best_friends", "family", "friends", "complicated", "acquaintances", "strangers", "ex", "rivals"];
const rank = (r: Relation) => ORDER.indexOf(r.status) * 1000 - (r.friendship + r.romance - r.tension);

const KIN = { parent: "Parent or child", sibling: "Sibling" } as const;

function Gauge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span className="flex items-center gap-1.5" title={`${label}: ${Math.round(value)} / 100`}>
      <span className="w-12 text-[10px] text-muted-foreground">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </span>
    </span>
  );
}

function RelationRow({ relation, onOpen }: { relation: Relation; onOpen: (seed: string, name: string) => void }) {
  const style = STYLE[relation.status];
  const Icon = style.icon;
  const name = relation.name ?? "A garden sprout";
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(relation.seed, name)}
        aria-label={`${name}: ${style.label}. See their relations`}
        className={`flex w-full items-center gap-3 rounded-lg border-l-4 p-2 text-left transition-[filter] hover:brightness-95 ${style.row}`}
      >
        <Blobatar name={relation.seed} size={48} className="shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{name}</span>
            <span className={`ml-auto flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${style.badge}`}>
              <Icon className="size-3" aria-hidden="true" />
              {relation.kin ? KIN[relation.kin] : style.label}
            </span>
          </span>
          <Gauge label="Friends" value={relation.friendship} color="bg-emerald-500" />
          <Gauge label="Love" value={relation.romance} color="bg-rose-500" />
          <Gauge label="Tension" value={relation.tension} color="bg-orange-500" />
        </span>
      </button>
    </li>
  );
}

/**
 * Everyone a blob has met, and how they get on — warmest first, each status
 * in its own colour. Any blob in the list opens its own relations.
 */
export function RelationsPanel({ seed, onClose }: { seed: string | null; onClose: () => void }) {
  const [root, setRoot] = useState<{ seed: string; name: string } | null>(seed ? { seed, name: "" } : null);
  const [result, setResult] = useState<{ seed: string; relations?: Relation[]; error?: string } | null>(null);
  useEffect(() => {
    if (!root) return;
    let live = true;
    getRelationships(root.seed).then(
      ({ relationships }) => live && setResult({ seed: root.seed, relations: [...relationships].sort((a, b) => rank(a) - rank(b)) }),
      (e: unknown) => live && setResult({ seed: root.seed, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [root]);
  const current = result?.seed === root?.seed ? result : null;
  const mine = root?.seed === seed;
  const counts = new Map<RelationStatus, number>();
  for (const r of current?.relations ?? []) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);

  return (
    <aside
      aria-label="Relations"
      className="absolute top-4 right-4 z-10 flex max-h-[calc(100%-2rem)] w-80 flex-col rounded-xl border bg-background/85 shadow-lg backdrop-blur-md"
    >
      <header className="flex items-center gap-2 border-b p-3">
        <HeartHandshake className="size-4" />
        <h2 className="flex-1 truncate text-sm font-semibold">{mine || !root ? "Relations" : `${root.name}'s relations`}</h2>
        {!mine && seed ? (
          <Button variant="ghost" size="sm" onClick={() => setRoot({ seed, name: "" })}>
            Back to mine
          </Button>
        ) : null}
        <Button variant="ghost" size="icon-sm" aria-label="Close relations" onClick={onClose}>
          <X />
        </Button>
      </header>
      {counts.size > 0 ? (
        <p className="flex flex-wrap gap-1 border-b px-3 py-2" aria-label="Summary">
          {STATUSES.filter((s) => counts.has(s))
            .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
            .map((s) => (
              <span key={s} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STYLE[s].badge}`}>
                {counts.get(s)} {STYLE[s].label.toLowerCase()}
              </span>
            ))}
        </p>
      ) : null}
      <div className="overflow-y-auto p-2">
        {!seed ? (
          <p className="p-1 text-sm text-muted-foreground">Relations grow in the garden: join it, and your blob will start meeting others.</p>
        ) : current?.relations ? (
          current.relations.length === 0 ? (
            <p className="p-1 text-sm text-muted-foreground">No one met yet. Give it a little time in the garden.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {current.relations.map((r) => (
                <RelationRow key={r.seed} relation={r} onOpen={(s, name) => setRoot({ seed: s, name })} />
              ))}
            </ul>
          )
        ) : current?.error ? (
          <p className="p-1 text-sm text-destructive" role="alert">
            Couldn't load the relations: {current.error}
          </p>
        ) : (
          <p className="p-1 text-sm text-muted-foreground" aria-live="polite">
            Loading…
          </p>
        )}
      </div>
    </aside>
  );
}
