// node --test: the Inventory rules (lib/inventory/*), pure functions only —
// no database, no network. The same rules are proven against real Postgres
// in tests/sql/inventory.sql.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseQty, parsePaise, formatQty, formatINR, valueOf, qtyToText, checkQty, sum,
} from "../lib/inventory/numbers.ts";
import {
  emptyState, addProduct, record, reverse, rollover, currentFigures, monthFigures, rangeFigures,
  balanceOf, isEntryDateAllowed, addMonths, monthEnd,
} from "../lib/inventory/ledger.ts";
import { normalize, buildIndex, search, highlight } from "../lib/inventory/search.ts";
import { resolveRange, exportFileName } from "../lib/inventory/ranges.ts";

const q = (s) => parseQty(s);
let keySeq = 0;
const key = () => `test-key-${++keySeq}`;

function setup(today = "2026-11-17", opening = "10") {
  const s = emptyState();
  addProduct(s, { id: "p1", openingQty: q(opening), openingMonth: "" }, today);
  return s;
}
const fig = (f) => [formatQty(f.opening), formatQty(f.received), formatQty(f.issued), formatQty(f.closing)];

test("normal flow: opening + receiving − issue = balance", () => {
  const s = setup();
  assert.equal(record(s, { productId: "p1", kind: "receive", qty: q("5"), date: "2026-11-03", key: key() }, "2026-11-17").status, "ok");
  const r = record(s, { productId: "p1", kind: "issue", qty: q("3"), date: "2026-11-17", key: key() }, "2026-11-17");
  assert.equal(r.status, "ok");
  assert.equal(formatQty(r.before), "15");
  assert.equal(formatQty(r.after), "12");
  assert.deepEqual(fig(currentFigures(s, "p1", "2026-11-17")), ["10", "5", "3", "12"]);
});

test("zero stock: an issue down to exactly 0 works, nothing more can be issued", () => {
  const s = setup("2026-11-17", "4");
  assert.equal(formatQty(record(s, { productId: "p1", kind: "issue", qty: q("4"), date: "2026-11-17", key: key() }, "2026-11-17").after), "0");
  const r = record(s, { productId: "p1", kind: "issue", qty: q("0.001"), date: "2026-11-17", key: key() }, "2026-11-17");
  assert.equal(r.status, "insufficient");
  assert.equal(balanceOf(s.products.get("p1"), s.entries), BigInt(0));
});

test("over-issue is blocked and changes nothing", () => {
  const s = setup("2026-11-17", "10");
  const r = record(s, { productId: "p1", kind: "issue", qty: q("10.001"), date: "2026-11-17", key: key() }, "2026-11-17");
  assert.equal(r.status, "insufficient");
  assert.equal(formatQty(r.balance), "10");
  assert.equal(s.entries.length, 0);
});

test("decimal quantities are exact (no float drift)", () => {
  const s = setup("2026-11-17", "0");
  for (let i = 0; i < 10; i++) {
    record(s, { productId: "p1", kind: "receive", qty: q("0.1"), date: "2026-11-17", key: key() }, "2026-11-17");
  }
  assert.equal(qtyToText(balanceOf(s.products.get("p1"), s.entries)), "1");
  record(s, { productId: "p1", kind: "issue", qty: q("0.375"), date: "2026-11-17", key: key() }, "2026-11-17");
  assert.equal(qtyToText(balanceOf(s.products.get("p1"), s.entries)), "0.625");
  assert.equal(parseQty("1.2345"), null); // more than 3 decimals
  assert.equal(parseQty("2.500"), BigInt(2500));
  assert.equal(parseQty("1,250.5"), BigInt(1250500));
  assert.equal(parseQty("abc"), null);
  assert.equal(checkQty("0").ok, false);
  assert.equal(checkQty("-2").ok, false);
  assert.equal(checkQty("1.2345").ok, false);
  assert.deepEqual(checkQty(" 2.5 "), { ok: true, qty: BigInt(2500) });
});

test("entry date: today by default, inside the current month, never in the future", () => {
  assert.equal(isEntryDateAllowed("2026-11-17", "2026-11-17"), true);
  assert.equal(isEntryDateAllowed("2026-11-01", "2026-11-17"), true);
  assert.equal(isEntryDateAllowed("2026-10-31", "2026-11-17"), false);
  assert.equal(isEntryDateAllowed("2026-11-18", "2026-11-17"), false);
  assert.equal(isEntryDateAllowed("2026-02-30", "2026-02-17"), false);
  const s = setup();
  assert.equal(record(s, { productId: "p1", kind: "receive", qty: q("1"), date: "2026-10-31", key: key() }, "2026-11-17").status, "invalid");
});

test("month rollover: opening = previous month's closing, fixed for the month", () => {
  const s = setup("2026-10-10", "50");
  record(s, { productId: "p1", kind: "receive", qty: q("20"), date: "2026-10-10", key: key() }, "2026-10-10");
  record(s, { productId: "p1", kind: "issue", qty: q("5.5"), date: "2026-10-12", key: key() }, "2026-10-12");
  assert.deepEqual(rollover(s, "2026-11-01"), ["2026-10-01"]);
  assert.deepEqual(fig(s.snapshots.get("p1|2026-10-01")), ["50", "20", "5.5", "64.5"]);
  // November opens with October's closing; entries in November never move it
  record(s, { productId: "p1", kind: "issue", qty: q("4.5"), date: "2026-11-02", key: key() }, "2026-11-02");
  const nov = currentFigures(s, "p1", "2026-11-02");
  assert.deepEqual(fig(nov), ["64.5", "0", "4.5", "60"]);
  // idempotent
  assert.deepEqual(rollover(s, "2026-11-20"), []);
  assert.equal(s.snapshots.size, 1);
});

test("multi-month gap: every missing month is closed in order", () => {
  const s = setup("2026-09-10", "50");
  record(s, { productId: "p1", kind: "issue", qty: q("10"), date: "2026-09-10", key: key() }, "2026-09-10");
  assert.deepEqual(rollover(s, "2027-01-05"), ["2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01"]);
  const months = ["2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01"];
  const snaps = months.map((m) => s.snapshots.get(`p1|${m}`));
  assert.deepEqual(fig(snaps[0]), ["50", "0", "10", "40"]);
  for (let i = 1; i < snaps.length; i++) assert.equal(snaps[i].opening, snaps[i - 1].closing);
  assert.equal(formatQty(currentFigures(s, "p1", "2027-01-05").opening), "40");
  // snapshots agree with figures computed straight from the ledger
  for (const m of months) assert.deepEqual(s.snapshots.get(`p1|${m}`), monthFigures(s.products.get("p1"), s.entries, m));
});

test("reverse entry: a new opposite entry; once; not a reversal; this month only", () => {
  const s = setup("2026-11-17", "0");
  const rec = record(s, { productId: "p1", kind: "receive", qty: q("100"), date: "2026-11-05", key: key() }, "2026-11-17");
  const iss = record(s, { productId: "p1", kind: "issue", qty: q("30"), date: "2026-11-06", key: key() }, "2026-11-17");
  // balance 70: undoing the 100 receipt would make it negative
  assert.equal(reverse(s, rec.id, key(), "2026-11-17").status, "insufficient");
  const r = reverse(s, iss.id, key(), "2026-11-17");
  assert.equal(r.status, "ok");
  assert.equal(formatQty(r.after), "100");
  // the reversal nets out of the Issue column; the original stays
  assert.deepEqual(fig(currentFigures(s, "p1", "2026-11-17")), ["0", "100", "0", "100"]);
  assert.equal(s.entries.length, 3);
  assert.equal(reverse(s, iss.id, key(), "2026-11-17").status, "invalid");
  assert.equal(reverse(s, r.id, key(), "2026-11-17").status, "invalid");
  // a closed month's entry can't be reversed
  assert.equal(reverse(s, rec.id, key(), "2026-12-01").status, "invalid");
});

test("double submit: the same key records once", () => {
  const s = setup("2026-11-17", "0");
  const k = key();
  const a = record(s, { productId: "p1", kind: "receive", qty: q("7"), date: "2026-11-17", key: k }, "2026-11-17");
  const b = record(s, { productId: "p1", kind: "receive", qty: q("7"), date: "2026-11-17", key: k }, "2026-11-17");
  assert.equal(a.status, "ok");
  assert.equal(b.status, "duplicate");
  assert.equal(b.id, a.id);
  assert.equal(s.entries.length, 1);
  assert.equal(formatQty(balanceOf(s.products.get("p1"), s.entries)), "7");
});

test("archived products take no entries", () => {
  const s = setup();
  s.products.get("p1").active = false;
  assert.equal(record(s, { productId: "p1", kind: "receive", qty: q("1"), date: "2026-11-17", key: key() }, "2026-11-17").status, "archived");
});

test("range figures: opening before the start, sums inside, closing at the end", () => {
  const s = setup("2026-11-05", "10");
  record(s, { productId: "p1", kind: "receive", qty: q("4"), date: "2026-11-02", key: key() }, "2026-11-05");
  record(s, { productId: "p1", kind: "issue", qty: q("1"), date: "2026-11-04", key: key() }, "2026-11-05");
  record(s, { productId: "p1", kind: "issue", qty: q("2"), date: "2026-11-05", key: key() }, "2026-11-05");
  assert.deepEqual(fig(rangeFigures(s.products.get("p1"), s.entries, "2026-11-03", "2026-11-04")), ["14", "0", "1", "13"]);
});

test("INR and quantities in en-IN", () => {
  assert.equal(formatINR(parsePaise("123456")), "₹1,23,456.00");
  assert.equal(formatINR(parsePaise("1234567.5")), "₹12,34,567.50");
  assert.equal(formatINR(parsePaise("0.05")), "₹0.05");
  assert.equal(formatINR(BigInt(-12345)), "−₹123.45");
  assert.equal(formatQty(parseQty("1234567.125")), "12,34,567.125");
  assert.equal(formatQty(parseQty("100")), "100");
  assert.equal(parsePaise("3.555"), null);
  // value = qty × rate, half up to the paisa
  assert.equal(formatINR(valueOf(parseQty("3"), parsePaise("3.5"))), "₹10.50");
  assert.equal(formatINR(valueOf(parseQty("0.333"), parsePaise("1.5"))), "₹0.50"); // 0.4995 -> 0.50
  assert.equal(formatINR(valueOf(parseQty("2"), null)), "₹0.00");
  assert.equal(sum([BigInt(1), BigInt(2)]), BigInt(3));
});

test("search: case-insensitive, extra spaces ignored, every word, any field", () => {
  const items = [
    { s: "AB-001", d: "Sample  Cable Lug", sp: "16 Sq.mm", c: ["Nos."] },
    { s: "AB-002", d: "Sample Gizmo", sp: "1/2 inch", c: ["Kg"] },
    { s: "XY-910", d: "Dummy sleeve", sp: "Ø 10 mm", c: [] },
  ];
  const idx = buildIndex(items, (x) => [x.s, x.d, x.sp, ...x.c]);
  assert.deepEqual(search(idx, ""), [0, 1, 2]);
  assert.deepEqual(search(idx, "   cable    lug  "), [0]);
  assert.deepEqual(search(idx, "LUG 16"), [0]);
  assert.deepEqual(search(idx, "ab-00"), [0, 1]);
  assert.deepEqual(search(idx, "kg"), [1]);
  assert.deepEqual(search(idx, "sample nothing"), []);
  assert.equal(normalize("  A   b  "), "a b");
  const seg = highlight("Sample  Cable Lug", "cable lug");
  assert.deepEqual(seg.filter((x) => x.hit).map((x) => x.text), ["Cable", "Lug"]);
  assert.equal(seg.map((x) => x.text).join(""), "Sample  Cable Lug");
});

test("search over 350 products stays far under 100 ms", () => {
  const items = Array.from({ length: 400 }, (_, i) => ({ s: `ZZ-${i}`, d: `Sample item number ${i}`, sp: `${i} mm` }));
  const idx = buildIndex(items, (x) => [x.s, x.d, x.sp]);
  const t0 = performance.now();
  for (const qy of ["s", "sa", "sam", "samp", "sample", "sample i", "sample it", "1", "12", "123"]) search(idx, qy);
  assert.ok(performance.now() - t0 < 100);
});

test("export ranges (IST days) and the file name", () => {
  assert.deepEqual(resolveRange("week", "2026-11-19"), { from: "2026-11-16", to: "2026-11-19", label: "This week" });
  assert.deepEqual(resolveRange("week", "2026-11-16"), { from: "2026-11-16", to: "2026-11-16", label: "This week" });
  assert.deepEqual(resolveRange("month", "2026-11-17"), { from: "2026-11-01", to: "2026-11-17", label: "This month" });
  assert.deepEqual(resolveRange("prev_month", "2026-03-05"), { from: "2026-02-01", to: "2026-02-28", label: "Previous month" });
  assert.deepEqual(resolveRange("prev_month", "2027-01-05"), { from: "2026-12-01", to: "2026-12-31", label: "Previous month" });
  assert.equal(resolveRange("all", "2026-11-17", { earliest: "2026-09-01" }).from, "2026-09-01");
  assert.equal(resolveRange("custom", "2026-11-17", { from: "2026-11-10", to: "2026-11-01" }), null);
  assert.equal(resolveRange("custom", "2026-11-17", { from: "2026-11-01", to: "2026-12-31" }).to, "2026-11-17");
  assert.equal(resolveRange("custom", "2026-11-17", { from: "2026-13-01", to: "2026-11-01" }), null);
  assert.equal(exportFileName("2026-11-01", "2026-11-17", "pdf"), "NR Industries Product Specification 01-11-2026 to 17-11-2026.pdf");
  assert.equal(addMonths("2026-12-01", 1), "2027-01-01");
  assert.equal(monthEnd("2028-02-10"), "2028-02-29");
});

// ── speed & quality pass ─────────────────────────────────────────────────
import { pageProducts } from "../lib/inventory/types.ts";
import { summarize } from "../lib/inventory/numbers.ts";
import { entryFingerprint, nextKey } from "../lib/inventory/ledger.ts";
import { istToday } from "../lib/inventory/ranges.ts";

test("compact page rows become the same product objects", () => {
  const fields = ["id", "serial_no", "description", "specification", "rate", "custom", "is_active", "opening", "received", "issued", "balance"];
  const rows = [["p1", "AB-1", "Sample", "", "3.5", { c1: "Nos." }, true, "10", "2.5", "1", "11.5"], ["p2", "AB-2", "Dummy", "x", null, {}, false, "0", "0", "0", "0"]];
  const out = pageProducts({ fields, rows });
  assert.deepEqual(out[0], { id: "p1", serial_no: "AB-1", description: "Sample", specification: "", rate: "3.5", custom: { c1: "Nos." }, is_active: true, opening: "10", received: "2.5", issued: "1", balance: "11.5" });
  assert.equal(out[1].rate, null);
  // field order is read from `fields`, not assumed
  const shuffled = pageProducts({ fields: [...fields].reverse(), rows: rows.map((r) => [...r].reverse()) });
  assert.deepEqual(shuffled, out);
});

test("summary: one definition for the screen and the exports (archived not in stock value)", () => {
  const P = (v) => parsePaise(v);
  const rows = [
    { is_active: true, r: q("5"), i: q("1"), b: q("10"), ratePaise: P("2.50") },
    { is_active: true, r: q("0"), i: q("0"), b: q("0"), ratePaise: P("1") },
    { is_active: false, r: q("2"), i: q("0"), b: q("2"), ratePaise: P("100") },
  ];
  const s = summarize(rows);
  assert.equal(s.products, 2);
  assert.equal(s.zero, 1);
  assert.equal(formatINR(s.value), "₹25.00"); // 10 × 2.50; the archived 2 × 100 is not counted
  assert.equal(formatQty(s.received), "7"); // movements count for every product
  assert.equal(formatINR(s.receivedValue), "₹212.50");
  assert.equal(formatQty(s.issued), "1");
});

test("idempotency key: same entry keeps its key, a changed entry gets a new one", () => {
  let n = 0;
  const make = () => `k${++n}`;
  const a = nextKey(null, entryFingerprint("p1", "receive", "5", "2026-11-17", ""), make);
  assert.equal(a.key, "k1");
  // retry of the same entry (lost answer): same key, recorded once
  assert.equal(nextKey(a, entryFingerprint("p1", "receive", "5", "2026-11-17", " "), make).key, "k1");
  // quantity corrected after a failed attempt: new key, never "already saved" for the old one
  assert.equal(nextKey(a, entryFingerprint("p1", "receive", "50", "2026-11-17", ""), make).key, "k2");
  assert.notEqual(nextKey(a, entryFingerprint("p1", "issue", "5", "2026-11-17", ""), make).key, "k1");
  assert.notEqual(nextKey(a, entryFingerprint("p1", "receive", "5", "2026-11-16", ""), make).key, "k1");
});

test("today in IST, whatever the device's zone (a tab left open past midnight moves on)", () => {
  assert.equal(istToday(new Date("2026-11-17T18:29:59Z")), "2026-11-17"); // 23:59:59 IST
  assert.equal(istToday(new Date("2026-11-17T18:30:00Z")), "2026-11-18"); // 00:00 IST next day
  assert.equal(istToday(new Date("2026-11-30T19:00:00Z")), "2026-12-01"); // month turns in India first
});

// ── details, minimum stock, Party search ─────────────────────────────────
import { isLow, shortfall } from "../lib/inventory/numbers.ts";
import { partyKey, partyLines, matchParty, suggestParties, addPartyName } from "../lib/inventory/party.ts";

test("low stock boundaries: below, equal, no minimum, decimals, zero", () => {
  assert.equal(isLow(q("4"), q("5")), true);
  assert.equal(isLow(q("5"), q("5")), false); // equal is not low
  assert.equal(isLow(q("0"), null), false); // no minimum, never
  assert.equal(isLow(q("2.499"), q("2.5")), true); // decimals exact
  assert.equal(isLow(q("2.5"), q("2.500")), false);
  assert.equal(isLow(q("0"), q("1")), true); // zero with a minimum: low (shown as Out of stock)
  assert.equal(formatQty(shortfall(q("2.499"), q("2.5"))), "0.001");
  assert.equal(shortfall(q("9"), q("2")), BigInt(0));
  assert.equal(shortfall(q("1"), null), BigInt(0));
});

test("party names: case and extra spaces don't matter (same rule as the database)", () => {
  assert.equal(partyKey("  Shree   Dummy  Traders "), "shree dummy traders");
  assert.equal(partyKey("SHREE DUMMY TRADERS"), partyKey("shree dummy traders"));
  assert.equal(partyKey(null), "");
  assert.deepEqual(addPartyName(["Alpha Dummy", "beta dummy"], "  BETA   Dummy "), ["Alpha Dummy", "BETA Dummy"]);
  assert.deepEqual(suggestParties(["Dummy Traders", "Other Dummy Co", "Traders Dummy"], "  dummy "), ["Dummy Traders", "Other Dummy Co", "Traders Dummy"]);
  assert.deepEqual(suggestParties(["Dummy Traders", "Other Dummy Co", "Traders Dummy"], "TRADERS"), ["Traders Dummy", "Dummy Traders"]);
  assert.deepEqual(suggestParties(["Dummy Traders"], "zzz"), []);
});

test("party search: only products received from the party, all lines grouped", () => {
  const ix = {
    fields: ["product_id", "party_key", "party", "qty", "challan_no", "bill_no", "bill_date", "last_date"],
    rows: [
      ["p1", "dummy traders", "Dummy Traders", "14", "C2", "B2", "2026-11-16", "2026-11-17"],
      ["p2", "other dummy co", "Other Dummy Co", "2", null, null, null, "2026-11-17"],
      ["p3", "dummy traders", "Dummy Traders", "1.5", "C9", null, null, "2026-10-02"],
    ],
  };
  const lines = partyLines(ix);
  const m = matchParty(lines, "  DUMMY   traders");
  assert.deepEqual([...m.keys()].sort(), ["p1", "p3"]);
  assert.equal(m.get("p1")[0].challanNo, "C2");
  assert.equal(matchParty(lines, "").size, 0); // no party typed: no party filter
  assert.equal(matchParty(lines, "nobody").size, 0);
  assert.deepEqual([...matchParty(lines, "dummy").keys()].sort(), ["p1", "p2", "p3"]);
});

test("party search stays fast on 3,500 products", () => {
  const rows = [];
  for (let i = 0; i < 3500; i++) for (let j = 0; j < 3; j++) rows.push([`p${i}`, `dummy party ${(i * 7 + j) % 400}`, `Dummy Party ${(i * 7 + j) % 400}`, "1", null, null, null, "2026-11-01"]);
  const lines = partyLines({ fields: ["product_id", "party_key", "party", "qty", "challan_no", "bill_no", "bill_date", "last_date"], rows });
  const names = [...new Set(rows.map((r) => r[2]))];
  const t0 = performance.now();
  for (const typed of ["d", "du", "dum", "dumm", "dummy", "dummy p", "dummy party 1", "dummy party 12", "dummy party 123"]) {
    matchParty(lines, typed);
    suggestParties(names, typed);
  }
  const per = (performance.now() - t0) / 9;
  assert.ok(per < 100, `${per} ms per keystroke`);
});
