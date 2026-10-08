/**
 * ui/SettingsModal.tsx — connection settings.
 *
 * Two ways to authenticate, matching the two real bootstrap paths:
 *   1. Paste an existing ETAPI token (created in the Trilium web UI under
 *      Options → ETAPI).
 *   2. Paste the instance password — we mint a token ourselves via
 *      POST /etapi/auth/login. (Note Trilium's 429: too many failed logins
 *      briefly blacklists the client IP, so this button is deliberate, not
 *      a retry loop.)
 *
 * The token is stored in localStorage (documented trade-off, see README).
 * Save also probes app-info first so a broken config never lands silently.
 */

import { useState } from "react";
import { DEFAULT_ROOT_NOTE_ID } from "../config";
import { TriliumClient } from "../lib/trilium/client";
import { getState } from "../state/store";
import { applySettings } from "../App";

export function SettingsModal(props: {
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const existing = getState().settings;
  // VITE_* vars (see .env.example) seed the fields on first run only.
  const [serverUrl, setServerUrl] = useState(
    existing?.serverUrl ?? import.meta.env.VITE_TRILIUM_URL ?? "http://localhost:31090",
  );
  const [token, setToken] = useState(existing?.token ?? import.meta.env.VITE_TRILIUM_TOKEN ?? "");
  const [password, setPassword] = useState("");
  const [rootNoteId, setRootNoteId] = useState(existing?.rootNoteId ?? DEFAULT_ROOT_NOTE_ID);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const saveAndTest = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const probe = new TriliumClient({ baseUrl: serverUrl, token: token || undefined });
      let finalToken = token;
      if (!finalToken) {
        if (!password) throw new Error("Enter an ETAPI token or the instance password.");
        finalToken = await probe.login(password);
      }
      // Validate with the final credentials before persisting anything.
      const check = new TriliumClient({ baseUrl: serverUrl, token: finalToken });
      await check.getAppInfo();
      applySettings({ serverUrl: serverUrl.trim(), token: finalToken, rootNoteId: rootNoteId.trim() || DEFAULT_ROOT_NOTE_ID });
      props.onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <section
        className="modal settings-modal"
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Connect to Trilium</h2>
          <button onClick={props.onClose} title="Close">✕</button>
        </header>
        <p className="dim-line">
          The app talks straight to your Trilium's ETAPI. Cross-origin access must be
          allowed by the server (<code>TRILIUM_NETWORK_CORS_ALLOW_ORIGIN</code>, since
          v0.93.0). The compose.yml mock sets this for you.
        </p>
        <label className="field">
          <span>Server URL</span>
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://localhost:31090"
          />
        </label>
        <label className="field">
          <span>ETAPI token (optional if you give the password)</span>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="from Options → ETAPI"
          />
        </label>
        <label className="field">
          <span>Instance password (mints a token via /auth/login)</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder=""
          />
        </label>
        <label className="field">
          <span>Library root note id (default: root)</span>
          <input
            value={rootNoteId}
            onChange={(e) => setRootNoteId(e.target.value)}
            placeholder={DEFAULT_ROOT_NOTE_ID}
          />
        </label>
        {error && <p className="error-line">{error}</p>}
        <div className="modal-actions">
          <button onClick={() => void saveAndTest()} disabled={busy}>
            {busy ? "testing…" : "test & save"}
          </button>
          <button onClick={props.onClose}>cancel</button>
        </div>
        <p className="dim-line small">
          Stored in this browser only (localStorage). Anyone with this browser profile
          can read the token — see the README's security notes.
        </p>
      </section>
    </div>
  );
}