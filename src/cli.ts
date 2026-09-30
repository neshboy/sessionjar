import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { launchSession, type BlockedEvent, type SessionJarHandle } from "./session.js";

function logBlocked(event: BlockedEvent): void {
  const label = event.kind === "request" ? "[blocked request]" : "[blocked click]";
  // eslint-disable-next-line no-console
  console.warn(`sessionjar ${label} ${event.detail}`);
}

function usage(): string {
  return `SessionJar - hand your own logged-in browser session to an automation script, safely.

Usage:
  sessionjar open <storageStateFile> <url> [--allow-mutations]
      Opens a real, visible Chromium window with the given exported session
      loaded. Read-only by default: try clicking something that looks like a
      "delete"/"submit"/etc control and watch SessionJar block it.

  sessionjar run <storageStateFile> <script.js> [--allow-mutations] [--headless=false]
      Runs an automation script against the given exported session. The
      script must have a default export: \`export default async function(page) { ... }\`
      \`page\` is a SessionJar GuardedPage (see README for the API).

  sessionjar --help
      Show this message.

Examples:
  sessionjar open ./my-session.json https://example.com/dashboard
  sessionjar run ./my-session.json ./scripts/check-inbox.js
  sessionjar run ./my-session.json ./scripts/archive-old.js --allow-mutations
`;
}

function parseFlags(args: string[]): { positional: string[]; allowMutations: boolean; headless?: boolean } {
  const positional: string[] = [];
  let allowMutations = false;
  let headless: boolean | undefined;
  for (const arg of args) {
    if (arg === "--allow-mutations") {
      allowMutations = true;
    } else if (arg === "--headless=false") {
      headless = false;
    } else if (arg === "--headless=true") {
      headless = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, allowMutations, headless };
}

async function runOpen(args: string[]): Promise<number> {
  const { positional, allowMutations, headless } = parseFlags(args);
  const [storageStateFile, url] = positional;
  if (!storageStateFile || !url) {
    console.error("Usage: sessionjar open <storageStateFile> <url> [--allow-mutations]");
    return 1;
  }

  console.log(
    `sessionjar: launching visible Chromium with session "${storageStateFile}"\n` +
      `sessionjar: mode = ${allowMutations ? "MUTATIONS ALLOWED" : "READ-ONLY (default)"}`,
  );

  let handle: SessionJarHandle | undefined;
  try {
    handle = await launchSession(storageStateFile, {
      allowMutations,
      headless: headless ?? false,
      onBlocked: logBlocked,
      showBanner: true,
    });
    await handle.page.goto(url);

    console.log("sessionjar: page loaded. Close the browser window to exit.");
    // Wait for the user to close the window themselves.
    await new Promise<void>((resolve) => {
      handle!.context.on("close", () => resolve());
      handle!.browser.on("disconnected", () => resolve());
    });
    return 0;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function runScript(args: string[]): Promise<number> {
  const { positional, allowMutations, headless } = parseFlags(args);
  const [storageStateFile, scriptFile] = positional;
  if (!storageStateFile || !scriptFile) {
    console.error("Usage: sessionjar run <storageStateFile> <script.js> [--allow-mutations] [--headless=false]");
    return 1;
  }

  console.log(
    `sessionjar: running "${scriptFile}" against session "${storageStateFile}"\n` +
      `sessionjar: mode = ${allowMutations ? "MUTATIONS ALLOWED" : "READ-ONLY (default)"}`,
  );

  const handle = await launchSession(storageStateFile, {
    allowMutations,
    headless: headless ?? true,
    onBlocked: logBlocked,
    // `run` is scripted/non-interactive: the real guard here is
    // GuardedPage.click()'s Playwright-level check. The injected on-page
    // banner + DOM click listener is only meaningful for a human watching
    // `sessionjar open`'s visible window -- installing it here would also
    // silently intercept real clicks issued via `page.raw.click()`, which
    // the README documents as bypassing the click guard.
    showBanner: false,
  });

  try {
    const absScriptPath = path.resolve(process.cwd(), scriptFile);
    const mod = await import(pathToFileURL(absScriptPath).href);
    const scriptFn = mod.default ?? mod.run;
    if (typeof scriptFn !== "function") {
      throw new Error(
        `${scriptFile} must have a default export function: export default async function(page) { ... }`,
      );
    }
    await scriptFn(handle.page, { context: handle.context, browser: handle.browser, allowMutations });
    console.log("sessionjar: script finished successfully.");
    return 0;
  } catch (err) {
    console.error(`sessionjar: script failed: ${(err as Error).message}`);
    return 1;
  } finally {
    await handle.close().catch(() => {});
  }
}

async function main(): Promise<number> {
  const [, , command, ...rest] = process.argv;

  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return command ? 0 : 1;
  }

  switch (command) {
    case "open":
      return runOpen(rest);
    case "run":
      return runScript(rest);
    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(usage());
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
