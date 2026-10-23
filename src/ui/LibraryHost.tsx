/**
 * ui/LibraryHost.tsx — mounts the Phaser library (the side-scrolling rooms).
 *
 * This module is loaded LAZILY (React.lazy in App.tsx): Phaser is the biggest part of the bundle and the app now starts in the
 * tree view, so the library's code is only fetched the first time someone walks through the shrine's door (or when WebGL is
 * missing and the library is the only view). Once mounted it stays mounted (hidden) so coming back is instant.
 */

import { useEffect, useRef } from "react";
import { startGame } from "../game/game";

export default function LibraryHost(props: { hidden: boolean }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hostRef.current) return;
    const game = startGame(hostRef.current);
    return () => void game.destroy(true);
  }, []);
  return <div ref={hostRef} id="game-host" style={props.hidden ? { display: "none" } : undefined} />;
}
