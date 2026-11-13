// node --test: how route refresh triggers are merged (lib/refresh.ts)
import test from "node:test";
import assert from "node:assert/strict";
import {
  REJOIN_WAIT_MS,
  SETTLE_MS,
  channelRejoining,
  refreshForChange,
  refreshIfStale,
  resetRefreshState,
} from "../lib/refresh.ts";

function setup(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  resetRefreshState();
  const router = { n: 0, refresh() { this.n++; } };
  return router;
}

test("the first 'may be old' refresh runs; one right after it is dropped", (t) => {
  const r = setup(t);
  assert.equal(refreshIfStale(r), "refreshed");
  t.mock.timers.tick(200);
  assert.equal(refreshIfStale(r), "dropped");
  assert.equal(r.n, 1);
  t.mock.timers.tick(SETTLE_MS);
  assert.equal(refreshIfStale(r), "refreshed");
  assert.equal(r.n, 2);
});

test("a change always refreshes, even right after another refresh", (t) => {
  const r = setup(t);
  refreshIfStale(r);
  refreshForChange(r);
  refreshForChange(r);
  assert.equal(r.n, 3);
});

test("a change also makes the next 'may be old' refresh unnecessary", (t) => {
  const r = setup(t);
  refreshForChange(r);
  assert.equal(refreshIfStale(r), "dropped");
  assert.equal(r.n, 1);
});

test("while a live channel rejoins, 'may be old' waits for its own refresh", (t) => {
  const r = setup(t);
  channelRejoining(true);
  assert.equal(refreshIfStale(r), "waiting");
  assert.equal(refreshIfStale(r), "waiting");
  assert.equal(r.n, 0);
  // the channel is back: its resync refresh is the only one
  channelRejoining(false);
  refreshForChange(r);
  t.mock.timers.tick(REJOIN_WAIT_MS * 2);
  assert.equal(r.n, 1);
});

test("a channel that never comes back: the waiting refresh runs anyway", (t) => {
  const r = setup(t);
  channelRejoining(true);
  refreshIfStale(r);
  t.mock.timers.tick(REJOIN_WAIT_MS - 1);
  assert.equal(r.n, 0);
  t.mock.timers.tick(1);
  assert.equal(r.n, 1);
});

test("the rejoining count never goes below zero", (t) => {
  const r = setup(t);
  channelRejoining(false);
  channelRejoining(false);
  assert.equal(refreshIfStale(r), "refreshed");
});
