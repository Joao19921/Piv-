/* Observatório Operacional: shell do produto com foco em clareza, estados explícitos e navegação persistente. */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ChangePasswordPage from "@/pages/ChangePasswordPage";
import LoginPage from "@/pages/LoginPage";
import NotFound from "@/pages/NotFound";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";
import { toast } from "sonner";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { SESSION_EXPIRED_EVENT } from "./lib/sessionGuard";
import Home from "./pages/Home";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export type SectionId = "dashboard" | "labor" | "cloud" | "licenses" | "sources" | "admin-users";
export type PermissionCode = "LABOR" | "INFRA" | "LICENSES";

/** Caminhos reais por secao — cada modulo tem URL propria (favoritar, compartilhar, voltar funcionam). */
export const SECTION_PATHS: Record<SectionId, string> = {
  dashboard: "/",
  labor: "/mao-de-obra",
  cloud: "/infra-cloud",
  licenses: "/licencas",
  sources: "/fontes",
  "admin-users": "/administracao/usuarios",
};

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <Home section="dashboard" />} />
      <Route path="/mao-de-obra" component={() => <Home section="labor" />} />
      <Route path="/infra-cloud" component={() => <Home section="cloud" />} />
      <Route path="/licencas" component={() => <Home section="licenses" />} />
      <Route path="/fontes" component={() => <Home section="sources" />} />
      <Route path="/administracao/usuarios" component={() => <Home section="admin-users" />} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

type AuthStatus = "loading" | "authenticated" | "required";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "USER";
  status: "ACTIVE" | "INACTIVE";
  mustChangePassword: boolean;
  permissions: PermissionCode[];
}

interface AuthContextValue {
  user: AuthUser | null;
  logout: () => void;
  refreshSession: () => void;
}

const AuthContext = createContext<AuthContextValue>({ user: null, logout: () => {}, refreshSession: () => {} });
export const useAuth = () => useContext(AuthContext);

/** ADMIN sempre tem acesso; USER depende da lista de permissoes. Espelha hasPermission() do backend. */
export function hasPermission(user: AuthUser | null, code: PermissionCode): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  return user.permissions.includes(code);
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  const checkSession = () => {
    fetch("/api/v1/auth/session")
      .then((res) => res.json())
      .then((data: { authenticated: boolean; user: AuthUser | null }) => {
        setUser(data.user);
        setStatus(data.authenticated ? "authenticated" : "required");
      })
      // Se a rota falhar por algum motivo, não trava o acesso: essa checagem é só uma
      // conveniência visual sobre um gate que já é reforçado no backend.
      .catch(() => setStatus("authenticated"));
  };

  const logout = () => {
    fetch("/api/v1/auth/logout", { method: "POST" }).finally(() => {
      setUser(null);
      setStatus("required");
    });
  };

  useEffect(() => {
    checkSession();
  }, []);

  useEffect(() => {
    // Qualquer 401 fora do /auth/login (ver sessionGuard.ts) significa que a sessão foi
    // invalidada no meio do uso (deploy sem SESSION_SECRET persistente, expiração, usuário
    // desativado) — sem isso, as telas ficavam repetindo a chamada e mostrando erro genérico
    // em loop, sem nunca voltar pro login.
    const handleSessionExpired = () => {
      setUser((current) => {
        if (!current) return current;
        toast.error("Sua sessão expirou. Faça login novamente.");
        return null;
      });
      setStatus((current) => (current === "authenticated" ? "required" : current));
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  if (status === "loading") return <div className="min-h-screen bg-[#F0EBE1]" />;
  if (status === "required" || !user) return <LoginPage onSuccess={checkSession} />;
  if (user.mustChangePassword) return <ChangePasswordPage user={user} onSuccess={checkSession} onLogout={logout} />;
  return <AuthContext.Provider value={{ user, logout, refreshSession: checkSession }}>{children}</AuthContext.Provider>;
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="light" switchable>
          <TooltipProvider>
            <Toaster position="bottom-right" />
            <AuthGate>
              <Router />
            </AuthGate>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
