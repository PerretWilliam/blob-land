import { MAX_NAME_LENGTH, type Identity } from "@blob-land/sim";
import { useState } from "react";
import { IdentityFields } from "@/components/blob-gender";
import { normalizeSeed } from "blobatar";
import { MenuScreen } from "@/components/main-menu";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

export interface PseudoScreenProps {
  onChosen: (pseudo: string, identity: Identity) => void;
}

export function PseudoScreen({ onChosen }: PseudoScreenProps) {
  const [pseudo, setPseudo] = useState("");
  const [identity, setIdentity] = useState<Identity>({ sex: "none", attraction: "any" });
  const t = useT();
  const seed = normalizeSeed(pseudo.trim());

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pseudo.trim()) onChosen(pseudo.trim(), identity);
  }

  return (
    // The top blob of the stack is the one being named, as it's typed.
    <MenuScreen seed={seed}>
      <form onSubmit={submit} className="toon flex w-full flex-col gap-4 p-5">
        <h2 className="text-xl font-bold">{t.pseudo.title}</h2>
        <p className="text-sm text-muted-foreground">{t.pseudo.intro}</p>
        <input
          className="toon-input"
          placeholder={t.pseudo.placeholder}
          maxLength={MAX_NAME_LENGTH}
          value={pseudo}
          onChange={(e) => setPseudo(e.target.value)}
          autoFocus
        />
        <IdentityFields seed={seed || "blob"} value={identity} onChange={setIdentity} />
        <Button type="submit" size="lg" disabled={!pseudo.trim()}>
          {t.pseudo.next}
        </Button>
      </form>
    </MenuScreen>
  );
}
