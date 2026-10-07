-- ============================================================================
-- NR Industries — 0022_dispatcher_role.sql
--
-- A fifth role, `dispatcher`, held by two fixed accounts (dispatcher1,
-- dispatcher2). A new enum value can't be used in the transaction that adds
-- it, so it gets its own migration; 0023 builds the dispatch step on it.
-- Additive only: no existing row changes.
-- ============================================================================

alter type public.user_role add value if not exists 'dispatcher';
