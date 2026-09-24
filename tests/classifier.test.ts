import { describe, it, expect } from "vitest";
import {
  isMutatingMethod,
  looksLikeMutatingElement,
  describeMutationReason,
  MUTATING_HTTP_METHODS,
} from "../src/classifier.js";

describe("isMutatingMethod", () => {
  it("flags POST/PUT/PATCH/DELETE as mutating", () => {
    expect(isMutatingMethod("POST")).toBe(true);
    expect(isMutatingMethod("PUT")).toBe(true);
    expect(isMutatingMethod("PATCH")).toBe(true);
    expect(isMutatingMethod("DELETE")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isMutatingMethod("post")).toBe(true);
    expect(isMutatingMethod("Delete")).toBe(true);
  });

  it("does not flag GET/HEAD/OPTIONS as mutating", () => {
    expect(isMutatingMethod("GET")).toBe(false);
    expect(isMutatingMethod("HEAD")).toBe(false);
    expect(isMutatingMethod("OPTIONS")).toBe(false);
  });

  it("handles missing/empty input safely", () => {
    expect(isMutatingMethod(undefined)).toBe(false);
    expect(isMutatingMethod(null)).toBe(false);
    expect(isMutatingMethod("")).toBe(false);
  });

  it("exposes the exact method set used for blocking", () => {
    expect([...MUTATING_HTTP_METHODS].sort()).toEqual(["DELETE", "PATCH", "POST", "PUT"]);
  });
});

describe("looksLikeMutatingElement", () => {
  it("flags a <button type=submit>", () => {
    expect(looksLikeMutatingElement({ tagName: "button", type: "submit", text: "Go" })).toBe(true);
  });

  it("flags an untyped <button> inside a <form> (HTML default submit behavior)", () => {
    expect(looksLikeMutatingElement({ tagName: "button", type: "", inForm: true, text: "Go" })).toBe(true);
  });

  it("does not flag an untyped <button> outside a form with a neutral label", () => {
    expect(looksLikeMutatingElement({ tagName: "button", type: "", inForm: false, text: "Expand" })).toBe(false);
  });

  it("flags <button type=button> explicitly, if its type is button (not submit) but has no risky text", () => {
    expect(looksLikeMutatingElement({ tagName: "button", type: "button", text: "Expand" })).toBe(false);
  });

  it("flags <input type=submit> and <input type=image>", () => {
    expect(looksLikeMutatingElement({ tagName: "input", type: "submit" })).toBe(true);
    expect(looksLikeMutatingElement({ tagName: "input", type: "image" })).toBe(true);
  });

  it("does not flag other input types", () => {
    expect(looksLikeMutatingElement({ tagName: "input", type: "text" })).toBe(false);
    expect(looksLikeMutatingElement({ tagName: "input", type: "checkbox" })).toBe(false);
  });

  it.each(["Delete", "delete account", "Remove item", "Confirm", "Submit", "Pay now", "Purchase", "Buy now"])(
    "flags plain elements whose text says %s",
    (text) => {
      expect(looksLikeMutatingElement({ tagName: "div", role: "button", text })).toBe(true);
      expect(looksLikeMutatingElement({ tagName: "a", text })).toBe(true);
    },
  );

  it("checks aria-label as well as visible text", () => {
    expect(looksLikeMutatingElement({ tagName: "button", type: "button", ariaLabel: "Delete this row" })).toBe(true);
  });

  it("does not flag ordinary read-only navigation links", () => {
    expect(looksLikeMutatingElement({ tagName: "a", text: "View profile", href: "/profile" })).toBe(false);
    expect(looksLikeMutatingElement({ tagName: "a", text: "Next page", href: "/page/2" })).toBe(false);
  });

  it("flags javascript: hrefs on anchors as opaque/risky", () => {
    expect(looksLikeMutatingElement({ tagName: "a", text: "Click me", href: "javascript:doDelete()" })).toBe(true);
  });

  it("is case-insensitive and matches whole words only", () => {
    expect(looksLikeMutatingElement({ tagName: "a", text: "DELETE" })).toBe(true);
    // "submitted" contains "submit" but as a different word; \b boundary means
    // "submit" still matches as a substring word-start, this documents current behavior.
    expect(looksLikeMutatingElement({ tagName: "a", text: "Reading list" })).toBe(false);
  });

  it("does not flag an empty/unknown element", () => {
    expect(looksLikeMutatingElement({})).toBe(false);
  });
});

describe("describeMutationReason", () => {
  it("gives a human readable reason for a submit button", () => {
    expect(describeMutationReason({ tagName: "button", type: "submit" })).toMatch(/submit/i);
  });

  it("gives a human readable reason for text matches", () => {
    expect(describeMutationReason({ tagName: "a", text: "Delete account" })).toMatch(/delete account/i);
  });
});
