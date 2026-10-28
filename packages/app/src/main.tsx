import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import "@fontsource-variable/geist";
import "./styles.css";
import App from "./App";
import { startUpdateChecks } from "./services/updates";
import { setThemeColor, setupInstall } from "./lib/install";
import { setupLeaveGuard } from "./lib/leaveGuard";

// the install prompt on Android fires early – catch it before React renders
setupInstall();
// no reload or close while invoices are read, without asking first (Atlas continues by itself after a reload)
setupLeaveGuard();

// Theme bootstrap before first paint (avoids flash); real preference is applied after unlock.
try {
  const stored = localStorage.getItem("summa.theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = stored === "dark" || (stored !== "light" && prefersDark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  setThemeColor(dark);
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
