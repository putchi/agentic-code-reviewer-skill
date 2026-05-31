import { describe, it, expect, mock, afterEach } from "bun:test";
import { createCookieProxy, type CookieProxy } from "./cookie-proxy";

describe("createCookieProxy", () => {
  let proxy: CookieProxy | undefined;

  afterEach(() => {
    proxy?.server.close();
    proxy = undefined;
  });

  it("starts on a random port", async () => {
    proxy = await createCookieProxy({
      loadCookies: () => "",
      onSaveCookies: () => {},
    });
    expect(proxy.port).toBeGreaterThan(0);
  });

  it("saves cookies via POST /___ext/cookies", async () => {
    const onSave = mock((_: string) => {});
    proxy = await createCookieProxy({
      loadCookies: () => "",
      onSaveCookies: onSave,
    });

    const res = await fetch(
      `http://127.0.0.1:${proxy.port}/___ext/cookies`,
      { method: "POST", body: "acr-pref=true; other-cookie=ignore" },
    );

    expect(res.status).toBe(200);
    expect(onSave).toHaveBeenCalledWith("acr-pref=true; other-cookie=ignore");
  });

  it("emits close event on POST /___ext/close", async () => {
    proxy = await createCookieProxy({
      loadCookies: () => "",
      onSaveCookies: () => {},
    });
    const onClose = mock(() => {});
    proxy.events.on("close", onClose);

    const res = await fetch(
      `http://127.0.0.1:${proxy.port}/___ext/close`,
      { method: "POST" },
    );

    expect(res.status).toBe(200);
    expect(onClose).toHaveBeenCalled();
  });

  it("rewrites URL and sets upstream", async () => {
    proxy = await createCookieProxy({
      loadCookies: () => "",
      onSaveCookies: () => {},
    });

    const rewritten = proxy.rewriteUrl("http://127.0.0.1:7788/review?id=42");
    expect(rewritten).toBe(`http://127.0.0.1:${proxy.port}/review?id=42`);
  });

  it("proxies HTML and injects theme, cookie, and close scripts", async () => {
    const { createServer } = await import("http");
    const upstream = createServer((_, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><head><title>Test</title></head><body>Hello</body></html>");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as { port: number }).port;

    try {
      proxy = await createCookieProxy({
        loadCookies: () => "acr-pref=true; other-cookie=ignore",
        onSaveCookies: () => {},
      });

      const url = proxy.rewriteUrl(`http://127.0.0.1:${upstreamPort}/`);
      const res = await fetch(url);
      const html = await res.text();

      expect(html).toContain("window.__ACR_VSCODE=true");
      expect(html).toContain("/___ext/cookies");
      expect(html).toContain("/___ext/close");
      expect(html).toContain('"acr-pref":"true"');
      expect(html).toContain("<title>Test</title>");
    } finally {
      upstream.close();
    }
  });

  it("passes through JSON without modification", async () => {
    const { createServer } = await import("http");
    const upstream = createServer((_, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"status":"ok"}');
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as { port: number }).port;

    try {
      proxy = await createCookieProxy({
        loadCookies: () => "",
        onSaveCookies: () => {},
      });

      const url = proxy.rewriteUrl(`http://127.0.0.1:${upstreamPort}/api/review`);
      const res = await fetch(url);
      expect(await res.json()).toEqual({ status: "ok" });
    } finally {
      upstream.close();
    }
  });
});
