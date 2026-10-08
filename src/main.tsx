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