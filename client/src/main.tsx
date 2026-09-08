import { createRoot } from "react-dom/client";
import App from "./App";
import { installSessionGuard } from "./lib/sessionGuard";
import "./index.css";

installSessionGuard();
createRoot(document.getElementById("root")!).render(<App />);
