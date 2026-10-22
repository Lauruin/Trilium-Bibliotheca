/**
 * main.tsx — entry point. React overlay mounts on #root; the Phaser canvas
 * host (#game-host) is owned by App's mount effect.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./ui/styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root missing from index.html");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
// Installable PWA (enables the share target). Production only: a worker under
// the dev server would just get in the way of HMR.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch((err) => {
    console.warn("[pwa] service worker registration failed:", err);
  });
}
