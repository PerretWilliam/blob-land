import { MAX_NAME_LENGTH } from "@blob-land/sim";
import { Blobatar } from "@blobatar/react";
import { Check, Heart, Network, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { EmptyState, LoadFailed } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { language, useT } from "@/i18n";
import { getTree, renameChild, type FamilyChild, type FamilyMember, type FamilyTree } from "@/lib/api";

const date = (t: number) => new Date(t).toLocaleDateString(language(), { day: "numeric", month: "short", year: "numeric" });

/**
 * The family around one blob, top to bottom: its parents, the blob with its
 * current partner, then its descendants, one generation per row, each
 * grouped under the couple it was born to. Any member opens its own tree.
 * A parent hidden from the garden, or gone from it, isn't shown: its
 * children show under the other one alone.
 */
export function FamilyTreeView({
  tree,
  viewer,
  onOpen,
  onRename,
}: {
  tree: FamilyTree;
  /** Your own garden blob: you can rename the children you're a parent of. */
  viewer: string | null;
  onOpen: (seed: string) => void;
  /** Resolves once renamed; rejects with the server's reason. */
  onRename: (seed: string, name: string) => Promise<void>;
}) {
  const t = useT();
  const depths = [...new Set(tree.children.map((c) => c.depth))].sort((a, b) => a - b);
  return (
    <div className="flex flex-col items-center gap-3 p-3 text-center">
      {tree.parents?.length ? (
        <>
          <Couple members={tree.parents} onOpen={onOpen} label={t.family.parents} />
          <span className="h-4 w-px bg-border" aria-hidden="true" />
        </>
      ) : null}

      <div className="flex items-center gap-2">
        <Member seed={tree.seed} name={tree.name ?? t.common.aSprout} size={72} current />
        {tree.partner ? (
          <>
            <Heart className="size-4 fill-rose-400 text-rose-400" aria-label={t.family.together} role="img" />
            <Member seed={tree.partner.seed} name={tree.partner.pseudo} onOpen={onOpen} />
          </>
        ) : null}
      </div>

      {depths.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.family.noChildren}</p>
      ) : (
        depths.map((depth) => (
          <section key={depth} className="flex w-full flex-col items-center gap-2" aria-label={t.family.generation(depth)}>
            <span className="h-4 w-px bg-border" aria-hidden="true" />
            <h3 className="text-xs font-medium text-muted-foreground">{t.family.generation(depth)}</h3>
            {couples(tree.children.filter((c) => c.depth === depth)).map(([key, kids]) => {
              const parents = kids[0]!.parents;
              // Your own children are grouped by who you had them with.
              const others = parents.filter((p) => p.seed !== tree.seed);
              const caption =
                others.length < parents.length ? (others[0] ? t.family.with(others[0].pseudo) : null)
                : parents.length === 2 ? t.family.couple(parents[0]!.pseudo, parents[1]!.pseudo)
                : (parents[0]?.pseudo ?? null);
              return (
                <div key={key} className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed p-2">
                  {caption ? <p className="text-[11px] text-muted-foreground">{caption}</p> : null}
                  <div className="flex flex-wrap justify-center gap-2">
                    {kids.map((c) => (
                      <Member
                        key={c.seed}
                        seed={c.seed}
                        name={c.name ?? t.family.unnamed}
                        note={t.family.born(date(c.born_at))}
                        onOpen={onOpen}
                        onRename={c.parents.some((p) => p.seed === viewer) ? (name) => onRename(c.seed, name) : undefined}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}

/** Children grouped by the couple they were born to, in the order they came. */
function couples(children: FamilyChild[]): [string, FamilyChild[]][] {
  const groups = new Map<string, FamilyChild[]>();
  for (const c of children) {
    const key = c.parents.map((p) => p.seed).sort().join("|");
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups];
}

/** Both parents with a heart between them, or the one there is. */
function Couple({ members, onOpen, label }: { members: FamilyMember[]; onOpen: (seed: string) => void; label: string }) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      {members.map((m, i) => (
        <span key={m.seed} className="contents">
          {i > 0 ? <Heart className="size-4 fill-rose-400 text-rose-400" aria-hidden="true" /> : null}
          <Member seed={m.seed} name={m.pseudo} onOpen={onOpen} />
        </span>
      ))}
    </div>
  );
}

function Member({
  seed,
  name,
  note,
  size = 48,
  current = false,
  onOpen,
  onRename,
}: {
  seed: string;
  name: string;
  note?: string;
  size?: number;
  current?: boolean;
  onOpen?: (seed: string) => void;
  onRename?: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const t = useT();
  const face = (
    <>
      <Blobatar name={seed} size={size} />
      <span className="max-w-24 truncate text-xs font-medium">{name}</span>
      {note ? <span className="text-[11px] text-muted-foreground">{note}</span> : null}
    </>
  );
  return (
    <div className="flex flex-col items-center" aria-current={current ? "true" : undefined}>
      {current || !onOpen ? (
        <div className="flex flex-col items-center gap-0.5 p-1">{face}</div>
      ) : (
        <button
          type="button"
          className="flex flex-col items-center gap-0.5 rounded-lg p-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          title={t.family.open(name)}
          onClick={() => onOpen(seed)}
        >
          {face}
        </button>
      )}
      {onRename ? (
        editing ? (
          <RenameForm initial={name} onRename={onRename} onDone={() => setEditing(false)} />
        ) : (
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => setEditing(true)}>
            <Pencil className="size-3" /> {t.family.rename}
          </Button>
        )
      ) : null}
    </div>
  );
}

function RenameForm({ initial, onRename, onDone }: { initial: string; onRename: (name: string) => Promise<void>; onDone: () => void }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const t = useT();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (value.trim() === initial) return onDone();
    setBusy(true);
    setError(null);
    try {
      await onRename(value);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      // Straight back to the field, name selected, to try another.
      input.current?.select();
    }
  }
  return (
    <form className="flex w-32 flex-col gap-1" onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && onDone()}>
      <div className="flex gap-1">
        <input
          ref={input}
          autoFocus
          onFocus={(e) => e.target.select()}
          aria-label={t.family.newName}
          aria-invalid={error ? true : undefined}
          maxLength={MAX_NAME_LENGTH}
          className="h-6 min-w-0 flex-1 rounded-md border-2 border-ink bg-white px-1.5 text-xs"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" size="icon-sm" className="size-6" aria-label={t.family.saveName} disabled={busy || !value.trim()}>
          <Check className="size-3" />
        </Button>
      </div>
      {error ? (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** The family panel: loads /tree for whoever is being looked at, starting with you. */
export function FamilyPanel({
  seed,
  token,
  onClose,
}: {
  /** Your garden blob, or null without an account (families only exist in the garden). */
  seed: string | null;
  token: string | null;
  onClose: () => void;
}) {
  const [root, setRoot] = useState(seed);
  const [result, setResult] = useState<{ seed: string; tree?: FamilyTree; error?: unknown } | null>(null);
  // Bumped after a rename (to show the new name) and by "Try again".
  const [version, setVersion] = useState(0);
  const t = useT();
  useEffect(() => {
    if (!root) return;
    let live = true;
    getTree(root, token).then(
      (tree) => live && setResult({ seed: root, tree }),
      (e: unknown) => live && setResult({ seed: root, error: e }),
    );
    return () => {
      live = false;
    };
  }, [root, token, version]);
  const current = result?.seed === root ? result : null;

  async function rename(child: string, name: string) {
    if (!token) throw new Error(t.family.logInToName);
    await renameChild(token, child, name);
    setVersion((v) => v + 1);
  }

  return (
    <aside
      aria-label={t.family.title}
      className="absolute top-4 right-4 z-10 flex max-h-[calc(100%-2rem)] w-80 flex-col toon"
    >
      <header className="flex items-center gap-2 rounded-t-[1rem] border-b-[3px] border-ink px-3 py-2 bg-berry">
        <Network className="size-4" />
        <h2 className="flex-1 text-base font-bold">{t.family.title}</h2>
        {root !== seed && seed ? (
          <Button variant="ghost" size="sm" onClick={() => setRoot(seed)}>
            {t.common.backToMine}
          </Button>
        ) : null}
        <Button variant="ghost" size="icon-sm" aria-label={t.family.close} onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="overflow-y-auto">
        {!seed ? (
          <EmptyState face="sleepy" title={t.family.none}>
            {t.family.noneText}
          </EmptyState>
        ) : current?.tree ? (
          <FamilyTreeView tree={current.tree} viewer={seed} onOpen={setRoot} onRename={rename} />
        ) : current && "error" in current ? (
          <LoadFailed error={current.error} title={t.family.failed} offline={t.family.offline} onRetry={() => setVersion((v) => v + 1)} />
        ) : (
          <p className="p-3 text-sm text-muted-foreground" aria-live="polite">
            {t.common.loading}
          </p>
        )}
      </div>
    </aside>
  );
}
