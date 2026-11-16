/*
This file is the game page: the title screen, loading screen, HUD (battery, tapes, subtitles), pause and end screens.
The 3D game itself runs inside CaveGame from src/features/cave/game.ts on the <canvas>.
Edit this file to change menus, HUD layout, or texts. Copy the overlay pattern here for another full-screen menu.
*/

import { useCallback, useEffect, useRef, useState } from "react";
import { CaveGame, type HudState, type RunResult } from "../features/cave/game";
import { postJson } from "../shared/api";
import { formatTime } from "../shared/formatTime";
import type { RunStats } from "../shared/types";

const EMPTY_HUD: HudState = {
  phase: "loading",
  loadingText: "",
  battery: 100,
  stamina: 100,
  lightOn: true,
  tapes: 0,
  totalTapes: 4,
  glowsticks: 1,
  prompt: "",
  subtitle: "",
  areaTitle: "",
  seconds: 0,
  deathReason: "",
};

const CONTROLS: [string, string][] = [
  ["W A S D", "walk"],
  ["Mouse / touchpad", "look around (if it does not turn, hold the pad button and drag)"],
  ["Shift", "run (loud)"],
  ["C", "crouch (quiet, fits small holes)"],
  ["F", "flashlight on / off"],
  ["E", "take an item"],
  ["G", "throw a glowstick (the noise pulls the monster away)"],
  ["Space", "jump"],
  ["Esc", "pause"],
];

function StatsLine({ stats }: { stats: RunStats | null }) {
  if (!stats) return <p className="text-stone-600">...</p>;
  return (
    <p className="text-stone-400">
      {stats.deaths} {stats.deaths === 1 ? "explorer" : "explorers"} never came back. {stats.escapes} saw the sky again.
      {stats.best_full_escape_seconds !== null ? ` Fastest escape with all tapes: ${formatTime(stats.best_full_escape_seconds)}.` : ""}
    </p>
  );
}

const SENSITIVITY_KEY = "cave-look-sensitivity";

function loadSensitivity(): number {
  try {
    const saved = Number(window.localStorage.getItem(SENSITIVITY_KEY));
    return saved >= 0.2 && saved <= 3 ? saved : 1;
  } catch {
    return 1;
  }
}

function SensitivitySlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <label className="mx-auto flex max-w-md items-center justify-center gap-3 text-xl text-stone-400" onClick={(event) => event.stopPropagation()}>
      Look speed (touchpad: turn it up)
      <input
        type="range"
        min="0.2"
        max="3"
        step="0.1"
        value={value}
        aria-label="Look speed"
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-40 accent-red-800"
      />
      <span className="w-10 text-stone-300">{value.toFixed(1)}</span>
    </label>
  );
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  const filled = Math.round(value / 10);
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-stone-400">{label}</span>
      <span className="tracking-[-0.1em]" aria-label={`${label} ${value}%`} style={{ color }}>
        {"█".repeat(filled)}
        <span className="text-stone-800">{"█".repeat(10 - filled)}</span>
      </span>
    </div>
  );
}

function Hud({ hud }: { hud: HudState }) {
  return (
    <div className="pointer-events-none absolute inset-0 text-xl">
      <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 bg-stone-300/50" />
      <div className="absolute left-5 top-4 space-y-0.5">
        <Bar label={hud.lightOn ? "LIGHT" : "LIGHT·off"} value={hud.battery} color={hud.battery < 15 ? "#b91c1c" : "#d6c9a8"} />
        <Bar label="BREATH" value={hud.stamina} color="#7c8a8a" />
      </div>
      <div className="absolute right-5 top-4 space-y-0.5 text-right text-stone-300">
        <div>
          TAPES {hud.tapes} / {hud.totalTapes}
        </div>
        <div className="text-green-300/80">GLOW ×{hud.glowsticks} [G]</div>
      </div>
      {hud.areaTitle ? (
        <div className="absolute inset-x-0 top-[22%] text-center text-5xl tracking-[0.3em] text-stone-300/80 animate-pulse">{hud.areaTitle}</div>
      ) : null}
      {hud.prompt ? <div className="absolute inset-x-0 top-[58%] text-center text-stone-200">{hud.prompt}</div> : null}
      {hud.subtitle ? (
        <div className="absolute inset-x-0 bottom-10 flex justify-center px-6">
          <p className="max-w-3xl bg-black/70 px-4 py-2 text-center text-2xl leading-7 text-amber-100/90">{hud.subtitle}</p>
        </div>
      ) : null}
    </div>
  );
}

function Overlay({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6" onClick={onClick}>
      <div className="max-w-2xl space-y-5 text-center">{children}</div>
    </div>
  );
}

function ActionButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      className="border-2 border-stone-500 px-6 py-2 text-2xl text-stone-200 transition hover:border-red-800 hover:bg-red-950/40 hover:text-white"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

export function GamePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<CaveGame | null>(null);
  const [started, setStarted] = useState(false);
  const [hud, setHud] = useState<HudState>(EMPTY_HUD);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [error, setError] = useState("");
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [sensitivity, setSensitivity] = useState(loadSensitivity);

  const loadStats = useCallback(() => {
    postJson<RunStats>("/runs/stats")
      .then(setStats)
      .catch(() => setStats({ deaths: 0, escapes: 0, best_full_escape_seconds: null }));
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    return () => gameRef.current?.dispose();
  }, []);

  const changeSensitivity = (value: number) => {
    setSensitivity(value);
    gameRef.current?.setSensitivity(value);
    try {
      window.localStorage.setItem(SENSITIVITY_KEY, String(value));
    } catch {
      // Saving the setting is optional.
    }
  };

  const onFinish = useCallback(
    (result: RunResult) => {
      setLastRun(result);
      postJson("/runs/finish", result)
        .then(loadStats)
        .catch((finishError: unknown) => console.warn("Could not save the run.", finishError));
    },
    [loadStats],
  );

  const enterCave = async () => {
    if (!canvasRef.current || gameRef.current) return;
    setStarted(true);
    const game = new CaveGame({ canvas: canvasRef.current, onHud: setHud, onFinish, sensitivity });
    gameRef.current = game;
    try {
      await game.load();
    } catch (loadError) {
      console.error("The cave failed to load.", loadError);
      setError("The cave could not be drawn. Your browser needs WebGL 2 (try a recent Chrome, Edge, or Firefox).");
    }
  };

  const play = () => gameRef.current?.start();
  const phase = started ? hud.phase : "title";

  return (
    <div className="relative h-screen w-screen select-none overflow-hidden bg-black font-pixel text-stone-200">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" style={{ imageRendering: "pixelated" }} />

      {phase === "title" ? (
        <Overlay>
          <p className="text-xl tracking-[0.4em] text-red-900">A CAVE EXPLORER STORY</p>
          <h1 className="text-7xl leading-none tracking-widest text-stone-200">THE HOLLOW BELOW</h1>
          <p className="text-2xl text-stone-400">
            Your rope snapped. The team that came before you is gone. Find their four tapes and a way back to the sky.
            Something down here sees your light.
          </p>
          <StatsLine stats={stats} />
          <SensitivitySlider value={sensitivity} onChange={changeSensitivity} />
          <ActionButton onClick={() => void enterCave()}>Enter the cave</ActionButton>
          <div className="mx-auto grid max-w-md grid-cols-2 gap-x-6 text-left text-lg text-stone-500">
            {CONTROLS.map(([key, action]) => (
              <p key={key}>
                <span className="text-stone-300">{key}</span> - {action}
              </p>
            ))}
          </div>
          <p className="text-base text-stone-600">Best with headphones. Contains loud sounds and flashing images. Computer with mouse and keyboard only.</p>
        </Overlay>
      ) : null}

      {phase === "loading" ? (
        <Overlay>
          <p className="animate-pulse text-3xl text-stone-400">{error || hud.loadingText || "Descending..."}</p>
        </Overlay>
      ) : null}

      {phase === "ready" ? (
        <Overlay onClick={play}>
          <p className="text-3xl text-stone-300">Click anywhere to open your eyes.</p>
        </Overlay>
      ) : null}

      {phase === "playing" ? <Hud hud={hud} /> : null}

      {phase === "paused" ? (
        <Overlay onClick={play}>
          <h2 className="text-5xl tracking-widest">PAUSED</h2>
          <p className="text-2xl text-stone-400">The dark is waiting. Click to go back.</p>
          <SensitivitySlider value={sensitivity} onChange={changeSensitivity} />
        </Overlay>
      ) : null}

      {phase === "dead" ? (
        <Overlay>
          <h2 className="text-6xl tracking-widest text-red-800">{hud.deathReason === "fall" ? "THE THROAT SWALLOWED YOU" : "YOU BECAME PART OF THE CAVE"}</h2>
          <p className="text-2xl text-stone-400">
            Tapes found: {lastRun?.recorders ?? hud.tapes} / {hud.totalTapes}. Time below: {formatTime(lastRun?.seconds ?? hud.seconds)}.
          </p>
          <StatsLine stats={stats} />
          <ActionButton onClick={play}>Try again</ActionButton>
        </Overlay>
      ) : null}

      {phase === "escaped" ? (
        <Overlay>
          <h2 className="text-6xl tracking-widest text-amber-200">YOU SAW THE SKY AGAIN</h2>
          <p className="text-2xl text-stone-300">
            {hud.tapes === hud.totalTapes
              ? "You carry all four tapes. Now everyone will know what is down there."
              : `You escaped with ${hud.tapes} of ${hud.totalTapes} tapes. Some voices stay in the dark forever.`}
          </p>
          <p className="text-2xl text-stone-400">Time below: {formatTime(lastRun?.seconds ?? hud.seconds)}</p>
          <StatsLine stats={stats} />
          <ActionButton onClick={play}>Go back down</ActionButton>
        </Overlay>
      ) : null}
    </div>
  );
}
