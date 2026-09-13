CREATE TABLE IF NOT EXISTS dc_model_usage (
  id TEXT PRIMARY KEY,
  product TEXT NOT NULL CHECK (product = 'opentrends'),
  model TEXT NOT NULL,
  operation TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  input_tokens INTEGER CHECK (input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens >= 0),
  cached_tokens INTEGER CHECK (cached_tokens >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'error'))
);
CREATE INDEX IF NOT EXISTS dc_model_usage_date ON dc_model_usage (occurred_at);
