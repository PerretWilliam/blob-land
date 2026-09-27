import { MAX_NAME_LENGTH, type Identity } from "@blob-land/sim";
import { useState } from "react";
import { IdentityFields } from "@/components/blob-gender";
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
    <main className="flex min-h-screen items-center justify-center bg-background p-8">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-lg border p-6">
        <h1 className="text-xl font-semibold">Name your blob</h1>
        <p className="text-sm text-muted-foreground">
          This becomes your blob right away, on this device — no account, no network yet.
        </p>
        <input
          className="rounded-md border bg-transparent px-3 py-2 text-sm"
          placeholder="pseudo"
          maxLength={MAX_NAME_LENGTH}
          value={pseudo}
          onChange={(e) => setPseudo(e.target.value)}
          autoFocus
        />
        <IdentityFields value={identity} onChange={setIdentity} />
        <Button type="submit" disabled={!pseudo.trim()}>
          Continue
        </Button>
      </form>
    </main>
  );
}
