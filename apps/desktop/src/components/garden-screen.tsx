import { activityLog, stateAt } from "@blob-land/sim";
import { love } from "blobatar/expression";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Eye,
  EyeOff,
  Home,
  Minus,
  Plus,
  Menu,
  Network,
  Pencil,
  RotateCcw,
  Trees,
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { FamilyPanel } from "@/components/family-tree";
import { Button } from "@/components/ui/button";
import { ACTIVITY_LABELS, ActivityIcon, DECOR_SPRITES, GROUND_THUMBS, RAMP_THUMB, Scene, type SceneBlob } from "@/components/scene";
import type { GardenBlob } from "@/lib/api";
import { DECOR_CATEGORIES, GROUNDS, type DecorKind, type Ground, defaultIsland, MAX_ISLAND_SIZE, MIN_ISLAND_SIZE, paintCell, resizeIsland, type IslandLayout, type IslandTool } from "@/lib/island";
import { usePrefersReducedMotion } from "@/lib/motion";

export interface GardenScreenProps {
  localPseudo: string;
  localSeed: string;
  account: { pseudo: string; seed: string; token: string } | null;
  blobs: GardenBlob[];
  visible: boolean;
  onToggleVisibility: () => void;
  onJoinGarden: () => void;
  /** The private island's layout — local only, edited here. */
  island: IslandLayout;
  onIslandChange: (island: IslandLayout) => void;
}

const PAGE_SIZE = 50;
// How often activities are re-read: they change every few hours at most, so a
// minute of lag is invisible.
const STATE_TICK_MS = 30_000;
const JOURNAL_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
// The shared garden is never edited: everyone sees the same default island.
const GARDEN_ISLAND = defaultIsland(7);

export function GardenScreen({
  localPseudo,
  localSeed,
  account,
  blobs,
  visible,
  onToggleVisibility,
  onJoinGarden,
  island,
  onIslandChange,
}: GardenScreenProps) {
  // One scene at a time: your own island, or the garden (with you in it).
  const [view, setView] = useState<"private" | "garden">("private");
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState<IslandTool>("grass");
  // The side panel: one at a time.
  const [panel, setPanel] = useState<"journal" | "family" | null>(null);
  // Re-render now and then, so states (and expressions) follow the clock.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), STATE_TICK_MS);
    return () => clearInterval(id);
  }, []);
  const blobState = (seed: string) => {
    const { expression, activity } = stateAt(seed, now);
    return { expression, activity };
  };
  const reducedMotion = usePrefersReducedMotion();
  const pageCount = Math.max(1, Math.ceil(blobs.length / PAGE_SIZE));
  const [page, setPage] = useState(0);
  // Clamp rather than reset to 0, so a garden that shrinks below the current
  // page doesn't silently yank the visitor back to the first page.
  useEffect(() => setPage((p) => Math.min(p, pageCount - 1)), [pageCount]);
  // Losing the account (or never having one) means there's no garden to show.
  const inGarden = view === "garden" && account !== null;

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const pageBlobs = blobs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  // A taken pseudo forces the account onto a different seed from the private
  // blob — when that happens, show both rather than pretending they're one.
  const accountIsSprout = account !== null && account.seed !== localSeed;

  const privateBlobs: SceneBlob[] = [
    { seed: localSeed, label: localPseudo, ...blobState(localSeed) },
  ];
  if (accountIsSprout) {
    privateBlobs.push({
      seed: account.seed,
      label: `${account.pseudo} (garden sprout)`,
      ...blobState(account.seed),
    });
  }
  const gardenBlobs: SceneBlob[] = pageBlobs.map((blob) => ({
    seed: blob.seed,
    label: blob.pseudo ?? "a new blob",
    ...blobState(blob.seed),
    ...(blob.paired ? { expression: love } : {}),
    paired: blob.paired,
  }));
  // Your own blob is always in the garden you're looking at — even when it's
  // hidden from others, or listed on another page.
  if (account && !gardenBlobs.some((b) => b.seed === account.seed)) {
    gardenBlobs.unshift({ seed: account.seed, label: account.pseudo, ...blobState(account.seed) });
  }

  function switchView(next: "private" | "garden") {
    setView(next);
    setEditing(false);
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-background">
      {inGarden ? (
        <Scene key="garden" blobs={gardenBlobs} skySeed={localSeed} reducedMotion={reducedMotion} layout={GARDEN_ISLAND} blobScale={0.55} />
      ) : (
        <Scene
          key="private"
          blobs={privateBlobs}
          skySeed={localSeed}
          reducedMotion={reducedMotion}
          layout={island}
          onCellPaint={editing ? (n) => onIslandChange(paintCell(island, n, tool)) : undefined}
        />
      )}

      <nav
        aria-label="Menu"
        className="absolute top-4 left-4 z-10 flex w-60 flex-col gap-1 rounded-xl border bg-background/85 p-1.5 shadow-lg backdrop-blur-md"
        style={menuOpen ? undefined : { width: "auto" }}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-expanded={menuOpen}
          aria-controls="scene-menu"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <X /> : <Menu />}
        </Button>

        {menuOpen ? (
          <div id="scene-menu" className="flex flex-col gap-1">
            <MenuItem icon={<Home />} active={!inGarden} onClick={() => switchView("private")}>
              My island
            </MenuItem>
            {account ? (
              <MenuItem icon={<Trees />} active={inGarden} onClick={() => switchView("garden")}>
                Garden
              </MenuItem>
            ) : (
              <MenuItem icon={<Trees />} onClick={onJoinGarden}>
                Join the garden
              </MenuItem>
            )}

            <MenuItem
              icon={<BookOpen />}
              active={panel === "journal"}
              onClick={() => {
                setPanel((p) => (p === "journal" ? null : "journal"));
                setMenuOpen(false);
              }}
            >
              Journal
            </MenuItem>
            <MenuItem
              icon={<Network />}
              active={panel === "family"}
              onClick={() => {
                setPanel((p) => (p === "family" ? null : "family"));
                setMenuOpen(false);
              }}
            >
              Family tree
            </MenuItem>

            <div className="my-1 h-px bg-border" aria-hidden="true" />

            {inGarden ? (
              <>
                <MenuItem icon={visible ? <Eye /> : <EyeOff />} onClick={onToggleVisibility}>
                  {visible ? "Visible to others" : "Hidden from others"}
                </MenuItem>
                {pageCount > 1 ? (
                  <div className="flex items-center justify-between px-1">
                    <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                      <ChevronLeft />
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Page {page + 1} of {pageCount}
                    </span>
                    <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>
                      <ChevronRight />
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <MenuItem
                icon={<Pencil />}
                active={editing}
                onClick={() => {
                  setEditing((e) => !e);
                  setMenuOpen(false);
                }}
              >
                {editing ? "Stop editing" : "Edit island"}
              </MenuItem>
            )}
          </div>
        ) : null}
      </nav>

      {panel === "journal" ? <JournalPanel seed={localSeed} name={localPseudo} now={now} onClose={() => setPanel(null)} /> : null}
      {panel === "family" ? (
        <FamilyPanel
          seed={account?.seed ?? null}
          token={account?.token ?? null}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {editing && !inGarden ? (
        <div className="absolute bottom-4 left-1/2 z-10 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl border bg-background/85 p-1.5 shadow-lg backdrop-blur-md">
          <IslandToolbar
            tool={tool}
            onTool={setTool}
            size={island.size}
            onResize={(size) => onIslandChange(resizeIsland(island, size))}
            onReset={() => onIslandChange(defaultIsland(island.size))}
            onDone={() => setEditing(false)}
          />
        </div>
      ) : null}
    </main>
  );
}

/** What your blob has been up to: its current activity, then the last few
 * days of changes, newest first. */
function JournalPanel({ seed, name, now, onClose }: { seed: string; name: string; now: number; onClose: () => void }) {
  const current = stateAt(seed, now);
  const entries = activityLog(seed, now - JOURNAL_DAYS * DAY_MS, now).reverse();
  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (
    <aside
      aria-label={`${name}'s journal`}
      className="absolute top-4 right-4 z-10 flex max-h-[calc(100%-2rem)] w-72 flex-col rounded-xl border bg-background/85 shadow-lg backdrop-blur-md"
    >
      <header className="flex items-center gap-2 border-b p-3">
        <BookOpen className="size-4" />
        <h2 className="flex-1 text-sm font-semibold">{name}'s journal</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close journal" onClick={onClose}>
          <X />
        </Button>
      </header>
      <p className="flex items-center gap-2 border-b px-3 py-2 text-sm">
        <ActivityIcon activity={current.activity} className="size-4" />
        {ACTIVITY_LABELS[current.activity]} since {time(current.since)}
      </p>
      <ol className="overflow-y-auto p-3 text-sm">
        {entries.map((e, i) => (
          <li key={e.at}>
            {i === 0 || day(e.at) !== day(entries[i - 1]!.at) ? (
              <h3 className={`${i === 0 ? "" : "mt-2 "}mb-1 text-xs font-medium text-muted-foreground first-letter:uppercase`}>{day(e.at)}</h3>
            ) : null}
            <p className="flex gap-2 py-0.5">
              <time className="w-12 shrink-0 text-muted-foreground tabular-nums" dateTime={new Date(e.at).toISOString()}>
                {time(e.at)}
              </time>
              {e.text}
            </p>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function MenuItem({
  icon,
  active = false,
  onClick,
  children,
}: {
  icon: ReactNode;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      className="justify-start"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {icon}
      {children}
    </Button>
  );
}

const GROUND_LABELS: Record<Ground, string> = {
  grass: "Grass",
  sand: "Sand",
  dirt: "Dirt",
  snow: "Snow",
  water: "Water",
  ice: "Ice",
  road: "Road",
  river: "River",
};

/** "rock-sand-3" -> "Sand rock 3", "tree-snow-1" -> "Snowy tree 1". */
function decorLabel(kind: DecorKind): string {
  const [family, ...rest] = kind.split("-");
  const n = rest.pop();
  const variant = { snow: "Snowy ", dirt: "Dirt ", sand: "Sand " }[rest[0] as string] ?? "";
  const noun = { tree: "tree", bush: "bush", rock: "rock", cactus: "cactus" }[family as string] ?? family;
  const label = `${variant}${noun} ${n}`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type Tool = { tool: IslandTool; label: string; thumb: string | ReactNode };
type Category = { id: string; label: string; thumb: string; labelled?: boolean; tools: Tool[] };

// The toolbar's fold-out sections. Roads and rivers get their own: they shape
// themselves (corners, junctions, sand or snow banks follow the neighbours).
const CATEGORIES: Category[] = [
  {
    id: "ground",
    label: "Ground",
    thumb: GROUND_THUMBS.grass,
    labelled: true,
    tools: GROUNDS.filter((g) => g !== "road" && g !== "river").map((g) => ({ tool: g, label: GROUND_LABELS[g], thumb: GROUND_THUMBS[g] })),
  },
  {
    id: "paths",
    label: "Roads & rivers",
    thumb: GROUND_THUMBS.road,
    labelled: true,
    tools: (["road", "river"] as const).map((g) => ({ tool: g, label: GROUND_LABELS[g], thumb: GROUND_THUMBS[g] })),
  },
  {
    id: "relief",
    label: "Relief",
    thumb: RAMP_THUMB,
    labelled: true,
    tools: [
      { tool: "raise", label: "Raise", thumb: <ArrowUpFromLine /> },
      { tool: "lower", label: "Lower", thumb: <ArrowDownToLine /> },
      // Climbs towards the neighbour one block higher.
      { tool: "ramp", label: "Ramp", thumb: RAMP_THUMB },
    ],
  },
  ...(
    [
      ["trees", "Trees", "tree-6"],
      ["bushes", "Bushes", "bush-3"],
      ["rocks", "Rocks", "rock-4"],
      ["cacti", "Cacti", "cactus-4"],
    ] as const
  ).map(([id, label, icon]) => ({
    id,
    label,
    thumb: DECOR_SPRITES[icon].src,
    tools: DECOR_CATEGORIES[id].map((kind) => ({ tool: kind, label: decorLabel(kind), thumb: DECOR_SPRITES[kind].src })),
  })),
];

function IslandToolbar({
  tool,
  onTool,
  size,
  onResize,
  onReset,
  onDone,
}: {
  tool: IslandTool;
  onTool: (tool: IslandTool) => void;
  size: number;
  onResize: (size: number) => void;
  onReset: () => void;
  onDone: () => void;
}) {
  const [open, setOpen] = useState<string | null>("ground");
  const openCategory = CATEGORIES.find((c) => c.id === open);
  return (
    <div className="flex flex-col items-center gap-1.5" role="toolbar" aria-label="Island editor">
      {openCategory ? (
        <div id="editor-tools" className="flex max-w-3xl flex-wrap justify-center gap-1.5 border-b pb-1.5">
          {openCategory.tools.map((t) => (
            <Button
              key={t.tool}
              variant={tool === t.tool ? "default" : "outline"}
              size="sm"
              className="h-10 min-w-10"
              aria-pressed={tool === t.tool}
              aria-label={t.label}
              title={t.label}
              onClick={() => onTool(t.tool)}
            >
              {typeof t.thumb === "string" ? <img src={t.thumb} alt="" className="h-7 w-auto" /> : t.thumb}
              {/* Grounds read better with their name; decor is recognisable at a glance. */}
              {openCategory.labelled ? t.label : null}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {CATEGORIES.map((c) => {
          const expanded = c.id === open;
          // Highlight the category holding the active tool, even when folded.
          const holdsTool = c.tools.some((t) => t.tool === tool);
          return (
            <Button
              key={c.id}
              variant={expanded ? "secondary" : "ghost"}
              size="sm"
              aria-expanded={expanded}
              aria-controls="editor-tools"
              className={holdsTool ? "ring-2 ring-primary/40" : undefined}
              onClick={() => setOpen(expanded ? null : c.id)}
            >
              <img src={c.thumb} alt="" className="h-4 w-auto" />
              {c.label}
              <ChevronDown className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
            </Button>
          );
        })}
        <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
        <Button variant={tool === "erase" ? "default" : "outline"} size="sm" aria-pressed={tool === "erase"} onClick={() => onTool("erase")}>
          <Eraser /> Erase
        </Button>
        <div className="flex items-center" role="group" aria-label="Island size">
          <Button variant="ghost" size="icon-sm" aria-label="Smaller island" disabled={size <= MIN_ISLAND_SIZE} onClick={() => onResize(size - 1)}>
            <Minus />
          </Button>
          <span className="min-w-12 text-center text-xs tabular-nums" aria-live="polite">
            {size} × {size}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Bigger island" disabled={size >= MAX_ISLAND_SIZE} onClick={() => onResize(size + 1)}>
            <Plus />
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw /> Reset
        </Button>
        <Button size="sm" onClick={onDone}>
          <Check /> Done
        </Button>
      </div>
    </div>
  );
}
