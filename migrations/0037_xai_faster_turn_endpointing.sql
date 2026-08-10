UPDATE knowledge_runtime_profiles
SET session_config_json = jsonb_set(
      session_config_json,
      '{turn_detection,silence_duration_ms}',
      '200'::jsonb,
      TRUE
    ),
    updated_at = NOW()
WHERE COALESCE(session_config_json ->> 'model', '') = 'grok-voice-think-fast-2.0'
  AND COALESCE(session_config_json #>> '{turn_detection,type}', '') = 'server_vad'
  AND COALESCE(session_config_json #> '{turn_detection,silence_duration_ms}', 'null'::jsonb) <> '200'::jsonb;
