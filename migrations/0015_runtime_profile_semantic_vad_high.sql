UPDATE knowledge_runtime_profiles
SET session_config_json = jsonb_set(
  jsonb_set(
    session_config_json,
    '{turn_detection,type}',
    to_jsonb('semantic_vad'::text),
    true
  ),
  '{turn_detection,eagerness}',
  to_jsonb('high'::text),
  true
)
WHERE COALESCE(session_config_json->'turn_detection'->>'type', '') <> 'semantic_vad'
   OR COALESCE(session_config_json->'turn_detection'->>'eagerness', '') <> 'high';
