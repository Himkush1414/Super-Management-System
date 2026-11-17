-- ============================================================================
-- NR Industries — 0027_inventory_role.sql
--
-- A new role, `inventory`, held by one fixed account that runs the store
-- (the Inventory module, 0028). A new enum value can't be used in the
-- transaction that adds it, so it gets its own migration (like 0022).
--
-- ADDITIVE ONLY: this widens public.user_role so it ALSO accepts
-- 'inventory'. Every existing value stays exactly as it is (head_admin,
-- admin, marketing, production, dispatcher) and no row is read or changed.
-- Numbered 0027 because 0025 / 0026 are taken by open pull requests.
-- ============================================================================

alter type public.user_role add value if not exists 'inventory';
