import { MAX_NAME_LENGTH } from "@blob-land/sim";
import { Blobatar } from "@blobatar/react";
import { UserPlus, X } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { language, useT } from "@/i18n";
import type { Guest } from "@/lib/life";

/** Who's visiting the private island, and inviting someone over: a player's blob, by pseudo. */
export function VisitPanel({
  seed,
  inGarden,
  guest,
  onInvite,
  onFarewell,
  onClose,
}: {
  /** The private blob's. */
  seed: string;
  inGarden: boolean;
  guest: Guest | undefined;
  onInvite: (name: string) => Promise<void>;
  onFarewell: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onInvite(name);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside aria-label={t.visit.title} className="absolute top-4 right-4 z-10 flex max-h-[calc(100%-2rem)] w-80 flex-col toon">
      <header className="flex items-center gap-2 rounded-t-[1rem] border-b-[3px] border-ink bg-sun px-3 py-2">
        <UserPlus className="size-4" />
        <h2 className="flex-1 truncate text-base font-bold">{t.visit.title}</h2>
        <Button variant="ghost" size="icon-sm" aria-label={t.visit.close} onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="overflow-y-auto p-3">
        {guest ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex items-end gap-1" aria-hidden="true">
              <Blobatar name={seed} size={48} />
              <Blobatar name={guest.seed} size={48} />
            </div>
            <p className="text-sm font-medium">
              {t.visit.staying(guest.name, new Intl.DateTimeFormat(language(), { weekday: "long", hour: "2-digit", minute: "2-digit" }).format(guest.until))}
            </p>
            <Button variant="outline" onClick={onFarewell}>
              {t.visit.farewell}
            </Button>
          </div>
        ) : !inGarden ? (
          <EmptyState face="sleepy" seed={seed} title={t.visit.noGarden}>
            {t.visit.noGardenText}
          </EmptyState>
        ) : (
          <form className="flex flex-col gap-2" onSubmit={invite}>
            <p className="text-sm text-muted-foreground">{t.visit.intro}</p>
            <input className="toon-input" aria-label={t.visit.pseudo} placeholder={t.visit.pseudo} maxLength={MAX_NAME_LENGTH} value={name} onChange={(e) => setName(e.target.value)} />
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? t.visit.inviting : t.visit.invite}
            </Button>
          </form>
        )}
      </div>
    </aside>
  );
}
