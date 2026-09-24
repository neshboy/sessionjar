import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import { chromium } from "playwright";
import { launchSession, SessionJarBlockedError } from "../src/session.js";
import { startTestServer, type TestServerHandle } from "./fixtures/test-server.js";
import { writeFakeStorageState } from "./fixtures/fake-storage-state.js";

/**
 * These tests drive a REAL headless Chromium instance (via the real
 * `playwright` package) against a REAL local HTTP server started for the
 * test (tests/fixtures/test-server.ts). No mocking of Playwright or of the
 * network layer: the guard rails under test are the actual
 * `context.route()` handler and the actual `GuardedPage.click()` locator
 * check from src/session.ts.
 *
 * If no Chromium binary is available in this environment (e.g. `playwright
 * install chromium` couldn't reach the network), this whole suite is
 * skipped rather than failing -- the pure-logic tests in classifier.test.ts
 * still run and prove the classifier itself independent of a browser.
 */
const hasChromium = (() => {
  try {
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!hasChromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "\n[sessionjar tests] No Chromium binary found at the expected Playwright path -- " +
      "skipping real-browser e2e tests. Run `npx playwright install chromium` to enable them.\n",
  );
}

describe.skipIf(!hasChromium)("SessionJar e2e (real Chromium + local HTTP server)", () => {
  let server: TestServerHandle;
  let storageStatePath: string;

  beforeAll(async () => {
    server = await startTestServer();
    storageStatePath = await writeFakeStorageState(server.url);
  });

  afterAll(async () => {
    await server.close();
  });

  it("loads the exported storageState into a real context and allows a read-only click", async () => {
    const handle = await launchSession(storageStatePath, { headless: true, allowMutations: false });
    try {
      await handle.page.goto(server.url);
      await handle.page.click("#read-link");
      const status = await handle.page.textContent("#status");
      expect(status).toBe("read-ok");
    } finally {
      await handle.close();
    }
  });

  it("blocks a .click() on an obviously mutating element by default", async () => {
    const handle = await launchSession(storageStatePath, { headless: true, allowMutations: false });
    try {
      await handle.page.goto(server.url);
      await expect(handle.page.click("#delete-btn")).rejects.toBeInstanceOf(SessionJarBlockedError);
      expect(server.deleteCallCount()).toBe(0);
      // The underlying click never happened, so the form's submit handler never ran.
      const status = await handle.page.textContent("#status");
      expect(status).toBe("idle");
    } finally {
      await handle.close();
    }
  });

  it("allows the mutating click through when --allow-mutations (allowMutations: true) is set", async () => {
    const handle = await launchSession(storageStatePath, { headless: true, allowMutations: true });
    try {
      await handle.page.goto(server.url);
      await handle.page.click("#delete-btn");
      await handle.page.raw.waitForFunction(() => document.getElementById("status")?.textContent !== "idle");
      const status = await handle.page.textContent("#status");
      expect(status).toBe("deleted");
      expect(server.deleteCallCount()).toBe(1);
    } finally {
      await handle.close();
    }
  });

  it("blocks the raw POST request by default even when the click itself isn't classified as mutating", async () => {
    const handle = await launchSession(storageStatePath, { headless: true, allowMutations: false });
    try {
      await handle.page.goto(server.url);
      // "Sync Now" deliberately isn't flagged by the element/text heuristic, so the
      // click-level guard lets this click proceed -- but the resulting POST request
      // must still be blocked by the separate network-level guard.
      await handle.page.click("#sync-btn");
      await handle.page.raw.waitForFunction(() => document.getElementById("status")?.textContent !== "idle");
      const status = await handle.page.textContent("#status");
      expect(status).toBe("sync-network-blocked");
      expect(server.syncCallCount()).toBe(0);
    } finally {
      await handle.close();
    }
  });

  it("allows the POST through when --allow-mutations (allowMutations: true) is set", async () => {
    const handle = await launchSession(storageStatePath, { headless: true, allowMutations: true });
    try {
      await handle.page.goto(server.url);
      await handle.page.click("#sync-btn");
      await handle.page.raw.waitForFunction(() => document.getElementById("status")?.textContent !== "idle");
      const status = await handle.page.textContent("#status");
      expect(status).toBe("synced");
      expect(server.syncCallCount()).toBe(1);
    } finally {
      await handle.close();
    }
  });
});
