import { MAX_NAME_LENGTH, type Identity } from "@blob-land/sim";
import { useState } from "react";
import { IdentityFields } from "@/components/blob-gender";
import { normalizeSeed } from "blobatar";
import { MenuScreen } from "@/components/main-menu";
import { Button } from "@/components/ui/button";

export interface PseudoScreenProps {
  onChosen: (pseudo: string, identity: Identity) => void;
}

export function PseudoScreen({ onChosen }: PseudoScreenProps) {
  const [pseudo, setPseudo] = useState("");
  const [identity, setIdentity] = useState<Identity>({ sex: "none", attraction: "any" });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pseudo.trim()) onChosen(pseudo.trim(), identity);
  }

  return (
    // The top blob of the stack is the one being named, as it's typed.
    <MenuScreen seed={normalizeSeed(pseudo.trim())}>
      <form onSubmit={submit} className="toon flex w-full flex-col gap-4 p-5">
        <h2 className="text-xl font-bold">Name your blob</h2>
        <p className="text-sm text-muted-foreground">
          This becomes your blob right away, on this device — no account, no network yet.
        </p>
        <input
          className="toon-input"
          placeholder="pseudo"
          maxLength={MAX_NAME_LENGTH}
          value={pseudo}
          onChange={(e) => setPseudo(e.target.value)}
          autoFocus
        />
        <IdentityFields value={identity} onChange={setIdentity} />
        <Button type="submit" size="lg" disabled={!pseudo.trim()}>
          Continue
        </Button>
      </form>
    </MenuScreen>
  );
}
