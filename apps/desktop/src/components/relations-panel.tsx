import { STATUSES, type RelationStatus } from "@blob-land/sim";
import { Blobatar } from "@blobatar/react";
import { Hand, Heart, HeartCrack, HeartHandshake, House, type LucideIcon, Search, Smile, Sparkles, Star, Swords, UserRound, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState, LoadFailed } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { getRelationships, type Relation } from "@/lib/api";

/** How each status looks: its own colour and icon (its words are in i18n). Full class names, so Tailwind sees them. */
const STYLE: Record<RelationStatus, { icon: LucideIcon; badge: string; row: string }> = {
  lovers: { icon: Heart, badge: "bg-rose-500 text-white", row: "border-rose-400 bg-rose-500/10" },
  crush: { icon: Sparkles, badge: "bg-pink-400 text-white", row: "border-pink-300 bg-pink-400/10" },
  best_friends: { icon: Star, badge: "bg-amber-400 text-amber-950", row: "border-amber-300 bg-amber-400/10" },
  friends: { icon: Smile, badge: "bg-emerald-500 text-white", row: "border-emerald-400 bg-emerald-500/10" },
  family: { icon: House, badge: "bg-violet-500 text-white", row: "border-violet-400 bg-violet-500/10" },
  acquaintances: { icon: Hand, badge: "bg-sky-500 text-white", row: "border-sky-300 bg-sky-500/10" },
  strangers: { icon: UserRound, badge: "bg-slate-400 text-white", row: "border-slate-300 bg-slate-400/10" },
  complicated: { icon: Zap, badge: "bg-orange-500 text-white", row: "border-orange-400 bg-orange-500/10" },
  rivals: { icon: Swords, badge: "bg-red-600 text-white", row: "border-red-500 bg-red-600/10" },
  ex: { icon: HeartCrack, badge: "bg-stone-500 text-white", row: "border-stone-400 bg-stone-500/10" },
};

// Warmest first: love and friendship at the top, feuds at the bottom.
const ORDER: RelationStatus[] = ["lovers", "crush", "best_friends", "family", "friends", "complicated", "acquaintances", "strangers", "ex", "rivals"];
const rank = (r: Relation) => ORDER.indexOf(r.status) * 1000 - (r.friendship + r.romance - r.tension);

const SORTS = {
  warmest: (a: Relation, b: Relation) => rank(a) - rank(b),
  name: (a: Relation, b: Relation) => (a.name ?? "").localeCompare(b.name ?? ""),
  friendship: (a: Relation, b: Relation) => b.friendship - a.friendship,
  love: (a: Relation, b: Relation) => b.romance - a.romance,
  tension: (a: Relation, b: Relation) => b.tension - a.tension,
  meetings: (a: Relation, b: Relation) => b.meetings - a.meetings,
} as const;
type Sort = keyof typeof SORTS;

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
  const t = useT();
  const style = STYLE[relation.status];
  const Icon = style.icon;
  const name = relation.name ?? t.common.aSprout;
  const label = t.relations.status[relation.status];
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(relation.seed, name)}
        aria-label={t.relations.row(name, label)}
        className={`flex w-full items-center gap-3 rounded-lg border-l-4 p-2 text-left transition-[filter] hover:brightness-95 ${style.row}`}
      >
        <Blobatar name={relation.seed} size={48} className="shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{name}</span>
            <span className={`ml-auto flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${style.badge}`}>
              <Icon className="size-3" aria-hidden="true" />
              {relation.kin ? t.relations.kin[relation.kin] : label}
            </span>
          </span>
          <Gauge label={t.relations.friends} value={relation.friendship} color="bg-emerald-500" />
          <Gauge label={t.relations.love} value={relation.romance} color="bg-rose-500" />
          <Gauge label={t.relations.tension} value={relation.tension} color="bg-orange-500" />
        </span>
      </button>
    </li>
  );
}

/**
 * Everyone a blob has met, and how they get on — each status in its own
 * colour, searchable by name, filtered by status (the summary chips) and
 * sorted as you like. Any blob in the list opens its own relations.
 * `start`: whose relations to open on (the player's own by default).
 * `token`, when signed in: a hidden player still sees their own.
 */
export function RelationsPanel({
  seed,
  token,
  start,
  onClose,
}: {
  seed: string | null;
  token: string | null;
  start?: { seed: string; name: string };
  onClose: () => void;
}) {
  const t = useT();
  const [root, setRoot] = useState<{ seed: string; name: string } | null>(start ?? (seed ? { seed, name: "" } : null));
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<RelationStatus | null>(null);
  const [sort, setSort] = useState<Sort>("warmest");
  // A new blob's relations start unfiltered.
  useEffect(() => {
    setQuery("");
    setOnly(null);
  }, [root]);
  const [result, setResult] = useState<{ seed: string; relations?: Relation[]; error?: unknown } | null>(null);
  // Bumped by "Try again".
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!root) return;
    let live = true;
    getRelationships(root.seed, token).then(
      ({ relationships }) => live && setResult({ seed: root.seed, relations: relationships }),
      (e: unknown) => live && setResult({ seed: root.seed, error: e }),
    );
    return () => {
      live = false;
    };
  }, [root, token, attempt]);
  const current = result?.seed === root?.seed ? result : null;
  const mine = root?.seed === seed;
  const counts = new Map<RelationStatus, number>();
  for (const r of current?.relations ?? []) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const needle = query.trim().toLowerCase();
  const shown = (current?.relations ?? [])
    .filter((r) => (!only || r.status === only) && (!needle || (r.name ?? "").toLowerCase().includes(needle)))
    .sort(SORTS[sort]);

  return (
    <aside
      aria-label={t.relations.title}
      className="absolute top-4 right-4 z-10 flex max-h-[calc(100%-2rem)] w-80 flex-col toon"
    >
      <header className="flex items-center gap-2 rounded-t-[1rem] border-b-[3px] border-ink px-3 py-2 bg-berry">
        <HeartHandshake className="size-4" />
        <h2 className="flex-1 truncate text-base font-bold">{mine || !root ? t.relations.title : t.relations.of(root.name)}</h2>
        {!mine && seed ? (
          <Button variant="ghost" size="sm" onClick={() => setRoot({ seed, name: "" })}>
            {t.common.backToMine}
          </Button>
        ) : null}
        <Button variant="ghost" size="icon-sm" aria-label={t.relations.close} onClick={onClose}>
          <X />
        </Button>
      </header>
      {counts.size > 0 ? (
        <div className="flex flex-col gap-2 border-b px-3 py-2">
          {/* The summary doubles as a filter: click a status to see only those. */}
          <p className="flex flex-wrap gap-1" aria-label={t.relations.filter}>
            {STATUSES.filter((s) => counts.has(s))
              .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
              .map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={only === s}
                  onClick={() => setOnly((o) => (o === s ? null : s))}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-opacity ${STYLE[s].badge} ${only && only !== s ? "opacity-35" : ""} ${only === s ? "ring-2 ring-foreground/60 ring-offset-1" : ""}`}
                >
                  {counts.get(s)} {t.relations.status[s].toLocaleLowerCase()}
                </button>
              ))}
          </p>
          <div className="flex gap-1.5">
            <label className="relative flex-1">
              <span className="sr-only">{t.relations.search}</span>
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.relations.search}
                className="h-7 w-full rounded-lg border-2 border-ink bg-white pr-2 pl-7 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label>
              <span className="sr-only">{t.relations.sortBy}</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="h-7 rounded-lg border-2 border-ink bg-white px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {(Object.keys(SORTS) as Sort[]).map((key) => (
                  <option key={key} value={key}>
                    {t.relations.sort[key]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : null}
      <div className="overflow-y-auto p-2">
        {!seed ? (
          <EmptyState face="sleepy" title={t.relations.noGarden}>
            {t.relations.noGardenText}
          </EmptyState>
        ) : current?.relations ? (
          current.relations.length === 0 ? (
            <EmptyState face="thinking" seed={root?.seed} title={t.relations.noneYet}>
              {t.relations.noneYetText}
            </EmptyState>
          ) : shown.length === 0 ? (
            <EmptyState face="unsure" title={t.relations.noMatch}>
              {t.relations.noMatchText}
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {shown.map((r) => (
                <RelationRow key={r.seed} relation={r} onOpen={(s, name) => setRoot({ seed: s, name })} />
              ))}
            </ul>
          )
        ) : current && "error" in current ? (
          <LoadFailed error={current.error} title={t.relations.failed} offline={t.relations.offline} onRetry={() => setAttempt((n) => n + 1)} />
        ) : (
          <p className="p-1 text-sm text-muted-foreground" aria-live="polite">
            {t.common.loading}
          </p>
        )}
      </div>
    </aside>
  );
}
