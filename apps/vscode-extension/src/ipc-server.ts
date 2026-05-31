import * as http from "http";

function isAllowedReviewUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function createIpcServer(
  onUrl: (url: string) => void,
  preferredPort?: number,
): Promise<{ server: http.Server; port: number }> {
  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const parsed = new URL(req.url!, "http://localhost");
    const targetUrl = parsed.searchParams.get("url");

    if (req.method === "GET" && parsed.pathname === "/open" && targetUrl) {
      if (!isAllowedReviewUrl(targetUrl)) {
        res.writeHead(400);
        res.end("invalid url");
        return;
      }
      onUrl(targetUrl);
      res.writeHead(200);
      res.end("ok");
      return;
    }

    res.writeHead(404);
    res.end("not found");
  };

  function listen(port: number): Promise<{ server: http.Server; port: number }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(handler);
      server.listen(port, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          resolve({ server, port: addr.port });
        } else {
          reject(new Error("Failed to get server address"));
        }
      });
      server.on("error", reject);
    });
  }

  if (preferredPort) {
    return listen(preferredPort).catch(() => listen(0));
  }
  return listen(0);
}
