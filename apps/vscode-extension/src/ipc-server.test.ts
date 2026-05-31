import { describe, it, expect, mock, afterEach } from "bun:test";
import { createIpcServer } from "./ipc-server";
import type * as http from "http";

describe("createIpcServer", () => {
  let server: http.Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it("starts on a random port", async () => {
    const onUrl = mock((_url: string) => {});
    const result = await createIpcServer(onUrl);
    server = result.server;

    expect(result.port).toBeGreaterThan(0);
  });

  it("calls onUrl for encoded localhost URLs", async () => {
    const onUrl = mock((_url: string) => {});
    const result = await createIpcServer(onUrl);
    server = result.server;

    const target = "http://127.0.0.1:7788?tab=review&id=123";
    const res = await fetch(
      `http://127.0.0.1:${result.port}/open?url=${encodeURIComponent(target)}`,
    );

    expect(res.status).toBe(200);
    expect(onUrl).toHaveBeenCalledWith(target);
  });

  it("rejects non-local URLs", async () => {
    const onUrl = mock((_url: string) => {});
    const result = await createIpcServer(onUrl);
    server = result.server;

    const res = await fetch(
      `http://127.0.0.1:${result.port}/open?url=${encodeURIComponent("https://example.com")}`,
    );

    expect(res.status).toBe(400);
    expect(onUrl).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown paths", async () => {
    const onUrl = mock((_url: string) => {});
    const result = await createIpcServer(onUrl);
    server = result.server;

    const res = await fetch(`http://127.0.0.1:${result.port}/other`);

    expect(res.status).toBe(404);
    expect(onUrl).not.toHaveBeenCalled();
  });
});
