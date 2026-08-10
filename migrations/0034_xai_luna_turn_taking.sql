UPDATE knowledge_runtime_profiles
SET session_config_json = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              CASE
                WHEN jsonb_typeof(session_config_json) = 'object' THEN session_config_json
                ELSE '{}'::jsonb
              END
                - 'max_output_tokens'
                - 'maxOutputTokens'
                - 'max_response_output_tokens'
                - 'maxResponseOutputTokens'
                - 'noise_reduction'
                - 'noiseReduction'
                - 'modalities'
                - 'input_audio_transcription'
                - 'inputAudioTranscription'
                - 'reasoning_effort'
                - 'reasoningEffort'
                - 'turnDetection',
              '{model}',
              to_jsonb('grok-voice-think-fast-2.0'::text),
              TRUE
            ),
            '{voice}',
            to_jsonb('luna'::text),
            TRUE
          ),
          '{transcription_model}',
          to_jsonb('grok-transcribe'::text),
          TRUE
        ),
        '{reasoning}',
        '{"effort":"none"}'::jsonb,
        TRUE
      ),
      '{turn_detection}',
      '{"type":"server_vad","silence_duration_ms":350}'::jsonb,
      TRUE
    ),
    updated_at = NOW();
