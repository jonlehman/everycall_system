UPDATE knowledge_runtime_profiles
SET session_config_json = jsonb_set(
      jsonb_set(
        CASE
          WHEN jsonb_typeof(session_config_json) = 'object' THEN session_config_json
          ELSE '{}'::jsonb
        END,
        '{voice}',
        to_jsonb('ara'::text),
        TRUE
      ),
      '{turn_detection}',
      '{"type":"server_vad","threshold":0.9,"silence_duration_ms":350}'::jsonb,
      TRUE
    ),
    updated_at = NOW()
WHERE COALESCE(session_config_json #>> '{voice}', '') <> 'ara'
   OR COALESCE(session_config_json #> '{turn_detection,threshold}', 'null'::jsonb) <> '0.9'::jsonb
   OR COALESCE(session_config_json #> '{turn_detection,silence_duration_ms}', 'null'::jsonb) <> '350'::jsonb;
