/*
This file tests the shared browser API helper and its path-based request contract.
Edit this file when API base paths or error handling change.
Copy this file when you add tests for another small shared browser helper.
*/

import { afterEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("shared api helper", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("prefixes JSON requests with the configured API base path once", async () => {
    vi.stubEnv("VITE_BACKEND_URL", "/api/");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: { deaths: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    const { postJson } = await import("./api");
    const data = await postJson<{ deaths: number }>("runs/stats");

    expect(data).toEqual({ deaths: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/stats", expect.objectContaining({ method: "POST", body: "{}" }));
  });

  it("turns API errors into ApiError with the server message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: { code: "bad_request", message: "Nope." } }, 400)));
    const { postJson, ApiError } = await import("./api");
    const error = await postJson("/runs/finish", {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: "bad_request", message: "Nope." });
  });

  it("explains network failures in plain words", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { postJson } = await import("./api");
    await expect(postJson("/runs/stats")).rejects.toThrow("Could not reach the server. Please try again.");
  });

  it("reports empty and broken responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 502 })).mockResolvedValueOnce(new Response("<html>", { status: 502 })));
    const { postJson } = await import("./api");
    await expect(postJson("/runs/stats")).rejects.toThrow("Server returned an empty response.");
    await expect(postJson("/runs/stats")).rejects.toThrow("Server returned invalid JSON.");
  });
});
