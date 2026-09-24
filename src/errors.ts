/** Thrown when SessionJar refuses to perform an action because it looks mutating. */
export class SessionJarBlockedError extends Error {
  readonly kind: "click" | "request";
  readonly detail: string;

  constructor(kind: "click" | "request", detail: string) {
    super(
      `SessionJar blocked a ${kind === "click" ? "click" : "network request"}: ${detail}\n` +
        `SessionJar runs in read-only mode by default. Re-run with --allow-mutations ` +
        `(CLI) or { allowMutations: true } (API) if this action is intentional and safe.`,
    );
    this.name = "SessionJarBlockedError";
    this.kind = kind;
    this.detail = detail;
  }
}
