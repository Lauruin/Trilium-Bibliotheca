/**
 * ui/BuildPanel.tsx — build mode (B): change how this room looks. Five tabs —
 * Theme, Wall, Floor, Rug, Case — each edits ONE biblio_* label (Wall also has the extra-wall span). Changes preview live
 * in the world and are saved only on Enter (one undoable label write each; Z
 * undoes them one by one), Esc cancels everything.
 *
 * Keys: Tab next tab · Enter apply · Esc cancel · 0 reset the tab's label ·
 *   Theme: 1–7 pick, S room↔wing scope · Wall/Floor: ←/→ select slot, [ ] cycle
 *   its kind, Wall +/− extra wall · Rug/Case: 1–4 pick · Shift+Tab previous tab.
 */

import { useEffect, useMemo, useState } from "react";
import { LABELS } from "../config";
import { bus } from "../game/events";
import {
  AUTO, CASE_STYLES, EMPTY, FLOOR_OPTIONS, MAX_SPAN, RUG_STYLES, WALL_OPTIONS, cycle, parseCase, parseCsv, parseRug, parseSpan, slotsOf, toCsv,
} from "../game/decor";
import { THEMES, resolveTheme, wingRoomCount } from "../game/themes";
import { LabelConflictError } from "../lib/labels";
import { commitLabel } from "../lib/worldedit";
import { getClient, getState, notify, useAppStore } from "../state/store";
import type { LibraryTree } from "../types";

type Tab = "theme" | "wall" | "floor" | "rug" | "case";
type Scope = "room" | "wing";
const TABS: Tab[] = ["theme", "wall", "floor", "rug", "case"];
const MAX_FLOOR_SLOTS = 8;

/** Theme that would show if `names` were removed from the room (used to avoid writing defaults). */
function themeWithout(tree: LibraryTree, roomId: string, names: string[]) {
  const note = tree.notes[roomId];
  const saved = names.map((n) => [n, note.labels[n]] as const);
  for (const n of names) delete note.labels[n];
  try {
    return resolveTheme(tree, roomId);
  } finally {
    for (const [n, v] of saved) if (v !== undefined) note.labels[n] = v;
  }
}

const LABEL_TEXT: Record<string, string> = {
  [LABELS.theme]: "Theme",
  [LABELS.wing]: "Wing theme",
  [LABELS.wall]: "Wall decor",
  [LABELS.furniture]: "Furniture",
  [LABELS.rug]: "Rug",
  [LABELS.bookcase]: "Bookcase finish",
  [LABELS.span]: "Wall span",
};

export function BuildPanel(props: { roomId: string; onClose: () => void }): React.JSX.Element {
  const state = useAppStore();
  const tree = state.tree!;
  const room = tree.notes[props.roomId];
  const [tab, setTab] = useState<Tab>("theme");
  const [scope, setScope] = useState<Scope>("room");
  /** label name → new value (null = remove). Nothing here is saved until Enter. */
  const [pending, setPending] = useState<Record<string, string | null>>({});
  const [slot, setSlot] = useState(0);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState({ wallSlots: 3, floorFit: 3, floorHidden: 0 });

  useEffect(() => bus.on("build:slots", (s) => s.roomId === props.roomId && setInfo(s)), [props.roomId]);

  const current = useMemo(() => resolveTheme(tree, props.roomId), [tree, props.roomId]);
  const wingCount = useMemo(() => wingRoomCount(tree, props.roomId), [tree, props.roomId]);
  const themeLabel = scope === "room" ? LABELS.theme : LABELS.wing;

  /** Value of a label as it would be after Enter (pending wins over the saved one). */
  const valueOf = (name: string): string | undefined => {
    if (name in pending) return pending[name] ?? undefined;
    return room?.labels[name];
  };
  const set = (name: string, value: string | null): void => setPending((p) => ({ ...p, [name]: value }));

  // Live preview of everything pending (never saved).
  useEffect(() => {
    bus.emit("build:preview", { labels: Object.keys(pending).length > 0 ? pending : null });
  }, [pending]);

  const cancel = (): void => {
    bus.emit("build:preview", { labels: null });
    props.onClose();
  };

  const apply = async (): Promise<void> => {
    const client = getClient();
    const entries = Object.entries(pending);
    if (!client || busy) return;
    if (entries.length === 0) return cancel();
    setBusy(true);
    const roomId = props.roomId; // the room this panel was opened for (never the "current" one)
    const remaining = { ...pending };
    let written = 0;
    try {
      bus.emit("build:preview", { labels: null }); // the committed labels take over the same drawing
      for (const [name, wanted] of entries) {
        let value = wanted;
        // Never write a theme that equals what the room shows without the label. For
        // the wing label, a room's own theme must not shadow the comparison.
        if (value !== null && (name === LABELS.theme || name === LABELS.wing)) {
          const without = name === LABELS.wing ? [LABELS.wing, LABELS.theme] : [name];
          if (themeWithout(tree, roomId, without).id === value) value = null;
        }
        const cached = getState().tree?.notes[roomId]?.labels[name] ?? null;
        if (cached === value) {
          delete remaining[name]; // unchanged
          continue;
        }
        await commitLabel(client, getState().tree ?? tree, roomId, name, value, `${LABEL_TEXT[name] ?? name}${value === null ? " reset" : ""}`, cached);
        delete remaining[name];
        written++;
      }
      notify("info", written === 0 ? "Nothing changed." : `${written} change${written === 1 ? "" : "s"} saved · Z undoes the last`);
      props.onClose();
    } catch (err) {
      // Keep what was NOT saved (and its preview) so the user can retry or cancel.
      setPending(remaining);
      bus.emit("build:preview", { labels: Object.keys(remaining).length > 0 ? remaining : null });
      const saved = written > 0 ? ` (${written} already saved — Z undoes)` : "";
      notify(
        "error",
        err instanceof LabelConflictError
          ? `${LABEL_TEXT[err.name] ?? err.name} was changed elsewhere — press refresh, then try again${saved}`
          : `Could not save: ${err instanceof Error ? err.message : String(err)}${saved}`,
      );
      setBusy(false);
    }
  };

  // --- tab-specific editing ---------------------------------------------------
  const wallSlots = slotsOf(valueOf(LABELS.wall), info.wallSlots).slice(0, info.wallSlots);
  const floorEntries = parseCsv(valueOf(LABELS.furniture));
  const floorCount = Math.min(MAX_FLOOR_SLOTS, Math.max(floorEntries.length, info.floorFit) + 1);
  const floorSlots = slotsOf(valueOf(LABELS.furniture), floorCount);
  const rug = parseRug(valueOf(LABELS.rug));
  const bookcase = parseCase(valueOf(LABELS.bookcase));
  const span = parseSpan(valueOf(LABELS.span));
  const setSpan = (n: number): void => set(LABELS.span, n <= 0 ? null : String(Math.min(MAX_SPAN, n)));

  const editSlot = (name: string, slots: string[], options: readonly string[], dir: 1 | -1): void => {
    const next = [...slots];
    const i = Math.min(slot, next.length - 1); // the slot count can shrink after a redraw
    next[i] = cycle(options, options.includes(next[i]) ? next[i] : AUTO, dir);
    set(name, toCsv(next));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Escape") return cancel();
      if (e.key === "Enter") {
        e.preventDefault();
        return void apply();
      }
      if (e.key === "Tab") {
        e.preventDefault(); // scene capture is off, so the browser would move focus
        setSlot(0);
        return setTab((t) => TABS[(TABS.indexOf(t) + (e.shiftKey ? TABS.length - 1 : 1)) % TABS.length]);
      }
      const k = e.key.toLowerCase();
      if (k === "0") {
        const name = tab === "theme" ? themeLabel : tab === "wall" ? LABELS.wall : tab === "floor" ? LABELS.furniture : tab === "rug" ? LABELS.rug : LABELS.bookcase;
        return set(name, null);
      }
      if (tab === "theme") {
        if (k === "s") return setScope((s) => (s === "room" ? "wing" : "room"));
        const n = Number(e.key);
        if (Number.isInteger(n) && n >= 1 && n <= THEMES.length) {
          setPending((p) => {
            const { [LABELS.theme]: _a, [LABELS.wing]: _b, ...rest } = p; // one theme choice at a time
            return { ...rest, [themeLabel]: THEMES[n - 1].id };
          });
        }
      } else if (tab === "rug") {
        const n = Number(e.key);
        if (Number.isInteger(n) && n >= 1 && n <= RUG_STYLES.length) set(LABELS.rug, RUG_STYLES[n - 1] === "crimson" ? null : RUG_STYLES[n - 1]);
      } else if (tab === "case") {
        const n = Number(e.key);
        if (Number.isInteger(n) && n >= 1 && n <= CASE_STYLES.length) set(LABELS.bookcase, CASE_STYLES[n - 1] === "oak" ? null : CASE_STYLES[n - 1]);
      } else {
        if (tab === "wall" && (e.key === "+" || e.key === "=")) return setSpan(span + 1);
        if (tab === "wall" && (e.key === "-" || e.key === "_")) return setSpan(span - 1);
        const count = tab === "wall" ? wallSlots.length : floorSlots.length;
        if (e.key === "ArrowLeft") setSlot((s) => (s + count - 1) % count);
        else if (e.key === "ArrowRight") setSlot((s) => (s + 1) % count);
        else if (e.key === "[" || e.key === "]" || e.key === "ArrowUp" || e.key === "ArrowDown") {
          const dir = e.key === "]" || e.key === "ArrowDown" ? 1 : -1;
          e.preventDefault();
          if (tab === "wall") editSlot(LABELS.wall, wallSlots, WALL_OPTIONS, dir);
          else editSlot(LABELS.furniture, floorSlots, FLOOR_OPTIONS, dir);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const slotCount = tab === "wall" ? wallSlots.length : floorSlots.length;
  useEffect(() => setSlot((s) => Math.min(s, Math.max(0, slotCount - 1))), [slotCount]);
  const dirty = Object.keys(pending).length;
  const slotBar = (slots: string[], name: string, options: readonly string[]): React.JSX.Element => (
    <div className="build-row">
      {slots.map((kind, i) => (
        <button key={i} className={`chip ${slot === i ? "active" : ""}`} onClick={() => setSlot(i)} title="Select slot; [ ] or ↑↓ to change">
          {i + 1}: {kind === AUTO ? "auto" : kind === EMPTY ? "empty" : kind}
        </button>
      ))}
      <span className="build-sep" />
      <button onClick={() => editSlot(name, slots, options, -1)}>◀ kind</button>
      <button onClick={() => editSlot(name, slots, options, 1)}>kind ▶</button>
    </div>
  );

  return (
    <aside className="build-panel" role="dialog" aria-label="Build mode">
      <div className="build-head">
        <strong>Build</strong> · {props.roomId === tree.rootNoteId ? "Library" : room?.title ?? props.roomId} · theme <em>{current.name}</em>
        <span className="build-tabs">
          {TABS.map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => { setTab(t); setSlot(0); }}>
              {t}
            </button>
          ))}
        </span>
      </div>

      {tab === "theme" && (
        <div className="build-row">
          <button className={scope === "room" ? "active" : ""} onClick={() => setScope("room")}>this room</button>
          <button className={scope === "wing" ? "active" : ""} onClick={() => setScope("wing")}>
            this wing ({wingCount} room{wingCount === 1 ? "" : "s"})
          </button>
          <span className="build-sep" />
          {THEMES.map((t, i) => (
            <button
              key={t.id}
              className={`chip ${pending[themeLabel] === t.id ? "active" : ""}`}
              onClick={() => setPending((p) => {
                const { [LABELS.theme]: _a, [LABELS.wing]: _b, ...rest } = p;
                return { ...rest, [themeLabel]: t.id };
              })}
              title={`${t.name} (${i + 1})`}
            >
              <span className="chip-sw" style={{ background: t.grade ? `#${t.grade.color.toString(16).padStart(6, "0")}` : "#6a4a31" }} />
              {i + 1} {t.name}
            </button>
          ))}
          <button className="chip" onClick={() => set(themeLabel, null)} title="Remove the label (0)">0 reset</button>
        </div>
      )}
      {tab === "wall" && (
        <>
          {slotBar(wallSlots, LABELS.wall, WALL_OPTIONS)}
          <div className="build-row">
            <button onClick={() => setSpan(span - 1)} disabled={span <= 0}>− wall</button>
            <span>extra wall: {span} ({span * 96}px)</span>
            <button onClick={() => setSpan(span + 1)} disabled={span >= MAX_SPAN}>+ wall</button>
            <span className="dim-line">(+/− keys) widens the room so there is more wall to decorate</span>
          </div>
        </>
      )}
      {tab === "floor" && (
        <>
          {slotBar(floorSlots, LABELS.furniture, FLOOR_OPTIONS)}
          {info.floorHidden > 0 && <div className="error-line">{info.floorHidden} piece{info.floorHidden === 1 ? "" : "s"} don't fit in this room and are hidden</div>}
        </>
      )}
      {tab === "rug" && (
        <div className="build-row">
          {RUG_STYLES.map((r, i) => (
            <button key={r} className={`chip ${rug === r ? "active" : ""}`} onClick={() => set(LABELS.rug, r === "crimson" ? null : r)}>
              {i + 1} {r}
            </button>
          ))}
        </div>
      )}

      {tab === "case" && (
        <div className="build-row">
          {CASE_STYLES.map((c, i) => (
            <button key={c} className={`chip ${bookcase === c ? "active" : ""}`} onClick={() => set(LABELS.bookcase, c === "oak" ? null : c)}>
              {i + 1} {c}
            </button>
          ))}
        </div>
      )}

      <div className="build-row build-foot">
        <span className="dim-line">
          Tab next tab · 0 reset · Enter apply · Esc cancel — nothing is saved until Enter
          {tab === "theme" ? " · 1–7 pick · S scope" : tab === "rug" || tab === "case" ? " · 1–4 pick" : tab === "wall" ? " · ←→ slot · [ ] kind · +/− span" : " · ←→ slot · [ ] kind"}
        </span>
        <button onClick={() => void apply()} disabled={busy || dirty === 0}>
          {busy ? "…" : `apply${dirty > 0 ? ` (${dirty})` : ""}`}
        </button>
        <button onClick={cancel}>cancel</button>
      </div>
    </aside>
  );
}
