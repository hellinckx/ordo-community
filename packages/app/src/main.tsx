import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import "@fontsource-variable/geist";
import "./styles.css";
import App from "./App";
import { startUpdateChecks } from "./services/updates";
import { setupInstall } from "./lib/install";

// the install prompt on Android fires early – catch it before React renders
setupInstall();

// Theme bootstrap before first paint (avoids flash); real preference is applied after unlock.
try {
  const stored = localStorage.getItem("summa.theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = stored === "dark" || (stored !== "light" && prefersDark) ? "dark" : "light";
} catch {
  /* ignore */
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);

// Desktop updater or PWA service worker, depending on the platform
startUpdateChecks();
