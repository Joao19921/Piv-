/* Observatório Operacional: shell do produto com foco em clareza, estados explícitos e navegação persistente. */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import LoginPage from "@/pages/LoginPage";
import NotFound from "@/pages/NotFound";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export type SectionId = "dashboard" | "labor" | "cloud" | "licenses" | "sources";

/** Caminhos reais por secao — cada modulo tem URL propria (favoritar, compartilhar, voltar funcionam). */
export const SECTION_PATHS: Record<SectionId, string> = {
  dashboard: "/",
  labor: "/mao-de-obra",
  cloud: "/infra-cloud",
  licenses: "/licencas",
  sources: "/fontes",
};

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <Home section="dashboard" />} />
      <Route path="/mao-de-obra" component={() => <Home section="labor" />} />
      <Route path="/infra-cloud" component={() => <Home section="cloud" />} />
      <Route path="/licencas" component={() => <Home section="licenses" />} />
      <Route path="/fontes" component={() => <Home section="sources" />} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

type AuthStatus = "loading" | "authenticated" | "required";

interface AuthContextValue {
  username: string | null;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({ username: null, logout: () => {} });
export const useAuth = () => useContext(AuthContext);

function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [username, setUsername] = useState<string | null>(null);

  const checkSession = () => {
    fetch("/api/v1/auth/session")
      .then((res) => res.json())
      .then((data: { authenticated: boolean; required: boolean; username: string | null }) => {
        setUsername(data.username);
        setStatus(!data.required || data.authenticated ? "authenticated" : "required");
      })
      // Se a rota falhar por algum motivo, não trava o acesso: essa checagem é só uma
      // conveniência visual sobre um gate que já é reforçado no backend.
      .catch(() => setStatus("authenticated"));
  };

  const logout = () => {
    fetch("/api/v1/auth/logout", { method: "POST" }).finally(() => {
      setUsername(null);
      setStatus("required");
    });
  };

  useEffect(() => {
    checkSession();
  }, []);

  if (status === "loading") return <div className="min-h-screen bg-[#F0EBE1]" />;
  if (status === "required") return <LoginPage onSuccess={checkSession} />;
  return <AuthContext.Provider value={{ username, logout }}>{children}</AuthContext.Provider>;
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="light">
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
