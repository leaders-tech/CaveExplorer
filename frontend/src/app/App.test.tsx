/*
This file tests the main app router.
Edit this file when top-level routes change.
Copy a test pattern here when you add another route.
*/

import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../pages/GamePage", () => ({
  GamePage: () => <h1>Game page</h1>,
}));

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App routes", () => {
  it("shows the game on the home address", () => {
    renderApp("/");
    expect(screen.getByRole("heading", { name: "Game page" })).toBeInTheDocument();
  });

  it("shows the not found page for unknown addresses", () => {
    renderApp("/login");
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});
