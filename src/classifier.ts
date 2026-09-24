/**
 * Pure classification logic for SessionJar's read-only guard rails.
 *
 * Nothing in this file touches a browser, the network, or the filesystem.
 * That's deliberate: these are the rules that decide whether an HTTP
 * request or a DOM element "looks mutating", and they need to be testable
 * (and auditable) in complete isolation from Playwright.
 *
 * IMPORTANT: this is a heuristic, not a proof. See README.md "Limitations".
 * When in doubt, these functions are written to err toward classifying
 * something as mutating (safe-by-default) rather than missing it.
 */

/** HTTP methods that this tool treats as state-changing by default. */
export const MUTATING_HTTP_METHODS = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

/**
 * Returns true if an HTTP method is considered mutating (i.e. it would
 * normally change state on the server) and should be blocked unless
 * mutations are explicitly allowed.
 */
export function isMutatingMethod(method: string | undefined | null): boolean {
  if (!method) return false;
  return MUTATING_HTTP_METHODS.has(method.toUpperCase());
}

/**
 * Words/phrases that, when they appear in a control's visible text or
 * accessible label, suggest the control performs a destructive or
 * state-changing action. Deliberately conservative in *coverage* (a short,
 * legible list) but conservative in *behavior* (favors flagging).
 */
export const MUTATING_TEXT_PATTERN =
  /\b(delete|remove|destroy|discard|revoke|deactivate|unsubscribe|cancel|confirm|submit|save|update|pay|purchase|buy|checkout|order|send|transfer|withdraw|approve|reject|ban|block|archive|publish|post|sign\s*up|sign\s*out|log\s*out|create)\b/i;

/** Shape of the minimal element info the classifier needs. All fields optional. */
export interface ElementSignal {
  /** Lowercase or mixed-case tag name, e.g. "button", "a", "input". */
  tagName?: string;
  /** The element's `type` attribute, e.g. "submit", "button", "checkbox". */
  type?: string;
  /** The element's ARIA role, explicit or implicit, e.g. "button", "link". */
  role?: string;
  /** Visible text content of the element (and reasonable descendants). */
  text?: string;
  /** aria-label / aria-labelledby resolved text, if any. */
  ariaLabel?: string;
  /** True if the element is inside a <form>. Affects default button semantics. */
  inForm?: boolean;
  /** The href for anchor tags, used to catch javascript: pseudo-actions. */
  href?: string;
}

function normalize(text: string | undefined | null): string {
  return (text ?? "").trim();
}

/**
 * Decides whether an element "looks like" it triggers a mutating / state
 * changing action. This is the heuristic used to gate `.click()` calls.
 *
 * Rules (any one match is enough to classify as mutating):
 *  1. `<button type="submit">`, or `<button>` with no explicit type that
 *     lives inside a `<form>` (HTML's default button behavior is to submit).
 *  2. `<input type="submit">` / `<input type="image">`.
 *  3. Visible text or aria-label matches a destructive/mutating verb list
 *     (delete, remove, confirm, submit, pay, purchase, etc).
 *  4. Anything with role="button" whose text/label matches the same list.
 *  5. A `javascript:` href on an anchor tag (opaque behavior -> treat as risky).
 */
export function looksLikeMutatingElement(el: ElementSignal): boolean {
  const tag = normalize(el.tagName).toLowerCase();
  const type = normalize(el.type).toLowerCase();
  const role = normalize(el.role).toLowerCase();
  const label = `${normalize(el.text)} ${normalize(el.ariaLabel)}`.trim();

  if (tag === "button" && (type === "submit" || (type === "" && el.inForm))) {
    return true;
  }

  if (tag === "input" && (type === "submit" || type === "image")) {
    return true;
  }

  if (label && MUTATING_TEXT_PATTERN.test(label)) {
    return true;
  }

  if (role === "button" && label && MUTATING_TEXT_PATTERN.test(label)) {
    return true;
  }

  if (tag === "a" && normalize(el.href).toLowerCase().startsWith("javascript:")) {
    return true;
  }

  return false;
}

/** Human-readable reason string, useful for CLI/log output when something is blocked. */
export function describeMutationReason(el: ElementSignal): string {
  const tag = normalize(el.tagName).toLowerCase();
  const type = normalize(el.type).toLowerCase();
  const label = normalize(el.text) || normalize(el.ariaLabel);

  if (tag === "button" && (type === "submit" || (type === "" && el.inForm))) {
    return `<button> ${type === "submit" ? 'type="submit"' : "with default submit behavior inside a <form>"}`;
  }
  if (tag === "input" && (type === "submit" || type === "image")) {
    return `<input type="${type}">`;
  }
  if (tag === "a" && normalize(el.href).toLowerCase().startsWith("javascript:")) {
    return `<a> with a javascript: href`;
  }
  if (label) {
    return `element text/label "${label}" matches a mutating-action pattern`;
  }
  return "element matched the mutating-element heuristic";
}
