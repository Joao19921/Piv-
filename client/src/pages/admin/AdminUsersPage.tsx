import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Plus, ShieldCheck, UserCog, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useActivateUser, useCreateUser, useDeactivateUser, useUpdateUser, useUsers } from "@/hooks/useUsers";
import type { CreateUserResponse, ManagedUser, PermissionCode, SaveUserParams } from "@/lib/api";

const PERMISSION_LABELS: Record<PermissionCode, string> = {
  LABOR: "Mão de obra",
  INFRA: "Infra cloud",
  LICENSES: "Licenças",
};
const ALL_PERMISSIONS: PermissionCode[] = ["LABOR", "INFRA", "LICENSES"];

export default function AdminUsersPage() {
  const { data: users, isLoading } = useUsers();
  const [editing, setEditing] = useState<ManagedUser | "new" | null>(null);
  const [created, setCreated] = useState<CreateUserResponse | null>(null);
  const activateUser = useActivateUser();
  const deactivateUser = useDeactivateUser();

  const handleToggleStatus = (user: ManagedUser) => {
    const action = user.status === "ACTIVE" ? deactivateUser : activateUser;
    const verb = user.status === "ACTIVE" ? "Desativando" : "Ativando";
    toast.promise(action.mutateAsync(user.id), {
      loading: `${verb} usuário...`,
      success: user.status === "ACTIVE" ? "Usuário desativado." : "Usuário reativado.",
      error: (err) => (err instanceof Error ? err.message : "Não foi possível concluir agora."),
    });
  };

  return (
    <div>
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C2660D]">
            <span className="h-px w-6 bg-[#F57F17]" /> Administração
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-[-0.04em] text-[#333333] sm:text-[40px]">Usuários</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#658080]">Controle quem acessa cada módulo — perfil ADMIN tem acesso total; USER depende das permissões marcadas.</p>
        </div>
        <Button onClick={() => setEditing("new")} className="pressable h-10 rounded-full bg-[#F57F17] px-5 text-xs font-semibold text-white hover:bg-[#D96D0C]">
          <Plus className="mr-2 h-4 w-4" /> Novo usuário
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
      ) : !users || users.length === 0 ? (
        <Card className="rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-10 text-center shadow-paper">
          <UserCog className="mx-auto h-10 w-10 text-[#9EB4B4]" />
          <h2 className="mt-4 font-display text-xl font-semibold text-[#333333]">Nenhum usuário cadastrado</h2>
        </Card>
      ) : (
        <Card className="overflow-hidden rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] shadow-paper">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#E8E9E9] text-[10px] uppercase tracking-[0.14em] text-[#7B8F8F]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Nome</th>
                  <th className="px-4 py-3 font-semibold">E-mail</th>
                  <th className="px-4 py-3 font-semibold">Perfil</th>
                  <th className="px-4 py-3 font-semibold">Mão de obra</th>
                  <th className="px-4 py-3 font-semibold">Infra cloud</th>
                  <th className="px-4 py-3 font-semibold">Licenças</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const fullAccess = user.role === "ADMIN";
                  return (
                    <tr key={user.id} className="border-t border-[#E5E0D6] bg-white/50">
                      <td className="px-4 py-3 font-semibold text-[#333333]">{user.name}</td>
                      <td className="px-4 py-3 text-[#658080]">{user.email}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={`rounded-full px-2 py-0.5 text-[10px] ${user.role === "ADMIN" ? "border-[#F0C48A] bg-[#FAEFE2] text-[#C2660D]" : "border-[#D4D1CC] bg-white text-[#667C7C]"}`}>{user.role}</Badge>
                      </td>
                      {ALL_PERMISSIONS.map((code) => (
                        <td key={code} className="px-4 py-3 text-center">
                          {fullAccess || user.permissions.includes(code) ? <Check className="mx-auto h-4 w-4 text-[#4F8A82]" /> : <span className="text-[#B8C2C2]">—</span>}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={`rounded-full px-2 py-0.5 text-[10px] ${user.status === "ACTIVE" ? "border-[#BDD3D0] bg-[#EBECEC] text-[#3F746D]" : "border-[#EECFAB] bg-[#FBEFE1] text-[#B0712A]"}`}>{user.status === "ACTIVE" ? "Ativo" : "Inativo"}</Badge>
                        {user.mustChangePassword && <span className="ml-1.5 text-[10px] text-[#899A9A]">1º acesso pendente</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => setEditing(user)} className="rounded-full border border-[#D4D1CC] px-2.5 py-1 text-[11px] font-semibold text-[#345555] hover:bg-white">Editar</button>
                          <button onClick={() => handleToggleStatus(user)} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${user.status === "ACTIVE" ? "text-[#B0712A] hover:bg-[#FBEFE1]" : "text-[#3F746D] hover:bg-[#EBECEC]"}`}>
                            {user.status === "ACTIVE" ? "Desativar" : "Ativar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editing && <UserFormModal user={editing === "new" ? null : editing} onClose={() => setEditing(null)} onCreated={(res) => { setEditing(null); setCreated(res); }} />}
      {created && <CreatedUserSuccess result={created} onClose={() => setCreated(null)} />}
    </div>
  );
}

function UserFormModal({ user, onClose, onCreated }: { user: ManagedUser | null; onClose: () => void; onCreated: (result: CreateUserResponse) => void }) {
  const isEdit = Boolean(user);
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "USER">(user?.role ?? "USER");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">(user?.status ?? "ACTIVE");
  const [permissions, setPermissions] = useState<PermissionCode[]>(user?.permissions ?? []);
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const isPending = createUser.isPending || updateUser.isPending;

  const togglePermission = (code: PermissionCode) => {
    setPermissions((current) => (current.includes(code) ? current.filter((c) => c !== code) : [...current, code]));
  };

  const handleSubmit = async () => {
    if (!name.trim() || !email.trim()) {
      toast.error("Nome e e-mail são obrigatórios.");
      return;
    }
    const params: SaveUserParams = { name: name.trim(), email: email.trim(), role, status, permissions };

    if (isEdit) {
      toast.promise(updateUser.mutateAsync({ id: user!.id, ...params }), {
        loading: "Salvando alterações...",
        success: () => {
          onClose();
          return "Usuário atualizado.";
        },
        error: (err) => (err instanceof Error ? err.message : "Não foi possível salvar agora."),
      });
      return;
    }

    if (password.length < 8) {
      toast.error("A senha inicial precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("A confirmação não é igual à senha inicial.");
      return;
    }
    try {
      const result = await toast.promise(createUser.mutateAsync({ ...params, password, confirmPassword }), {
        loading: "Criando usuário...",
        success: "Usuário criado.",
        error: (err) => (err instanceof Error ? err.message : "Não foi possível criar agora."),
      }).unwrap();
      onCreated(result);
    } catch {
      // erro ja mostrado pelo toast.promise
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D5C5C]/40 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C2660D]">Dados do usuário</p>
            <h2 className="mt-1 font-display text-xl font-semibold text-[#333333]">{isEdit ? "Editar usuário" : "Novo usuário"}</h2>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-[#7E9393] hover:bg-[#E8E9E9]" aria-label="Fechar"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <Label className="text-xs font-semibold text-[#345555]">Nome completo</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-2 h-10 border-[#D4D1CC] bg-white text-sm text-[#333333]" />
          </div>
          <div>
            <Label className="text-xs font-semibold text-[#345555]">E-mail</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 h-10 border-[#D4D1CC] bg-white text-sm text-[#333333]" />
          </div>

          {!isEdit && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-xs font-semibold text-[#345555]">Senha inicial</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 h-10 border-[#D4D1CC] bg-white text-sm text-[#333333]" />
              </div>
              <div>
                <Label className="text-xs font-semibold text-[#345555]">Confirmar senha</Label>
                <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-2 h-10 border-[#D4D1CC] bg-white text-sm text-[#333333]" />
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-xs font-semibold text-[#345555]">Perfil</Label>
              <select value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "USER")} className="mt-2 h-10 w-full rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20">
                <option value="USER">Usuário</option>
                <option value="ADMIN">Administrador</option>
              </select>
            </div>
            <div>
              <Label className="text-xs font-semibold text-[#345555]">Status</Label>
              <select value={status} onChange={(e) => setStatus(e.target.value as "ACTIVE" | "INACTIVE")} className="mt-2 h-10 w-full rounded-md border border-[#D4D1CC] bg-white px-3 text-sm text-[#333333] outline-none focus:border-[#F57F17] focus:ring-2 focus:ring-[#F57F17]/20">
                <option value="ACTIVE">Ativo</option>
                <option value="INACTIVE">Inativo</option>
              </select>
            </div>
          </div>

          <div className="rounded-xl border border-[#E5E0D6] bg-white/55 p-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C2660D]">Módulos permitidos</p>
            <div className="mb-3 flex items-center gap-2 text-xs text-[#345555]">
              <ShieldCheck className="h-3.5 w-3.5 text-[#4F8A82]" /> Visão geral — liberado para qualquer usuário autenticado
            </div>
            {role === "ADMIN" ? (
              <p className="text-xs text-[#899A9A]">Perfil ADMIN tem acesso completo a todos os módulos automaticamente.</p>
            ) : (
              <div className="space-y-2">
                {ALL_PERMISSIONS.map((code) => (
                  <label key={code} className="flex items-center gap-2 text-xs text-[#345555]">
                    <Checkbox checked={permissions.includes(code)} onCheckedChange={() => togglePermission(code)} />
                    {PERMISSION_LABELS[code]}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button onClick={onClose} variant="outline" className="rounded-full border-[#C9C6C2] bg-transparent text-xs text-[#333333] hover:bg-white">Cancelar</Button>
          <Button onClick={handleSubmit} disabled={isPending} className="pressable rounded-full bg-[#F57F17] px-5 text-xs font-semibold text-white hover:bg-[#D96D0C]">{isEdit ? "Salvar alterações" : "Criar usuário"}</Button>
        </div>
      </Card>
    </div>
  );
}

function CreatedUserSuccess({ result, onClose }: { result: CreateUserResponse; onClose: () => void }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.initialPassword);
      toast.success("Senha copiada.");
    } catch {
      toast.error("Não foi possível copiar automaticamente — selecione o texto manualmente.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D5C5C]/40 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-sm rounded-2xl border-[#DDD7CC] bg-[#FBF7F1] p-6 text-center shadow-2xl">
        <ShieldCheck className="mx-auto h-10 w-10 text-[#4F8A82]" />
        <h2 className="mt-4 font-display text-xl font-semibold text-[#333333]">Usuário criado com sucesso</h2>
        <p className="mt-2 text-xs leading-5 text-[#658080]">Compartilhe essa senha inicial com o usuário agora — depois de fechar, ela não pode mais ser recuperada.</p>

        <div className="mt-5 rounded-xl border border-[#E5E0D6] bg-white/55 p-4 text-left">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#899A9A]">E-mail</p>
          <p className="mt-1 text-sm font-semibold text-[#333333]">{result.email}</p>
          <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#899A9A]">Senha inicial</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <code className="text-sm font-semibold text-[#333333]">{result.initialPassword}</code>
            <button onClick={handleCopy} className="flex items-center gap-1.5 rounded-full border border-[#F0C48A] px-2.5 py-1 text-[11px] font-semibold text-[#C2660D] hover:bg-white"><Copy className="h-3.5 w-3.5" /> Copiar senha</button>
          </div>
        </div>

        <p className="mt-4 text-[11px] text-[#899A9A]">O usuário será obrigado a trocar essa senha no primeiro login.</p>
        <Button onClick={onClose} className="pressable mt-5 w-full rounded-full bg-[#F57F17] text-sm font-semibold text-white hover:bg-[#D96D0C]">Concluir</Button>
      </Card>
    </div>
  );
}
