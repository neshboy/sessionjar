import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Builds a synthetic (fake, made-up, non-sensitive) Playwright storageState
 * file for use against the local test server only. This exists purely to
 * exercise the real "load storageState into an isolated context" code path
 * with a real JSON file on disk -- it is NOT a real session and NEVER
 * contains real credentials. It's written under the OS temp dir, well
 * outside the repo, and callers should delete it when done.
 */
export async function writeFakeStorageState(originUrl: string): Promise<string> {
  const origin = new URL(originUrl);
  const state = {
    cookies: [
      {
        name: "fake_session_id",
        value: "synthetic-test-value-not-a-real-credential",
        domain: origin.hostname,
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: false,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [
      {
        origin: `${origin.protocol}//${origin.host}`,
        localStorage: [{ name: "sessionjar_test_flag", value: "synthetic" }],
      },
    ],
  };

  const filePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "sessionjar-test-")), "fake.storageState.json");
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
  return filePath;
}
