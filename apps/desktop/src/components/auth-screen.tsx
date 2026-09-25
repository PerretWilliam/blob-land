import { useState } from "react";
import { Button } from "@/components/ui/button";
import { login, register, type AuthResponse } from "@/lib/api";

export interface AuthScreenProps {
  onAuthenticated: (pseudo: string, response: AuthResponse) => void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [pseudo, setPseudo] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await (mode === "login" ? login : register)(pseudo, password);
      onAuthenticated(pseudo, response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-8">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-lg border p-6">
        <h1 className="text-xl font-semibold">{mode === "login" ? "Welcome back" : "Create your blob"}</h1>
        <input
          className="rounded-md border bg-transparent px-3 py-2 text-sm"
          placeholder="pseudo"
          value={pseudo}
          onChange={(e) => setPseudo(e.target.value)}
          autoFocus
        />
        <input
          className="rounded-md border bg-transparent px-3 py-2 text-sm"
          placeholder="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={pending}>
          {mode === "login" ? "Log in" : "Register"}
        </Button>
        <button
          type="button"
          className="text-sm text-muted-foreground underline"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login" ? "New here? Register instead" : "Already have a blob? Log in"}
        </button>
      </form>
    </main>
  );
}
