import { MAX_GUESTS, MAX_NAME_LENGTH } from "@blob-land/sim";
import { Blobatar } from "@blobatar/react";
import { UserPlus, X } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { language, useT } from "@/i18n";
import { inviteGuest, sendGuestHome } from "@/lib/api";

/** Who's visiting the player's island, and inviting someone over: a player's blob, by pseudo. */
export function VisitPanel({
  seed,
  token,
  open,
  guests,
  onChanged,
  onClose,
}: {
  /** The player's blob's. */
  seed: string;
  /** Null without an account: visitors come from the garden. */
  token: string | null;
  /** Whether the island is on the server (online, the player's blob home). */
  open: boolean;
  guests: { seed: string; name: string; until: number }[];
  /** After an invitation or a goodbye: reads the island again. */
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const until = (at: number) => new Intl.DateTimeFormat(language(), { weekday: "long", hour: "2-digit", minute: "2-digit" }).format(at);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await inviteGuest(token!, name);
      await onChanged();
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
        {!token ? (
          <EmptyState face="sleepy" seed={seed} title={t.visit.noGarden}>
            {t.visit.noGardenText}
          </EmptyState>
        ) : !open ? (
          <EmptyState face="sad" seed={seed} title={t.common.noConnection}>
            {t.visit.offline}
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            {guests.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {guests.map((g) => (
                  <li key={g.seed} className="flex items-center gap-2 rounded-lg border-2 border-ink bg-white p-2">
                    <Blobatar name={g.seed} size={36} aria-hidden="true" />
                    <p className="flex-1 text-sm font-medium">{t.visit.staying(g.name, until(g.until))}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void sendGuestHome(token, g.seed).then(onChanged, () => {});
                      }}
                    >
                      {t.visit.farewell}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            {guests.length < MAX_GUESTS ? (
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
            ) : (
              <p className="text-sm text-muted-foreground">{t.visit.full}</p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
