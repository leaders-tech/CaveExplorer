/*
This file tests the game page menus and HUD without a real 3D game (the CaveGame class is faked).
Edit this file when the title screen, HUD, or end screens change. Copy a test here for another menu.
*/

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameOptions, HudState } from "../features/cave/game";
import { formatTime } from "../shared/formatTime";

const fake = vi.hoisted(() => ({ options: null as GameOptions | null, start: vi.fn(), dispose: vi.fn(), load: vi.fn(), setSensitivity: vi.fn() }));

vi.mock("../features/cave/game", () => ({
  CaveGame: class {
    constructor(options: GameOptions) {
      fake.options = options;
    }
    load = fake.load;
    start = fake.start;
    dispose = fake.dispose;
    setSensitivity = fake.setSensitivity;
  },
}));

import { GamePage } from "./GamePage";

const baseHud: HudState = {
  phase: "playing",
  loadingText: "",
  battery: 80,
  stamina: 100,
  lightOn: true,
  tapes: 1,
  totalTapes: 4,
  glowsticks: 2,
  prompt: "[E] Take the batteries",
  subtitle: "The rock here is warm.",
  areaTitle: "",
  seconds: 65,
  deathReason: "",
};

function mockFetch(stats = { deaths: 7, escapes: 2, best_full_escape_seconds: 300 }) {
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: true, data: url.endsWith("/runs/stats") ? stats : { run: {} } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function enter() {
  render(<GamePage />);
  await userEvent.click(screen.getByRole("button", { name: "Enter the cave" }));
  await waitFor(() => expect(fake.load).toHaveBeenCalled());
}

describe("GamePage", () => {
  beforeEach(() => {
    fake.options = null;
    fake.start.mockReset();
    fake.dispose.mockReset();
    fake.setSensitivity.mockReset();
    window.localStorage.clear();
    fake.load.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the title, the controls, and how many explorers died", async () => {
    mockFetch();
    render(<GamePage />);
    expect(screen.getByRole("heading", { name: "THE HOLLOW BELOW" })).toBeInTheDocument();
    expect(screen.getByText(/flashlight on \/ off/)).toBeInTheDocument();
    expect(await screen.findByText(/7 explorers never came back\. 2 saw the sky again\./)).toBeInTheDocument();
    expect(screen.getByText(/Fastest escape with all tapes: 5:00/)).toBeInTheDocument();
  });

  it("still opens when the server is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    render(<GamePage />);
    expect(await screen.findByText(/0 explorers never came back/)).toBeInTheDocument();
  });

  it("loads the game, then starts it on click", async () => {
    mockFetch();
    await enter();
    act(() => fake.options!.onHud({ ...baseHud, phase: "loading", loadingText: "Carving the tunnels..." }));
    expect(screen.getByText("Carving the tunnels...")).toBeInTheDocument();
    act(() => fake.options!.onHud({ ...baseHud, phase: "ready" }));
    await userEvent.click(screen.getByText("Click anywhere to open your eyes."));
    expect(fake.start).toHaveBeenCalledTimes(1);
  });

  it("shows the HUD while playing", async () => {
    mockFetch();
    await enter();
    act(() => fake.options!.onHud({ ...baseHud, areaTitle: "Black Water" }));
    expect(screen.getByText("TAPES 1 / 4")).toBeInTheDocument();
    expect(screen.getByText("[E] Take the batteries")).toBeInTheDocument();
    expect(screen.getByText("GLOW ×2 [G]")).toBeInTheDocument();
    expect(screen.getByText("The rock here is warm.")).toBeInTheDocument();
    expect(screen.getByText("Black Water")).toBeInTheDocument();
    expect(screen.getByLabelText("LIGHT 80%")).toBeInTheDocument();
  });

  it("saves a finished run and offers to try again after death", async () => {
    const fetchMock = mockFetch();
    await enter();
    act(() => fake.options!.onFinish({ outcome: "died", recorders: 2, seconds: 95 }));
    act(() => fake.options!.onHud({ ...baseHud, phase: "dead", deathReason: "creature" }));
    expect(screen.getByRole("heading", { name: "YOU BECAME PART OF THE CAVE" })).toBeInTheDocument();
    expect(screen.getByText(/Tapes found: 2 \/ 4\. Time below: 1:35\./)).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/finish", expect.objectContaining({ body: JSON.stringify({ outcome: "died", recorders: 2, seconds: 95 }) })),
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fake.start).toHaveBeenCalled();
  });

  it("shows a different ending for falling and for escaping", async () => {
    mockFetch();
    await enter();
    act(() => fake.options!.onHud({ ...baseHud, phase: "dead", deathReason: "fall" }));
    expect(screen.getByRole("heading", { name: "THE THROAT SWALLOWED YOU" })).toBeInTheDocument();
    act(() => fake.options!.onHud({ ...baseHud, phase: "escaped", tapes: 4 }));
    expect(screen.getByRole("heading", { name: "YOU SAW THE SKY AGAIN" })).toBeInTheDocument();
    expect(screen.getByText(/You carry all four tapes/)).toBeInTheDocument();
  });

  it("shows a pause screen", async () => {
    mockFetch();
    await enter();
    act(() => fake.options!.onHud({ ...baseHud, phase: "paused" }));
    await userEvent.click(screen.getByText("The dark is waiting. Click to go back."));
    expect(fake.start).toHaveBeenCalled();
  });

  it("lets touchpad players change look speed, remembers it, and gives it to the game", async () => {
    mockFetch();
    render(<GamePage />);
    const slider = screen.getByLabelText("Look speed");
    expect(slider).toHaveValue("1");
    fireEvent.change(slider, { target: { value: "2.4" } });
    expect(window.localStorage.getItem("cave-look-sensitivity")).toBe("2.4");
    await userEvent.click(screen.getByRole("button", { name: "Enter the cave" }));
    await waitFor(() => expect(fake.load).toHaveBeenCalled());
    expect(fake.options?.sensitivity).toBe(2.4);
    act(() => fake.options!.onHud({ ...baseHud, phase: "paused" }));
    fireEvent.change(screen.getByLabelText("Look speed"), { target: { value: "0.6" } });
    expect(fake.setSensitivity).toHaveBeenLastCalledWith(0.6);
  });

  it("explains when WebGL is missing", async () => {
    mockFetch();
    fake.load.mockRejectedValue(new Error("no webgl"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await enter();
    expect(await screen.findByText(/needs WebGL 2/)).toBeInTheDocument();
  });
});

describe("formatTime", () => {
  it("shows minutes and two-digit seconds", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
  });
});
