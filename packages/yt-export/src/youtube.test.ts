import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YouTubeClient } from "./youtube.js";

const ok = () => new Response(JSON.stringify({ items: [{ id: "a" }] }));

describe("YouTubeClient.get", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a network error, then returns the response", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    const result = new YouTubeClient("key").get("videos", {});
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).items).toEqual([{ id: "a" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries when the body fails after the headers arrived", async () => {
    const cutOff = { ok: true, json: () => Promise.reject(new TypeError("terminated")) };
    const fetchMock = vi.fn().mockResolvedValueOnce(cutOff).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    const result = new YouTubeClient("key").get("videos", {});
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).items).toEqual([{ id: "a" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after 4 attempts and throws the network error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const result = new YouTubeClient("key").get("videos", {});
    const assertion = expect(result).rejects.toThrow("fetch failed");
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
