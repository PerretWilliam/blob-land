import { compatible, type Identity } from "@blob-land/sim";
import { Eye, EyeOff, Globe, HeartCrack, Settings, Trash2, TreePine, X } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { DressedBlob, IdentityFields } from "@/components/blob-gender";
import { CountryField } from "@/components/country-field";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { LANGUAGES, useT, type Language } from "@/i18n";

export interface SettingsScreenProps {
  /** The player's blob: its seed draws it, `name` is what it goes by. */
  seed: string;
  name: string;
  identity: Identity;
  onIdentityChange: (identity: Identity) => Promise<void>;
  /** Its other half in the garden, if any: told of before a change parts them. */
  partner: { name: string; identity: Identity } | null;
  account: { pseudo: string } | null;
  onJoin: () => void;
  country: string | null;
  onCountryChange: (country: string | null) => Promise<void>;
  visible: boolean;
  onVisibleChange: (visible: boolean) => Promise<void>;
  /** Resolves once the account is gone; rejects with a reason to show (a wrong password). */
  onDeleteAccount: (password: string) => Promise<void>;
  language: Language;
  onLanguageChange: (language: Language) => void;
  onClose: () => void;
}

type Tab = "blob" | "garden" | "language";

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Everything the player chooses, in one place over the scene: who their blob
 * is (its sex and who it falls for, drawn as it'll look), what the garden sees
 * of it, their account, and the app's language.
 */
export function SettingsScreen(props: SettingsScreenProps) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("blob");
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tabs: { id: Tab; icon: ReactNode }[] = [
    { id: "blob", icon: <DressedBlob seed={props.seed} sex={props.identity.sex} className="size-5" /> },
    { id: "garden", icon: <TreePine /> },
    { id: "language", icon: <Globe /> },
  ];
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="toon flex max-h-full w-full max-w-lg flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 rounded-t-[1rem] border-b-[3px] border-ink bg-sky px-3 py-2">
          <Settings className="size-4" />
          <h2 id="settings-title" className="flex-1 text-base font-bold">
            {t.settings.title}
          </h2>
          <Button variant="ghost" size="icon-sm" aria-label={t.settings.close} onClick={onClose} autoFocus>
            <X />
          </Button>
        </header>
        <nav role="tablist" className="flex gap-1.5 border-b-2 border-ink/15 p-2">
          {tabs.map(({ id, icon }) => (
            <Button key={id} role="tab" aria-selected={tab === id} variant={tab === id ? "secondary" : "ghost"} size="sm" className="flex-1" onClick={() => setTab(id)}>
              {icon}
              {t.settings.tabs[id]}
            </Button>
          ))}
        </nav>
        <div role="tabpanel" className="overflow-y-auto p-4">
          {tab === "blob" ? <BlobTab {...props} /> : tab === "garden" ? <GardenTab {...props} /> : <LanguageTab {...props} />}
        </div>
      </section>
    </div>
  );
}

function BlobTab({ seed, name, identity, onIdentityChange, partner, account }: SettingsScreenProps) {
  const t = useT();
  const [draft, setDraft] = useState(identity);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const changed = draft.sex !== identity.sex || draft.attraction !== identity.attraction;
  // Together now, and not drawn to each other any more once saved: the server parts them.
  const parts = partner !== null && compatible(identity, partner.identity) && !compatible(draft, partner.identity);

  async function save() {
    setState("saving");
    setError(null);
    try {
      await onIdentityChange(draft);
      setState("saved");
    } catch (e) {
      setError(why(e));
      setState("idle");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <DressedBlob seed={seed} sex={draft.sex} className="toon-outline size-24" />
        <div className="min-w-0">
          <p className="truncate text-xl font-bold">{name}</p>
          <p className="text-sm text-muted-foreground">{t.settings.look}</p>
        </div>
      </div>
      <IdentityFields
        seed={seed}
        value={draft}
        onChange={(next) => {
          setDraft(next);
          setState("idle");
        }}
      />
      {changed && parts ? (
        <p role="alert" className="flex items-start gap-2 rounded-xl border-2 border-ink bg-berry/25 px-3 py-2 text-sm font-medium">
          <HeartCrack className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t.settings.breakup(partner.name)}
        </p>
      ) : null}
      {account ? <p className="text-xs text-muted-foreground">{t.settings.alsoInGarden}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={!changed || state === "saving"} onClick={() => setDraft(identity)}>
          {t.settings.undo}
        </Button>
        <Button disabled={!changed || state === "saving"} onClick={save}>
          {state === "saved" && !changed ? t.settings.saved : t.settings.save}
        </Button>
      </div>
    </div>
  );
}

function GardenTab({ seed, account, onJoin, country, onCountryChange, visible, onVisibleChange, onDeleteAccount }: SettingsScreenProps) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const attempt = (change: Promise<void>) => {
    setError(null);
    change.catch((e: unknown) => setError(why(e)));
  };

  if (!account) {
    return (
      <EmptyState face="thinking" seed={seed} title={t.settings.notJoined} action={<Button onClick={onJoin}>{t.settings.join}</Button>}>
        {t.settings.notJoinedText}
      </EmptyState>
    );
  }
  const shown = [
    { value: true, icon: <Eye />, label: t.settings.visible, text: t.settings.visibleText },
    { value: false, icon: <EyeOff />, label: t.settings.hidden, text: t.settings.hiddenText },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t.settings.signedIn(<span className="font-bold text-ink">{account.pseudo}</span>)}</p>
      <CountryField value={country} onChange={(next) => attempt(onCountryChange(next))} />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="sr-only">{visible ? t.settings.visible : t.settings.hidden}</legend>
        {shown.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={visible === option.value}
            onClick={() => visible !== option.value && attempt(onVisibleChange(option.value))}
            className={`flex items-start gap-3 rounded-xl border-[2.5px] border-ink px-3 py-2 text-left transition-colors [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 ${visible === option.value ? "bg-sun shadow-[0_3px_0_var(--ink)]" : "bg-white hover:bg-accent"}`}
          >
            {option.icon}
            <span className="flex flex-col">
              <span className="text-sm font-semibold">{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.text}</span>
            </span>
          </button>
        ))}
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="border-t-2 border-ink/15 pt-4">
        {deleting ? (
          <DeleteAccount onDelete={onDeleteAccount} onCancel={() => setDeleting(false)} />
        ) : (
          <Button variant="outline" className="text-destructive" onClick={() => setDeleting(true)}>
            <Trash2 /> {t.settings.delete}
          </Button>
        )}
      </div>
    </div>
  );
}

function DeleteAccount({ onDelete, onCancel }: { onDelete: (password: string) => Promise<void>; onCancel: () => void }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onDelete(password);
    } catch (err) {
      setError(why(err));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border-2 border-destructive bg-destructive/10 p-3">
      <h3 className="flex items-center gap-2 font-bold">
        <Trash2 className="size-4" /> {t.settings.delete}
      </h3>
      <p className="text-sm">{t.settings.deleteText}</p>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-muted-foreground">{t.settings.password}</span>
        <input className="toon-input" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t.settings.cancel}
        </Button>
        <Button type="submit" variant="destructive" disabled={busy || !password}>
          {t.settings.confirmDelete}
        </Button>
      </div>
    </form>
  );
}

function LanguageTab({ language, onLanguageChange }: SettingsScreenProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t.settings.languageText}</p>
      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={t.settings.tabs.language}>
        {(Object.keys(LANGUAGES) as Language[]).map((code) => (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={language === code}
            lang={code}
            onClick={() => onLanguageChange(code)}
            className={`rounded-xl border-[2.5px] border-ink px-3 py-2 text-left font-semibold transition-colors ${language === code ? "bg-sun shadow-[0_3px_0_var(--ink)]" : "bg-white hover:bg-accent"}`}
          >
            {LANGUAGES[code].name}
          </button>
        ))}
      </div>
    </div>
  );
}
