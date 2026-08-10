UPDATE knowledge_runtime_profiles
SET session_config_json = jsonb_set(
      CASE
        WHEN jsonb_typeof(session_config_json) = 'object' THEN session_config_json
        ELSE '{}'::jsonb
      END,
      '{reasoning}',
      '{"effort":"high"}'::jsonb,
      TRUE
    ),
    updated_at = NOW()
WHERE COALESCE(session_config_json #>> '{reasoning,effort}', '') <> 'high';
