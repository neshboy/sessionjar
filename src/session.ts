import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import * as fs from "node:fs";
import {
  isMutatingMethod,
  looksLikeMutatingElement,
  describeMutationReason,
  type ElementSignal,
} from "./classifier.js";
import { SessionJarBlockedError } from "./errors.js";

export { SessionJarBlockedError } from "./errors.js";
export * from "./classifier.js";

export interface BlockedEvent {
  kind: "click" | "request";
  detail: string;
  /** For "request" events: the HTTP method that was blocked. */
  method?: string;
  /** For "request" events: the URL that was blocked. */
  url?: string;
  /** For "click" events: the selector that was passed to .click(). */
  selector?: string;
}

export interface SessionJarOptions {
  /**
   * When false (the default), SessionJar blocks outgoing POST/PUT/PATCH/DELETE
   * requests and refuses `.click()` calls on elements that look mutating.
   * Set to true only when you have deliberately decided this run is allowed
   * to change state on the target site.
   */
  allowMutations?: boolean;
  /** Run Chromium headless. Defaults to true for `run`, false for `open`. */
  headless?: boolean;
  /** Called whenever a request or click is blocked. Also used for CLI logging. */
  onBlocked?: (event: BlockedEvent) => void;
  /** Inject a small on-page banner showing SessionJar's current mode. Defaults to true. */
  showBanner?: boolean;
}

// Kept as a source string so it can be embedded verbatim inside the init script below
// (the init script runs in the page, so it cannot import classifier.ts directly).
const MUTATING_TEXT_PATTERN_SOURCE =
  "/\\b(delete|remove|destroy|discard|revoke|deactivate|unsubscribe|cancel|confirm|submit|save|update|pay|purchase|buy|checkout|order|send|transfer|withdraw|approve|reject|ban|block|archive|publish|post|sign\\s*up|sign\\s*out|log\\s*out|create)\\b/i";

const BANNER_INIT_SCRIPT = (allowMutations: boolean) => `
(() => {
  const MUTATING_TEXT = ${MUTATING_TEXT_PATTERN_SOURCE};
  const ALLOW_MUTATIONS = ${JSON.stringify(allowMutations)};

  function describe(el) {
    if (!el) return null;
    const tag = (el.tagName || "").toLowerCase();
    const type = (el.getAttribute && el.getAttribute("type") || "").toLowerCase();
    const role = (el.getAttribute && el.getAttribute("role") || "").toLowerCase();
    const text = (el.innerText || el.value || "").trim();
    const ariaLabel = (el.getAttribute && el.getAttribute("aria-label") || "").trim();
    const label = (text + " " + ariaLabel).trim();
    const inForm = !!(el.closest && el.closest("form"));
    const href = (el.getAttribute && el.getAttribute("href")) || "";

    if (tag === "button" && (type === "submit" || (type === "" && inForm))) return "button (submit)";
    if (tag === "input" && (type === "submit" || type === "image")) return "input[type=" + type + "]";
    if (label && MUTATING_TEXT.test(label)) return 'text "' + label + '"';
    if (role === "button" && label && MUTATING_TEXT.test(label)) return 'role=button "' + label + '"';
    if (tag === "a" && href.toLowerCase().startsWith("javascript:")) return "javascript: link";
    return null;
  }

  function closestInteractive(el) {
    let node = el;
    while (node && node !== document.body) {
      const tag = (node.tagName || "").toLowerCase();
      if (tag === "button" || tag === "a" || tag === "input" || (node.getAttribute && node.getAttribute("role") === "button")) {
        return node;
      }
      node = node.parentElement;
    }
    return el;
  }

  function showBanner(text, isError) {
    let el = document.getElementById("__sessionjar_banner__");
    if (!el) {
      el = document.createElement("div");
      el.id = "__sessionjar_banner__";
      el.style.position = "fixed";
      el.style.top = "0";
      el.style.left = "0";
      el.style.right = "0";
      el.style.zIndex = "2147483647";
      el.style.fontFamily = "monospace";
      el.style.fontSize = "13px";
      el.style.padding = "6px 10px";
      el.style.textAlign = "center";
      el.style.color = "#fff";
      document.documentElement.appendChild(el);
    }
    el.style.background = isError ? "#b00020" : (ALLOW_MUTATIONS ? "#a15c00" : "#1a5c1a");
    el.textContent = text;
  }

  window.addEventListener("DOMContentLoaded", () => {
    showBanner(
      ALLOW_MUTATIONS
        ? "SessionJar: MUTATIONS ALLOWED (--allow-mutations) - be careful"
        : "SessionJar: READ-ONLY MODE - clicks on mutating-looking elements will be blocked",
      false,
    );
  });
  // In case DOMContentLoaded already fired before this init script's listener attached.
  if (document.readyState !== "loading") {
    showBanner(
      ALLOW_MUTATIONS
        ? "SessionJar: MUTATIONS ALLOWED (--allow-mutations) - be careful"
        : "SessionJar: READ-ONLY MODE - clicks on mutating-looking elements will be blocked",
      false,
    );
  }

  document.addEventListener(
    "click",
    (event) => {
      if (ALLOW_MUTATIONS) return;
      const target = closestInteractive(event.target);
      const reason = describe(target);
      if (reason) {
        event.preventDefault();
        event.stopImmediatePropagation();
        showBanner("SessionJar BLOCKED a click on " + reason + " (read-only mode)", true);
        if (window.__sessionjarReportBlocked__) {
          window.__sessionjarReportBlocked__(reason);
        }
      }
    },
    { capture: true },
  );
})();
`;

/**
 * Wires up SessionJar's real, request-level guard: a Playwright route
 * handler that inspects every outgoing request and aborts anything that
 * looks mutating (POST/PUT/PATCH/DELETE) unless mutations are allowed.
 */
export async function installRequestGuard(
  context: BrowserContext,
  options: SessionJarOptions,
): Promise<void> {
  await context.route("**/*", (route: Route) => {
    const request = route.request();
    const method = request.method();
    if (!options.allowMutations && isMutatingMethod(method)) {
      const event: BlockedEvent = {
        kind: "request",
        method,
        url: request.url(),
        detail: `${method} ${request.url()}`,
      };
      options.onBlocked?.(event);
      void route.abort("accessdenied");
      return;
    }
    void route.continue();
  });
}

/** Installs the on-page banner + real-click DOM guard used by `sessionjar open`. */
export async function installClickBanner(
  context: BrowserContext,
  options: SessionJarOptions,
): Promise<void> {
  if (options.showBanner === false) return;
  await context.exposeBinding("__sessionjarReportBlocked__", (_source, reason: string) => {
    options.onBlocked?.({ kind: "click", detail: `blocked real click on ${reason}` });
  });
  await context.addInitScript(BANNER_INIT_SCRIPT(Boolean(options.allowMutations)));
}

/**
 * A thin, guarded wrapper around a real Playwright `Page`. This is the
 * documented API that `sessionjar run <storageState> <script.js>` hands to
 * user scripts. `.click()` is intercepted with a real Playwright locator
 * check before the underlying click is ever issued: if the target element
 * looks mutating and mutations aren't allowed, the click never happens and
 * a `SessionJarBlockedError` is thrown instead.
 *
 * The raw Playwright page is available as `.raw` for anything SessionJar
 * doesn't wrap yet -- using it bypasses the click guard, so prefer the
 * wrapped methods when driving a foreign/untrusted page.
 */
export class GuardedPage {
  readonly raw: Page;
  private readonly options: SessionJarOptions;

  constructor(page: Page, options: SessionJarOptions) {
    this.raw = page;
    this.options = options;
  }

  async goto(
    url: string,
    opts?: { timeout?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit"; referer?: string },
  ) {
    return this.raw.goto(url, opts);
  }

  /**
   * Real guard: inspects the target element's tag/type/role/text via a
   * Playwright locator *before* issuing the click. Throws
   * `SessionJarBlockedError` and never clicks if the element looks mutating
   * and mutations are not allowed.
   */
  async click(
    selector: string,
    opts?: { timeout?: number; force?: boolean; button?: "left" | "right" | "middle"; clickCount?: number },
  ): Promise<void> {
    const locator = this.raw.locator(selector).first();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signal: ElementSignal = await locator.evaluate((el: any) => {
      const attr = (name: string) => (el.getAttribute ? el.getAttribute(name) ?? "" : "");
      return {
        tagName: el.tagName,
        type: attr("type"),
        role: attr("role"),
        text: (el.innerText ?? el.value ?? "").trim(),
        ariaLabel: attr("aria-label"),
        inForm: !!(el.closest && el.closest("form")),
        href: attr("href"),
      };
    });

    if (!this.options.allowMutations && looksLikeMutatingElement(signal)) {
      const detail = `${selector} -> ${describeMutationReason(signal)}`;
      this.options.onBlocked?.({ kind: "click", detail, selector });
      throw new SessionJarBlockedError("click", detail);
    }

    await this.raw.click(selector, opts);
  }

  async fill(selector: string, value: string, opts?: { timeout?: number; force?: boolean }): Promise<void> {
    await this.raw.fill(selector, value, opts);
  }

  async waitForSelector(
    selector: string,
    opts?: { timeout?: number; state?: "attached" | "detached" | "visible" | "hidden" },
  ): Promise<import("playwright").ElementHandle<SVGElement | HTMLElement> | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.raw.waitForSelector(selector, opts as any);
  }

  async textContent(selector: string): Promise<string | null> {
    return this.raw.textContent(selector);
  }

  async title(): Promise<string> {
    return this.raw.title();
  }

  url(): string {
    return this.raw.url();
  }

  async close(): Promise<void> {
    await this.raw.close();
  }
}

export interface SessionJarHandle {
  browser: Browser;
  context: BrowserContext;
  page: GuardedPage;
  close: () => Promise<void>;
}

/**
 * Launches a real Chromium browser, loads a Playwright `storageState` export
 * into a fresh isolated context, and wires up both guard layers:
 *   1. Network-level: blocks mutating HTTP methods via `context.route`.
 *   2. Click-level: `GuardedPage.click()` refuses mutating-looking elements.
 * Plus (for interactive use) an on-page banner + real DOM click interceptor.
 */
export async function launchSession(
  storageStatePath: string,
  options: SessionJarOptions = {},
): Promise<SessionJarHandle> {
  if (!fs.existsSync(storageStatePath)) {
    throw new Error(
      `Storage state file not found: ${storageStatePath}\n` +
        `Export your own session first, e.g.:\n` +
        `  const ctx = await browser.newContext();\n` +
        `  // ...log in by hand in that context...\n` +
        `  await ctx.storageState({ path: "${storageStatePath}" });`,
    );
  }

  const headless = options.headless ?? true;
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ storageState: storageStatePath });

  await installRequestGuard(context, options);
  await installClickBanner(context, options);

  const rawPage = await context.newPage();
  const page = new GuardedPage(rawPage, options);

  return {
    browser,
    context,
    page,
    close: async () => {
      await browser.close();
    },
  };
}
