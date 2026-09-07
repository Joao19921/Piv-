import { useState } from "react";
import type { AuthUser } from "@/App";
import { PivoMark } from "@/components/PivoMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Tela de troca obrigatória de senha (primeiro acesso). Bloqueia os módulos até a senha
 * ser trocada — o backend também recusa (403 password_change_required), isso é só a UI. */
export default function ChangePasswordPage({ user, onSuccess, onLogout }: { user: AuthUser; onSuccess: () => void; onLogout: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError("A nova senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("A confirmação não é igual à nova senha.");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Não foi possível trocar a senha.");
        return;
      }
      onSuccess();
    } catch {
      setError("Não foi possível conectar. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-shell relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0B151C] px-4 py-8 sm:px-6">
      <div className="absolute inset-0 bg-[url('/brand/tela-login.png')] bg-cover bg-center opacity-95" aria-hidden="true" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(11,21,28,0.1),rgba(11,21,28,0.62)_72%)]" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-sm rounded-[1rem] border border-white/10 bg-[#101A22]/82 p-5 shadow-[0_24px_80px_rgba(0,0,0,.36)] backdrop-blur-xl sm:p-6">
        <div className="mb-8 flex flex-col items-center text-center">
          <PivoMark size={48} />
          <p className="mt-4 font-display text-2xl font-semibold tracking-[-0.03em] text-white">Pivô</p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#8EC8C8]">strategic pricing</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-[0.75rem] border border-t-2 border-t-[#8DD9D9] border-white/12 bg-[#121D26]/78 p-6 shadow-[0_18px_50px_rgba(0,0,0,.25)] sm:p-7"
        >
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C2660D]">
            <span className="h-px w-6 bg-[#F57F17]" /> Primeiro acesso
          </div>
          <h1 className="mb-2 font-display text-xl font-semibold tracking-[-0.02em] text-white">Defina sua nova senha</h1>
          <p className="mb-6 text-xs leading-5 text-[#B7D3D3]">Olá, {user.name.split(" ")[0]}. Por segurança, troque a senha inicial antes de continuar.</p>

          <div className="mb-4">
            <Label htmlFor="current-password" className="text-xs font-semibold text-[#BFE3E3]">
              Senha atual
            </Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="mt-2 h-11 border-white/12 bg-white/8 text-sm text-white placeholder:text-white/40 focus-visible:ring-[#8DD9D9]/35"
              autoFocus
              autoComplete="current-password"
            />
          </div>
          <div className="mb-4">
            <Label htmlFor="new-password" className="text-xs font-semibold text-[#BFE3E3]">
              Nova senha
            </Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-2 h-11 border-white/12 bg-white/8 text-sm text-white placeholder:text-white/40 focus-visible:ring-[#8DD9D9]/35"
              autoComplete="new-password"
            />
            <p className="mt-1.5 text-[11px] text-[#879A9A]">Pelo menos 8 caracteres.</p>
          </div>
          <div className="mb-5">
            <Label htmlFor="confirm-password" className="text-xs font-semibold text-[#BFE3E3]">
              Confirmar nova senha
            </Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-2 h-11 border-white/12 bg-white/8 text-sm text-white placeholder:text-white/40 focus-visible:ring-[#8DD9D9]/35"
              autoComplete="new-password"
            />
          </div>

          {error && (
            <p className="mb-4 rounded-lg border border-[#EECFAB] bg-[#FBEFE1] px-3 py-2 text-xs text-[#B0712A]">{error}</p>
          )}

          <Button
            type="submit"
            disabled={isSubmitting || !currentPassword || !newPassword || !confirmPassword}
            className="pressable h-11 w-full rounded-full bg-[#F57F17] text-sm font-semibold text-white hover:bg-[#D96D0C]"
          >
            {isSubmitting ? "Salvando..." : "Salvar nova senha"}
          </Button>
        </form>

        <button onClick={onLogout} className="mt-6 w-full text-center text-[11px] leading-5 text-[#8EC8C8] hover:text-white">
          Sair e entrar com outra conta
        </button>
      </div>
    </div>
  );
}
