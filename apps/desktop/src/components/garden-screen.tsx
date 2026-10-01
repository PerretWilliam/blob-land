import { activityLog, gardenSize, segmentAt } from "@blob-land/sim";
import {
  BookOpen,
  Check,
  DoorOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eraser,
  HeartHandshake,
  Home,
  Minus,
  Plus,
  Menu,
  Network,
  Newspaper,
  Pencil,
  Power,
  RotateCcw,
  Settings,
  Trees,
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { EmptyState, RetryButton } from "@/components/empty-state";
import { FamilyPanel } from "@/components/family-tree";
import { GardenNewsPanel } from "@/components/garden-news-panel";
import { DevPanel } from "@/components/dev-panel";
import { RelationsPanel } from "@/components/relations-panel";
import { Button } from "@/components/ui/button";
import { ActivityIcon, blobStateAt, MoodIcon, moodOf, DECOR_SPRITES, GROUND_THUMBS, RAMP_THUMB, Scene, type SceneBlob } from "@/components/scene";
import { journalLine, language, listNames, useT } from "@/i18n";
import type { Messages } from "@/i18n/en";
import { gardenTime, type GardenBlob, type GardenClock, type GardenRegion } from "@/lib/api";
import { DEV, devNow, useKnobs } from "@/lib/dev";
import type { LocalLife } from "@/lib/life";
import { canQuit, quit } from "@/lib/quit";
import { useGardenIsland } from "@/lib/use-garden-island";
import { DECOR_CATEGORIES, GROUNDS, type DecorKind, type Ground, defaultIsland, MAX_ISLAND_SIZE, MIN_ISLAND_SIZE, paintCell, resizeIsland, type IslandLayout, type IslandTool } from "@/lib/island";
import { usePrefersReducedMotion } from "@/lib/motion";

export interface GardenScreenProps {
  /** The scene it opens on. */
  initialView: "private" | "garden";
  /** Back to the main menu. */
  onMainMenu: () => void;
  /** Whether the garden's server can be reached; `onRetryOnline` looks again. */
  online: boolean;
  onRetryOnline: () => Promise<boolean>;
  localPseudo: string;
  localSeed: string;
  /** The private blob's own, locally lived timeline and identity. */
  life: LocalLife;
  account: { pseudo: string; seed: string; token: string } | null;
  blobs: GardenBlob[];
  /** The region on screen, the player's own, every region, and the island's side, once loaded. */
  regions: { region: number; home: number; list: GardenRegion[]; size: number } | null;
  /** Go and see another region's island. */
  onVisit: (region: number) => void;
  /** The garden's time, which may run faster than the private blob's (dev). */
  gardenClock: GardenClock;
  /** Dev: runs the garden `scale` times faster (the server does it). */
  onGardenSpeed?: (scale: number) => Promise<void>;
  /** Dev: wipes everything, here and on the server, and seeds a garden. */
  onReset?: () => Promise<void>;
  onJoinGarden: () => void;
  onSettings: () => void;
  /** The private island's layout — local only, edited here. */
  island: IslandLayout;
  onIslandChange: (island: IslandLayout) => void;
}

// How often activities and faces are re-read off the timelines: segments last
// minutes, so a few seconds of lag is invisible.
const STATE_TICK_MS = 5_000;
// How long a newborn sparkles, in garden time.
const NEWBORN_MS = 30 * 60 * 1000;

export function GardenScreen({
  initialView,
  onMainMenu,
  online,
  onRetryOnline,
  localPseudo,
  localSeed,
  life,
  account,
  blobs,
  regions,
  onVisit,
  gardenClock,
  onGardenSpeed,
  onReset,
  onJoinGarden,
  onSettings,
  island,
  onIslandChange,
}: GardenScreenProps) {
  const t = useT();
  // One scene at a time: your own island, or the garden (with you in it).
  const [view, setView] = useState(initialView);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState<IslandTool>("grass");
  // The side panel: one at a time.
  const [panel, setPanel] = useState<"journal" | "family" | "relations" | "news" | null>(null);
  // Whose relations the panel opens on: the player's own unless a blob's ID card asked.
  const [relationsOf, setRelationsOf] = useState<{ seed: string; name: string } | undefined>(undefined);
  // Re-render now and then, so states (and expressions) follow the clock.
  const dev = useKnobs();
  const [now, setNow] = useState(devNow);
  useEffect(() => {
    const id = setInterval(() => setNow(devNow()), Math.max(500, STATE_TICK_MS / (gardenClock.rate * Math.max(1, dev.speed))));
    return () => clearInterval(id);
  }, [gardenClock.rate, dev.speed]);
  const gardenClockNow = () => gardenTime(gardenClock);
  const gardenNow = gardenClockNow();
  const nameOf = (seed: string) => blobs.find((b) => b.seed === seed)?.pseudo ?? t.common.aBlob;
  // A garden blob as the scene draws it: its face and activity right now, off its timeline.
  const fromGarden = (blob: GardenBlob, label = blob.pseudo ?? t.common.aNewBlob): SceneBlob => {
    const { expression, activity } = blobStateAt(blob.segments, gardenNow);
    const withSeed = segmentAt(blob.segments, gardenNow)?.seg.with;
    return {
      seed: blob.seed,
      label,
      segments: blob.segments,
      expression,
      activity,
      sex: blob.sex,
      attraction: blob.attraction,
      partner: blob.partner,
      meetingWith: activity === "meet" && withSeed?.length ? listNames(withSeed.map(nameOf)) : undefined,
      partnerLabel: blob.partner ? nameOf(blob.partner) : undefined,
      young: gardenNow < blob.adultAt,
      // Children only: an account's blob is born grown up.
      aura: blob.heartbroken ? "heartbroken" : blob.adultAt > blob.bornAt && gardenNow - blob.bornAt < NEWBORN_MS ? "newborn" : undefined,
      country: blob.country,
    };
  };
  const reducedMotion = usePrefersReducedMotion() || dev.reducedMotion;
  // Losing the account (or never having one) means there's no garden to show.
  const inGarden = view === "garden" && account !== null;
  // The shared garden is never edited: everyone sees the same generated
  // island, sized by the server for how many live there.
  const gardenSide = regions?.size ?? gardenSize(blobs.length);
  const atHome = !regions || regions.region === regions.home;
  const gardenLayout = useGardenIsland(inGarden ? gardenSide : null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // A taken pseudo forces the account onto a different seed from the private
  // blob — when that happens, show both rather than pretending they're one.
  const accountIsSprout = account !== null && account.seed !== localSeed;

  const ownGardenBlob = account ? blobs.find((b) => b.seed === account.seed) : undefined;
  const privateBlobs: SceneBlob[] = [
    {
      seed: localSeed,
      label: localPseudo,
      segments: life.segments,
      ...blobStateAt(life.segments, now),
      ...life.identity,
    },
  ];
  // The sprout lives in the garden; it shows up here once the garden has loaded.
  if (accountIsSprout && ownGardenBlob) privateBlobs.push(fromGarden(ownGardenBlob, t.common.gardenSprout(account.pseudo)));
  // Everyone in the region at once: the scene only draws what's in view.
  const gardenBlobs: SceneBlob[] = inGarden ? blobs.map((blob) => fromGarden(blob)) : [];

  function switchView(next: "private" | "garden") {
    setView(next);
    setEditing(false);
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-background">
      {inGarden ? (
        gardenLayout && <Scene key={`garden-${regions?.region ?? "home"}`} blobs={gardenBlobs} reducedMotion={reducedMotion} layout={gardenLayout} blobScale={0.55 * dev.blobSize} startAt={atHome ? account.seed : undefined}
          cardHidden={panel === "relations"}
          clock={gardenClockNow}
          onShowRelations={(seed, name) => {
            setRelationsOf({ seed, name });
            setPanel("relations");
          }}
        />
      ) : (
        <Scene
          key="private"
          blobs={privateBlobs}
          reducedMotion={reducedMotion}
          layout={island}
          blobScale={0.6 * dev.blobSize}
          clock={devNow}
          cardHidden={panel === "relations"}
          onCellPaint={editing ? (n) => onIslandChange(paintCell(island, n, tool)) : undefined}
        />
      )}

      {DEV && <DevPanel time={inGarden ? gardenClockNow : devNow} garden={inGarden ? { rate: gardenClock.rate, set: onGardenSpeed } : undefined} onReset={onReset} />}

      <nav
        aria-label={t.game.menu}
        className="absolute top-4 left-4 z-10 flex w-max flex-col gap-1 toon p-1.5"
      >
        <Button
          variant="ghost"
          size="icon"
          aria-expanded={menuOpen}
          aria-controls="scene-menu"
          aria-label={menuOpen ? t.game.closeMenu : t.game.openMenu}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <X /> : <Menu />}
        </Button>

        {menuOpen ? (
          <div id="scene-menu" className="flex flex-col gap-1">
            <MenuItem icon={<Home />} active={!inGarden} onClick={() => switchView("private")}>
              {t.game.myIsland}
            </MenuItem>
            {account ? (
              <MenuItem icon={<Trees />} active={inGarden} onClick={() => switchView("garden")}>
                {t.game.garden}
              </MenuItem>
            ) : (
              <MenuItem icon={<Trees />} onClick={onJoinGarden} disabled={!online}>
                {t.game.join}
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
              {t.game.journal}
            </MenuItem>
            <MenuItem
              icon={<Network />}
              active={panel === "family"}
              onClick={() => {
                setPanel((p) => (p === "family" ? null : "family"));
                setMenuOpen(false);
              }}
            >
              {t.game.family}
            </MenuItem>
            <MenuItem
              icon={<HeartHandshake />}
              active={panel === "relations"}
              onClick={() => {
                setRelationsOf(undefined);
                setPanel((p) => (p === "relations" ? null : "relations"));
                setMenuOpen(false);
              }}
            >
              {t.game.relations}
            </MenuItem>
            {account ? (
              <MenuItem
                icon={<Newspaper />}
                active={panel === "news"}
                onClick={() => {
                  setPanel((p) => (p === "news" ? null : "news"));
                  setMenuOpen(false);
                }}
              >
                {t.game.news}
              </MenuItem>
            ) : null}

            <div className="my-1 h-px bg-border" aria-hidden="true" />

            <MenuItem
              icon={<Settings />}
              onClick={() => {
                onSettings();
                setMenuOpen(false);
              }}
            >
              {t.game.settings}
            </MenuItem>
            <MenuItem icon={<DoorOpen />} onClick={onMainMenu}>
              {t.game.mainMenu}
            </MenuItem>
            {canQuit ? (
              <MenuItem icon={<Power />} onClick={() => void quit()}>
                {t.game.quit}
              </MenuItem>
            ) : null}
            {inGarden ? null : (
              <MenuItem
                icon={<Pencil />}
                active={editing}
                onClick={() => {
                  setEditing((e) => !e);
                  setMenuOpen(false);
                }}
              >
                {editing ? t.game.stopEditing : t.game.edit}
              </MenuItem>
            )}
          </div>
        ) : null}
      </nav>

      {inGarden && !online ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/40 p-6">
          <div className="toon w-full max-w-sm">
            <EmptyState
              face="sad"
              seed={account.seed}
              title={t.common.outOfReach}
              action={
                <div className="flex flex-col items-center gap-2">
                  <RetryButton onRetry={onRetryOnline} />
                  <Button variant="link" onClick={() => switchView("private")}>
                    {t.game.goToMyIsland}
                  </Button>
                </div>
              }
            >
              {t.game.outOfReach}
            </EmptyState>
          </div>
        </div>
      ) : null}

      {inGarden && regions && regions.list.length > 1 ? <RegionSwitcher regions={regions} onVisit={onVisit} /> : null}

      {panel === "journal" ? <JournalPanel segments={life.segments} name={localPseudo} now={now} onClose={() => setPanel(null)} /> : null}
      {panel === "family" ? (
        <FamilyPanel
          seed={account?.seed ?? null}
          token={account?.token ?? null}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {panel === "relations" ? (
        <RelationsPanel key={relationsOf?.seed ?? "mine"} seed={account?.seed ?? null} token={account?.token ?? null} start={relationsOf} onClose={() => setPanel(null)} />
      ) : null}
      {panel === "news" && account ? <GardenNewsPanel token={account.token} onClose={() => setPanel(null)} /> : null}

      {editing && !inGarden ? (
        <div className="absolute bottom-4 left-1/2 z-10 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 toon p-1.5">
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
function JournalPanel({ segments, name, now, onClose }: { segments: LocalLife["segments"]; name: string; now: number; onClose: () => void }) {
  const t = useT();
  const current = blobStateAt(segments, now);
  const mood = moodOf(current.expression);
  // What's been lived so far; the timeline runs a little ahead of now.
  const entries = activityLog(segments.filter((s) => s.start <= now)).reverse();
  const day = (at: number) => new Date(at).toLocaleDateString(language(), { weekday: "long", day: "numeric", month: "long" });
  const time = (at: number) => new Date(at).toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit" });
  return (
    <aside
      aria-label={t.journal.of(name)}
      className="absolute top-4 right-4 z-10 flex max-h-[calc(100%-2rem)] w-72 flex-col toon"
    >
      <header className="flex items-center gap-2 rounded-t-[1rem] border-b-[3px] border-ink px-3 py-2 bg-sky">
        <BookOpen className="size-4" />
        <h2 className="flex-1 text-base font-bold">{t.journal.of(name)}</h2>
        <Button variant="ghost" size="icon-sm" aria-label={t.journal.close} onClick={onClose}>
          <X />
        </Button>
      </header>
      <p className="flex items-center gap-2 border-b px-3 py-2 text-sm">
        <ActivityIcon activity={current.activity} className="size-4" />
        {t.journal.since(t.activity[current.activity], time(current.since))}
        {mood ? (
          <span className="ml-auto flex items-center gap-1 text-muted-foreground">
            <MoodIcon expression={current.expression} />
            {t.mood[mood.key]}
          </span>
        ) : null}
      </p>
      <ol className="overflow-y-auto p-3 text-sm">
        {entries.map((e, i) => (
          <li key={e.start}>
            {i === 0 || day(e.start) !== day(entries[i - 1]!.start) ? (
              <h3 className={`${i === 0 ? "" : "mt-2 "}mb-1 text-xs font-medium text-muted-foreground first-letter:uppercase`}>{day(e.start)}</h3>
            ) : null}
            <p className="flex gap-2 py-0.5">
              <time className="w-12 shrink-0 text-muted-foreground tabular-nums" dateTime={new Date(e.start).toISOString()}>
                {time(e.start)}
              </time>
              {journalLine(e)}
            </p>
          </li>
        ))}
      </ol>
    </aside>
  );
}

/** The garden's islands, one per region: step through them, and back home. */
function RegionSwitcher({ regions, onVisit }: { regions: NonNullable<GardenScreenProps["regions"]>; onVisit: (region: number) => void }) {
  const { list, region, home } = regions;
  const k = list.findIndex((r) => r.region === region);
  const [prev, next] = [list[k - 1], list[k + 1]];
  const count = list[k]?.blobs ?? 0;
  const t = useT();
  return (
    <nav
      aria-label={t.game.islands}
      className="absolute top-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 toon p-1.5"
    >
      <Button variant="ghost" size="icon-sm" aria-label={t.game.previousIsland} disabled={!prev} onClick={() => prev && onVisit(prev.region)}>
        <ChevronLeft />
      </Button>
      <p className="min-w-32 text-center text-sm" aria-live="polite">
        <span className="font-medium">{region === home ? t.game.yourIsland : t.game.island(region + 1)}</span>
        <span className="text-muted-foreground"> · {t.game.blobs(count)}</span>
      </p>
      <Button variant="ghost" size="icon-sm" aria-label={t.game.nextIsland} disabled={!next} onClick={() => next && onVisit(next.region)}>
        <ChevronRight />
      </Button>
      {region !== home ? (
        <Button variant="secondary" size="sm" onClick={() => onVisit(home)}>
          <Home /> {t.game.home}
        </Button>
      ) : null}
    </nav>
  );
}

function MenuItem({
  icon,
  active = false,
  disabled,
  onClick,
  children,
}: {
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      className="justify-start"
      aria-current={active ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {children}
    </Button>
  );
}

/** "rock-sand-3" -> "Sand rock 3", "tree-snow-1" -> "Snowy tree 1", in the language on screen. */
function decorLabel(t: Messages, kind: DecorKind): string {
  const [family, ...rest] = kind.split("-");
  const n = rest.pop()!;
  return t.editor.decor(family as Parameters<Messages["editor"]["decor"]>[0], (rest[0] ?? null) as Parameters<Messages["editor"]["decor"]>[1], n);
}

type Tool = { tool: IslandTool; label: string; thumb: string | ReactNode };
type Category = { id: keyof Messages["editor"]["categories"]; thumb: string; labelled?: boolean; tools: Tool[] };

// The toolbar's fold-out sections. Roads and rivers get their own: they shape
// themselves (corners, junctions, sand or snow banks follow the neighbours).
const categories = (t: Messages): Category[] => [
  {
    id: "ground",
    thumb: GROUND_THUMBS.grass,
    labelled: true,
    tools: GROUNDS.filter((g) => g !== "road" && g !== "river").map((g: Ground) => ({ tool: g, label: t.editor.ground[g], thumb: GROUND_THUMBS[g] })),
  },
  {
    id: "paths",
    thumb: GROUND_THUMBS.road,
    labelled: true,
    tools: (["road", "river"] as const).map((g) => ({ tool: g, label: t.editor.ground[g], thumb: GROUND_THUMBS[g] })),
  },
  {
    id: "relief",
    thumb: RAMP_THUMB,
    labelled: true,
    tools: [
      { tool: "raise", label: t.editor.raise, thumb: <ArrowUpFromLine /> },
      { tool: "lower", label: t.editor.lower, thumb: <ArrowDownToLine /> },
      // Climbs towards the neighbour one block higher.
      { tool: "ramp", label: t.editor.ramp, thumb: RAMP_THUMB },
    ],
  },
  ...(
    [
      ["trees", "tree-6"],
      ["bushes", "bush-3"],
      ["rocks", "rock-4"],
      ["cacti", "cactus-4"],
    ] as const
  ).map(([id, icon]) => ({
    id,
    thumb: DECOR_SPRITES[icon].src,
    tools: DECOR_CATEGORIES[id].map((kind) => ({ tool: kind, label: decorLabel(t, kind), thumb: DECOR_SPRITES[kind].src })),
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
  const t = useT();
  const [open, setOpen] = useState<string | null>("ground");
  const all = categories(t);
  const openCategory = all.find((c) => c.id === open);
  return (
    <div className="flex flex-col items-center gap-1.5" role="toolbar" aria-label={t.editor.label}>
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
        {all.map((c) => {
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
              {t.editor.categories[c.id]}
              <ChevronDown className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
            </Button>
          );
        })}
        <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
        <Button variant={tool === "erase" ? "default" : "outline"} size="sm" aria-pressed={tool === "erase"} onClick={() => onTool("erase")}>
          <Eraser /> {t.editor.erase}
        </Button>
        <div className="flex items-center" role="group" aria-label={t.editor.size}>
          <Button variant="ghost" size="icon-sm" aria-label={t.editor.smaller} disabled={size <= MIN_ISLAND_SIZE} onClick={() => onResize(size - 1)}>
            <Minus />
          </Button>
          <span className="min-w-12 text-center text-xs tabular-nums" aria-live="polite">
            {size} × {size}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label={t.editor.bigger} disabled={size >= MAX_ISLAND_SIZE} onClick={() => onResize(size + 1)}>
            <Plus />
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw /> {t.editor.reset}
        </Button>
        <Button size="sm" onClick={onDone}>
          <Check /> {t.editor.done}
        </Button>
      </div>
    </div>
  );
}
