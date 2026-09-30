# SessionJar

**SessionJar lets you hand an AI agent your own already-logged-in browser session, without handing over your password, and without letting it silently click "Delete."** You export your session yourself, from your own browser, using Playwright's own standard `storageState()` feature. SessionJar loads that export into an isolated automation profile and runs read-only by default: any request that would change state on the server, or any click on something that looks like a submit/delete/pay/confirm control, is blocked unless you explicitly opt in.

This is a consent-based safety tool for automating **your own** accounts. It is not a way to access someone else's session, and it does not read another running browser's live cookie store -- the only input it accepts is a file *you* deliberately exported.

## How it works

1. **You** log into a site in your own real browser (or a temporary Playwright browser you control) and **you** explicitly export that session with Playwright's documented `storageState()` API. This is a normal, standard Playwright feature -- SessionJar does not touch your everyday browser or its live profile.
2. SessionJar loads that exported JSON file into a fresh, isolated Chromium context (`browser.newContext({ storageState: ... })`), so the agent gets your cookies/localStorage without ever seeing your password.
3. SessionJar wires up two independent real guard rails on that context:
   - **Network guard**: a Playwright `context.route()` handler inspects every outgoing request and aborts any `POST` / `PUT` / `PATCH` / `DELETE` unless mutations are explicitly allowed.
   - **Click guard**: before the documented `page.click()` API actually clicks anything, a real Playwright locator check inspects the target element (tag, `type`, role, visible text, aria-label) and refuses to click if it looks like a submit/delete/pay/confirm-style control -- unless mutations are explicitly allowed. A separate injected page script applies the same check to real mouse clicks in the interactive `sessionjar open` window, with an on-page banner showing the current mode.
4. Nothing is allowed to mutate state unless you pass `--allow-mutations` on the CLI (or `{ allowMutations: true }` in the API) for that run, or -- in your own automation -- unless you deliberately choose to.

## Install

```bash
git clone <this-repo>
cd sessionjar
npm install
npx playwright install chromium   # downloads a real Chromium binary for Playwright
npm run build
```

## Quick start

### 1. Export YOUR OWN session state

Do this once, from a small script you run yourself, against a browser context where *you* log in by hand:

```js
// export-my-session.mjs
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto("https://example.com/login");
console.log("Log in by hand in the window that just opened, then press Enter here...");
await new Promise((resolve) => process.stdin.once("data", resolve));

// This is the standard, documented Playwright storageState() export.
await context.storageState({ path: "./my-session.json" });
console.log("Saved ./my-session.json");

await browser.close();
```

```bash
node export-my-session.mjs
```

`my-session.json` now contains cookies/localStorage for the site(s) you were logged into. **Treat it like a password** -- it is gitignored by default in this repo (`*.storageState.json`, `storage-state*.json`, etc.) and you should never commit it or send it anywhere you wouldn't send a live session token.

### 2. Look at it running, interactively

```bash
npx sessionjar open ./my-session.json https://example.com/dashboard
```

This opens a real, visible Chromium window with your session loaded. A banner at the top of the page shows you're in read-only mode. Try clicking a "Delete"/"Submit"/"Confirm"-style button -- SessionJar's injected click guard blocks it and flips the banner red. Close the window when you're done.

### 3. Run an automation script against it

```bash
npx sessionjar run ./my-session.json ./examples/example-script.mjs
```

Your script gets a `page` object with the same two guards wired up (see `examples/example-script.mjs`):

```js
export default async function main(page) {
  await page.goto("https://example.com/dashboard");
  const title = await page.title();
  console.log(title);

  await page.click("#some-read-only-link"); // fine

  await page.click("button:has-text('Delete')"); // throws SessionJarBlockedError
}
```

Only run with mutations allowed once you've decided that's genuinely safe for this run:

```bash
npx sessionjar run ./my-session.json ./scripts/archive-old-items.js --allow-mutations
```

### Using it as a library

```ts
import { launchSession, SessionJarBlockedError } from "sessionjar";

const { page, close } = await launchSession("./my-session.json", {
  allowMutations: false,
  headless: true,
});

try {
  await page.goto("https://example.com/inbox");
  await page.click("#refresh"); // ok if it doesn't look mutating
} catch (err) {
  if (err instanceof SessionJarBlockedError) {
    console.log("Blocked:", err.message);
  }
} finally {
  await close();
}
```

## CLI reference

```
sessionjar open <storageStateFile> <url> [--allow-mutations]
sessionjar run  <storageStateFile> <script.js> [--allow-mutations] [--headless=false]
sessionjar --help
```

## Project layout

```
src/
  classifier.ts   Pure logic: "does this HTTP method / element look mutating?"
  errors.ts       SessionJarBlockedError
  session.ts      Playwright wiring: launchSession(), GuardedPage, both guards
  cli.ts          `sessionjar open` / `sessionjar run`
  index.ts        Public library API surface
bin/
  sessionjar.mjs  Bin entrypoint (imports dist/cli.js)
examples/
  example-script.mjs
tests/
  classifier.test.ts   Pure unit tests, no browser required
  e2e.test.ts          Real Chromium + real local HTTP server tests
  fixtures/            Local test HTTP server and a synthetic (fake) storageState fixture
```

## Testing

```bash
npm test
```

- `tests/classifier.test.ts` tests the mutating-request/element classifier in complete isolation -- no browser, no network.
- `tests/e2e.test.ts` spins up a throwaway local HTTP server (`tests/fixtures/test-server.ts`, a fake login-style page with a read-only link, a "Delete Account" submit button, and a "Sync Now" button that posts under a neutral label) and drives it with a real headless Chromium instance, proving:
  - a `.click()` on the read-only link succeeds;
  - a `.click()` on the delete button is blocked by default and throws `SessionJarBlockedError`, and only goes through with `allowMutations: true`;
  - a `POST` request is blocked by the network guard by default (even when the *click itself* wasn't flagged, isolating the two guard layers), and only goes through with `allowMutations: true`.

  These e2e tests auto-skip (rather than fail) if no Chromium binary is present at Playwright's expected path, so the suite still runs cleanly in environments where `playwright install` can't reach the network.

## Limitations

- **The mutating-element classifier is a heuristic, not a guarantee.** It looks at tag name, `type` attribute, ARIA role, visible text, and aria-label against a fixed list of verbs (delete, remove, confirm, submit, pay, purchase, etc.). Sites that use unconventional UI (icon-only buttons with no accessible label, custom web components, canvas-rendered UI, drag-to-confirm gestures, keyboard-only submit flows) can defeat it in either direction: it may block something harmless, or -- more importantly -- it may miss a real mutating control that doesn't match the pattern. **Do not treat this as a security boundary on its own.**
- **The network guard blocks by HTTP method, not by intent.** A site that mutates state via `GET` (bad practice, but it happens) will not be blocked by the network guard. Likewise, some read APIs use `POST` (e.g. some GraphQL queries, some search endpoints) and will be blocked by default even though they don't mutate anything -- you may need `--allow-mutations` for those, which also re-opens real mutation endpoints, so review what a script actually does before allowing mutations.
- **The network guard does not cover WebSockets.** `context.route()` only intercepts HTTP requests; it does not see WebSocket connections or the messages sent over them. A site that mutates state via a WebSocket message (common in real-time apps) is not blocked by either guard, with no default-deny and no warning. Treat any site you know to be WebSocket-driven as outside this tool's protection entirely.
- **The interactive click guard is a page-injected script.** It runs in the page's JS context and can, in principle, be interfered with by sufficiently hostile page JavaScript running before it, or bypassed by actions that don't go through a `click` DOM event (e.g. some keyboard-driven or gesture-driven form submissions). The `run` API's `GuardedPage.click()` guard is stronger because it never issues the underlying Playwright click at all when it decides to block.
- **This tool does not sandbox what an allowed script can do.** Once you pass `--allow-mutations`, SessionJar gets out of the way entirely for that run. It is a speed bump for accidental/unreviewed automation, not a fine-grained permission system.
- **Playwright's browser download can fail in restricted/offline environments.** If `npx playwright install chromium` can't reach the network, the real end-to-end tests will skip themselves automatically (see Testing above) and only the pure-logic classifier tests will run. In the environment this project was built and tested in, the Chromium binary install succeeded and all e2e tests ran against a real browser (see commit history / CI output).
- **Treat exported `storageState` files as live credentials.** They typically contain session cookies that grant real access. SessionJar gitignores common patterns for them by default, but you are responsible for not committing, logging, or transmitting them insecurely.

Recommended posture: use SessionJar's read-only default as one layer of defense in depth, not as the only thing standing between an agent and your account. Review scripts before running them with `--allow-mutations`, prefer accounts/sessions with the minimum privilege necessary, and prefer test/staging accounts over production ones when you can.

## License

MIT, see [LICENSE](./LICENSE).
