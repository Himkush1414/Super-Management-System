// node --test: the role matrix (lib/permissions.ts). Every existing role
// keeps exactly the permissions it had; `inventory` gets the Inventory
// module only; the admin tier may only read it.
import test from "node:test";
import assert from "node:assert/strict";
import { ROLES, can, isAdminTier } from "../lib/permissions.ts";

const ALL = [
  "orders.punch", "orders.viewOwn", "orders.viewAssigned", "orders.viewAll", "orders.advanceStage",
  "orders.overrideStage", "price.view", "production.settings", "profile.edit", "roster.viewAll",
  "data.delete", "audit.view", "inventory.view", "inventory.manage",
];
const granted = (role) => ALL.filter((p) => can(role, p));

test("existing roles keep exactly their permissions (+ admin tier may view inventory)", () => {
  const adminTier = ["orders.viewAll", "orders.overrideStage", "price.view", "roster.viewAll", "data.delete", "audit.view"];
  assert.deepEqual(granted("head_admin"), [...adminTier, "inventory.view"]);
  assert.deepEqual(granted("admin"), [...adminTier, "inventory.view"]);
  assert.deepEqual(granted("marketing"), ["orders.punch", "orders.viewOwn", "price.view", "profile.edit"]);
  assert.deepEqual(granted("production"), ["orders.viewAssigned", "orders.advanceStage", "production.settings", "profile.edit"]);
});

test("inventory: the Inventory module and nothing else", () => {
  assert.deepEqual(granted("inventory"), ["inventory.view", "inventory.manage"]);
  assert.equal(isAdminTier("inventory"), false);
});

test("only inventory can change inventory; marketing and production can't even view it", () => {
  for (const role of ROLES) assert.equal(can(role, "inventory.manage"), role === "inventory", role);
  assert.equal(can("marketing", "inventory.view"), false);
  assert.equal(can("production", "inventory.view"), false);
  // the retired dispatcher role is still not a role of the app
  assert.equal(ROLES.includes("dispatcher"), false);
  assert.equal(can("dispatcher", "inventory.view"), false);
});
