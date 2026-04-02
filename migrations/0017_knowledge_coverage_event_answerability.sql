ALTER TABLE knowledge_coverage_events
  ADD COLUMN IF NOT EXISTS observed_support_strength TEXT,
  ADD COLUMN IF NOT EXISTS kb_answerability TEXT,
  ADD COLUMN IF NOT EXISTS answered_from_kb BOOLEAN,
  ADD COLUMN IF NOT EXISTS unanswered_from_kb BOOLEAN,
  ADD COLUMN IF NOT EXISTS max_card_similarity DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS max_fact_similarity DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS selected_card_count INTEGER,
  ADD COLUMN IF NOT EXISTS selected_fact_count INTEGER,
  ADD COLUMN IF NOT EXISTS direct_answer_point_count INTEGER;

WITH computed AS (
  SELECT
    k.knowledge_coverage_event_id,
    COALESCE((
      SELECT MAX((entry->>'similarity')::double precision)
      FROM jsonb_array_elements(COALESCE(k.top_scores_json, '[]'::jsonb)) AS entry
      WHERE entry->>'kind' = 'card'
    ), 0) AS max_card_similarity,
    COALESCE((
      SELECT MAX((entry->>'similarity')::double precision)
      FROM jsonb_array_elements(COALESCE(k.top_scores_json, '[]'::jsonb)) AS entry
      WHERE entry->>'kind' = 'fact'
    ), 0) AS max_fact_similarity,
    COALESCE((
      SELECT COUNT(*)
      FROM jsonb_array_elements(COALESCE(k.top_scores_json, '[]'::jsonb)) AS entry
      WHERE
        (entry->>'kind' = 'card' AND (entry->>'similarity')::double precision >= 0.38)
        OR (entry->>'kind' = 'fact' AND (entry->>'similarity')::double precision >= 0.42)
    ), 0) AS corroborating_count
  FROM knowledge_coverage_events k
)
UPDATE knowledge_coverage_events AS target
SET
  max_card_similarity = computed.max_card_similarity,
  max_fact_similarity = computed.max_fact_similarity,
  observed_support_strength = CASE
    WHEN (computed.max_card_similarity >= 0.62 OR computed.max_fact_similarity >= 0.65) AND computed.corroborating_count >= 2 THEN 'strong'
    WHEN computed.max_card_similarity >= 0.38 OR computed.max_fact_similarity >= 0.42 THEN 'partial'
    ELSE 'none'
  END,
  kb_answerability = CASE
    WHEN (computed.max_card_similarity >= 0.62 OR computed.max_fact_similarity >= 0.65) AND computed.corroborating_count >= 2 THEN 'answered'
    WHEN computed.max_card_similarity >= 0.38 OR computed.max_fact_similarity >= 0.42 THEN 'partial'
    ELSE 'unanswered'
  END,
  answered_from_kb = CASE
    WHEN (computed.max_card_similarity >= 0.62 OR computed.max_fact_similarity >= 0.65) AND computed.corroborating_count >= 2 THEN TRUE
    WHEN computed.max_card_similarity >= 0.38 OR computed.max_fact_similarity >= 0.42 THEN TRUE
    ELSE FALSE
  END,
  unanswered_from_kb = CASE
    WHEN computed.max_card_similarity >= 0.38 OR computed.max_fact_similarity >= 0.42 THEN FALSE
    ELSE TRUE
  END,
  selected_card_count = COALESCE(target.selected_card_count, 0),
  selected_fact_count = COALESCE(target.selected_fact_count, 0),
  direct_answer_point_count = COALESCE(target.direct_answer_point_count, 0)
FROM computed
WHERE target.knowledge_coverage_event_id = computed.knowledge_coverage_event_id;
