// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import colors from "../src/colors.js";

const { DEFAULT_BG, cssColorToHex, isLight, shellColors } = colors;

test("computed colours become #rrggbb", () => {
  assert.equal(cssColorToHex("rgb(10, 10, 10)"), "#0a0a0a");
  assert.equal(cssColorToHex("rgb(245, 245, 246)"), "#f5f5f6");
  assert.equal(cssColorToHex("rgba(245, 245, 246, 1)"), "#f5f5f6");
  assert.equal(cssColorToHex("rgb(245 245 246 / 100%)"), "#f5f5f6");
  assert.equal(cssColorToHex("#FFF"), "#ffffff");
  assert.equal(cssColorToHex(" #0A0A0A "), "#0a0a0a");
});

test("see-through, unknown or broken colours are refused", () => {
  assert.equal(cssColorToHex("rgba(0, 0, 0, 0)"), null);
  assert.equal(cssColorToHex("rgba(10, 10, 10, 0.5)"), null);
  assert.equal(cssColorToHex("transparent"), null);
  assert.equal(cssColorToHex("rgb(300, 0, 0)"), null);
  assert.equal(cssColorToHex("color-mix(in srgb, red, blue)"), null);
  assert.equal(cssColorToHex(undefined), null);
  assert.equal(cssColorToHex(42), null);
});

test("the website's two themes get the right bar icons", () => {
  // dark theme (default): light icons
  assert.equal(isLight("#0a0a0a"), false);
  assert.equal(shellColors("#0a0a0a").bars, "light");
  // light theme: dark icons
  assert.equal(isLight("#f5f5f6"), true);
  assert.equal(shellColors("#f5f5f6").bars, "dark");
  assert.equal(shellColors("#f5f5f6").bg, "#f5f5f6");
});

test("the default matches the website's default dark background", () => {
  assert.equal(DEFAULT_BG, "#0a0a0a");
  assert.equal(shellColors(DEFAULT_BG).light, false);
});
