-- ============================================================
-- Phase 4.5c — Retarget template anthropic agents to Opus
-- ============================================================
--
-- Template anthropic agents were on claude-sonnet-4-6 (both the
-- original authored choice AND the deepseek→sonnet retarget from
-- migration 0005). User request 2026-04-16: use Opus for all
-- anthropic template agents since it's the flagship reasoning model.
--
-- Idempotent — running twice is a no-op (the WHERE filter matches
-- nothing after the first run). Non-template agents untouched —
-- users who picked claude-sonnet-4-6 themselves keep their choice.

UPDATE "agents"
   SET model_id = 'claude-opus-4-7',
       updated_at = now()
 WHERE is_template = true
   AND model_provider = 'anthropic'
   AND model_id = 'claude-sonnet-4-6';
