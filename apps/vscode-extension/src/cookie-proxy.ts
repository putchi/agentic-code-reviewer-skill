import * as http from "http";
import { EventEmitter } from "events";
import { buildThemeListenerScript } from "./vscode-theme";

export interface CookieProxyOptions {
  loadCookies: () => string;
  onSaveCookies: (cookies: string) => void;
  onClose?: () => void;
}

export interface CookieProxy {
  server: http.Server;
  port: number;
  events: EventEmitter;
  rewriteUrl: (originalUrl: string) => string;
}

export function createCookieProxy(
  options: CookieProxyOptions,
): Promise<CookieProxy> {
  return new Promise((resolve, reject) => {
    const events = new EventEmitter();
    let upstream: string | null = null;

    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url!, "http://localhost");

      if (reqUrl.pathname === "/___ext/cookies" && req.method === "POST") {
        const chunks: Buffer[] = [];
        let received = 0;
        const MAX_COOKIE_BYTES = 16 * 1024; // cookies are small; cap the body
        req.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_COOKIE_BYTES) {
            res.writeHead(413);
            res.end("payload too large");
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        req.on("end", () => {
          if (received > MAX_COOKIE_BYTES) return;
          options.onSaveCookies(Buffer.concat(chunks).toString("utf-8"));
          res.writeHead(200);
          res.end("ok");
        });
        return;
      }

      if (reqUrl.pathname === "/___ext/close" && req.method === "POST") {
        options.onClose?.();
        events.emit("close");
        res.writeHead(200);
        res.end("ok");
        return;
      }

      if (!upstream) {
        res.writeHead(502);
        res.end("no upstream configured");
        return;
      }

      const targetUrl = new URL(req.url!, upstream);
      const proxyHeaders: Record<string, string | string[] | undefined> = {
        ...req.headers,
        host: targetUrl.host,
        "accept-encoding": "identity",
      };

      const bodyChunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => bodyChunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(bodyChunks);
        const maxRetries = 3;
        const baseDelay = 200;

        function tryUpstreamRequest(attempt: number): void {
          const proxyReq = http.request(
            targetUrl.toString(),
            { method: req.method, headers: proxyHeaders },
            (proxyRes) => {
              const contentType = proxyRes.headers["content-type"] || "";

              if (String(contentType).includes("text/html")) {
                const chunks: Buffer[] = [];
                proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
                proxyRes.on("end", () => {
                  const html = Buffer.concat(chunks).toString("utf-8");
                  const savedCookies = options.loadCookies();
                  const injected = injectScript(html, savedCookies);
                  const headers = { ...proxyRes.headers };
                  delete headers["content-length"];
                  delete headers["content-encoding"];
                  delete headers["transfer-encoding"];
                  const setCookieHeaders = buildSetCookieHeaders(savedCookies);
                  if (setCookieHeaders.length > 0) {
                    headers["set-cookie"] = setCookieHeaders;
                  }
                  res.writeHead(proxyRes.statusCode || 200, headers);
                  res.end(injected);
                });
              } else {
                res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                proxyRes.pipe(res);
              }
            },
          );

          proxyReq.on("error", () => {
            if (attempt < maxRetries) {
              const delay = baseDelay * Math.pow(2, attempt);
              setTimeout(() => tryUpstreamRequest(attempt + 1), delay);
            } else {
              res.writeHead(502);
              res.end("proxy error");
            }
          });

          proxyReq.end(body);
        }

        tryUpstreamRequest(0);
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        resolve({
          server,
          port,
          events,
          rewriteUrl(originalUrl: string): string {
            const parsed = new URL(originalUrl);
            upstream = parsed.origin;
            return `http://127.0.0.1:${port}${parsed.pathname}${parsed.search}`;
          },
        });
      } else {
        reject(new Error("Failed to get proxy address"));
      }
    });

    server.on("error", reject);
  });
}

function buildSetCookieHeaders(savedCookies: string): string[] {
  if (!savedCookies) return [];
  return savedCookies
    .split("; ")
    .filter((c) => c.startsWith("acr-"))
    .map((c) => `${c}; Path=/; Max-Age=31536000; SameSite=Lax`);
}

function parseCookieString(str: string): Record<string, string> {
  const store: Record<string, string> = {};
  if (!str) return store;
  for (const c of str.split("; ")) {
    const eq = c.indexOf("=");
    if (eq > 0) store[c.slice(0, eq)] = c.slice(eq + 1);
  }
  return store;
}

function injectScript(html: string, savedCookies: string): string {
  const initial = JSON.stringify(parseCookieString(savedCookies));
  const themeListener = buildThemeListenerScript();
  const script = themeListener + `<script>(function(){
      var S=${initial};
      Object.defineProperty(document,"cookie",{configurable:true,
        get:function(){return Object.keys(S).map(function(k){return k+"="+S[k]}).join("; ");},
        set:function(v){
          var p=v.split(";"),nv=p[0].trim(),eq=nv.indexOf("=");
          if(eq<1)return;
          var n=nv.slice(0,eq);
          if(/max-age\\s*=\\s*0/i.test(v)){delete S[n];}else{S[n]=nv.slice(eq+1);}
        }
      });
      function sc(){var c=document.cookie;if(c)fetch("/___ext/cookies",{method:"POST",body:c}).catch(function(){});}
      function closePanel(){sc();fetch("/___ext/close",{method:"POST"}).catch(function(){});}
      var nativeClose=window.close&&window.close.bind(window);
      window.close=function(){closePanel();try{if(nativeClose)nativeClose();}catch(e){}};
      setTimeout(sc,500);setInterval(sc,2000);
      try{window.parent.postMessage("acr-ready","*");}catch(e){}
    })();</script>`;

  const headMatch = html.match(/<head(\s[^>]*)?>/);
  if (headMatch) {
    const idx = html.indexOf(headMatch[0]) + headMatch[0].length;
    return html.slice(0, idx) + script + html.slice(idx);
  }
  return script + html;
}
