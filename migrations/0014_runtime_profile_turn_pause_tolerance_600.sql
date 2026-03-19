UPDATE knowledge_runtime_profiles
SET session_config_json = jsonb_set(
  session_config_json,
  '{turn_detection,silence_duration_ms}',
  to_jsonb(600),
  true
)
WHERE COALESCE(session_config_json->'turn_detection'->>'silence_duration_ms', '') = '900';
