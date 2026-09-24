// Example automation script for `sessionjar run <storageStateFile> examples/example-script.mjs`.
//
// SessionJar hands your script a `page` object (a SessionJar GuardedPage --
// see src/session.ts) that wraps a real Playwright Page. Reads work exactly
// like Playwright. Anything that looks like a mutation is refused unless
// the user ran with --allow-mutations.
//
// Replace the URL/selectors below with something from YOUR OWN exported
// session before running this for real.

export default async function main(page) {
  await page.goto("https://example.com/");
  console.log("Page title:", await page.title());

  // Reading text/links is always allowed.
  // await page.click("#some-read-only-link");

  // This would throw a SessionJarBlockedError unless --allow-mutations was
  // passed on the CLI (or { allowMutations: true } was set via the API),
  // because it looks like a destructive/state-changing control:
  // await page.click("button:has-text('Delete')");
}
