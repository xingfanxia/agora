-- ============================================================
-- Phase 6 — Retarget template agents off deepseek
-- ============================================================
--
-- Production currently has ANTHROPIC_API_KEY, OPENAI_API_KEY, and
-- GOOGLE_API_KEY set, but not DEEPSEEK_API_KEY. Template agents
-- bound to deepseek would silently fail mid-room. This migration
-- swaps all template-agent deepseek references to claude-sonnet-4-6.
--
-- Idempotent — running twice is a no-op (the WHERE filter matches
-- nothing after the first run). Non-template agents are untouched
-- (users who explicitly pick deepseek know to set the key).

UPDATE "agents"
   SET model_provider = 'anthropic',
       model_id = 'claude-sonnet-4-6',
       updated_at = now()
 WHERE is_template = true
   AND model_provider = 'deepseek';
