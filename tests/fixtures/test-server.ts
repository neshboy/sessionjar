import * as http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A tiny local HTTP server used only by tests. It fakes a logged-in page
 * with:
 *  - a read-only link (no side effects)
 *  - a "Delete account" button that looks obviously mutating and, if
 *    actually clicked through, fires a POST to /api/delete
 *  - a "Sync now" button whose *label* is intentionally NOT flagged by the
 *    text heuristic, but whose click handler still performs a real POST --
 *    this isolates the network-level guard from the click-level guard.
 *
 * No real credentials, no third party, nothing leaves localhost.
 */
export interface TestServerHandle {
  url: string;
  deleteCallCount: () => number;
  syncCallCount: () => number;
  close: () => Promise<void>;
}

const PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Fake Dashboard</title></head>
<body>
  <h1>Fake Dashboard (test fixture)</h1>
  <p id="status">idle</p>

  <a id="read-link" href="/profile">View Profile</a>

  <form id="delete-form" action="/api/delete" method="POST">
    <button id="delete-btn" type="submit">Delete Account</button>
  </form>

  <button id="sync-btn" type="button">Sync Now</button>

  <script>
    document.getElementById('read-link').addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('status').textContent = 'read-ok';
    });

    document.getElementById('delete-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await fetch('/api/delete', { method: 'POST' });
        document.getElementById('status').textContent = res.ok ? 'deleted' : 'delete-failed';
      } catch (err) {
        document.getElementById('status').textContent = 'delete-network-blocked';
      }
    });

    document.getElementById('sync-btn').addEventListener('click', async () => {
      try {
        const res = await fetch('/api/sync', { method: 'POST' });
        document.getElementById('status').textContent = res.ok ? 'synced' : 'sync-failed';
      } catch (err) {
        document.getElementById('status').textContent = 'sync-network-blocked';
      }
    });
  </script>
</body>
</html>`;

export async function startTestServer(): Promise<TestServerHandle> {
  let deleteCalls = 0;
  let syncCalls = 0;

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(PAGE_HTML);
      return;
    }
    if (req.method === "POST" && req.url === "/api/delete") {
      deleteCalls += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/sync") {
      syncCalls += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/`,
    deleteCallCount: () => deleteCalls,
    syncCallCount: () => syncCalls,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
