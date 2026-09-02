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

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
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
      // Se a rota falhar por algum motivo, nao trava o acesso: essa checagem e so uma
      // conveniencia visual sobre um gate que ja e reforçado no backend.
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
