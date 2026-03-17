ALTER TABLE system_config
  ADD COLUMN IF NOT EXISTS prompt_layers_json JSONB;
