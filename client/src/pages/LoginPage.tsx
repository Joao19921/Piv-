import { useState } from "react";
import { PivoMark } from "@/components/PivoMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Usuario ou senha invalidos.");
        return;
      }
      onSuccess();
    } catch {
      setError("Nao foi possivel conectar. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grain paper-grid flex min-h-screen items-center justify-center bg-[#E8E9E9] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <PivoMark size={48} />
          <p className="mt-4 font-display text-2xl font-semibold tracking-[-0.03em] text-[#333333]">Pivô</p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#879A9A]">strategic pricing</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-[0.75rem] border border-t-2 border-t-[#0D5C5C] border-[#DDD7CC] bg-[#FBF7F1] p-7 shadow-paper"
        >
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C2660D]">
            <span className="h-px w-6 bg-[#F57F17]" /> Acesso restrito
          </div>
          <h1 className="mb-6 font-display text-xl font-semibold tracking-[-0.02em] text-[#333333]">Entrar no ambiente de testes</h1>

          <div className="mb-4">
            <Label htmlFor="username" className="text-xs font-semibold text-[#345555]">
              Usuario
            </Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-2 h-11 border-[#D4D1CC] bg-white text-sm text-[#333333]"
              autoFocus
              autoComplete="username"
            />
          </div>
          <div className="mb-5">
            <Label htmlFor="password" className="text-xs font-semibold text-[#345555]">
              Senha
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-2 h-11 border-[#D4D1CC] bg-white text-sm text-[#333333]"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p className="mb-4 rounded-lg border border-[#EECFAB] bg-[#FBEFE1] px-3 py-2 text-xs text-[#B0712A]">{error}</p>
          )}

          <Button
            type="submit"
            disabled={isSubmitting || !username || !password}
            className="pressable h-11 w-full rounded-full bg-[#F57F17] text-sm font-semibold text-white hover:bg-[#D96D0C]"
          >
            {isSubmitting ? "Entrando..." : "Entrar"}
          </Button>
        </form>

        <p className="mt-6 text-center text-[11px] leading-5 text-[#879A9A]">Da fonte dispersa à decisão defensável.</p>
      </div>
    </div>
  );
}
