UPDATE knowledge_runtime_profiles
SET session_config_json = jsonb_set(
  session_config_json,
  '{turn_detection,silence_duration_ms}',
  to_jsonb(900),
  true
)
WHERE COALESCE(session_config_json->'turn_detection'->>'silence_duration_ms', '') = '500';
