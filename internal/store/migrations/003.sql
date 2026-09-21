-- Detailed audit + retention (003)
ALTER TABLE audit_log ADD COLUMN source TEXT NOT NULL DEFAULT 'agent';
ALTER TABLE audit_log ADD COLUMN ip TEXT;
ALTER TABLE audit_log ADD COLUMN user_agent TEXT;
ALTER TABLE audit_log ADD COLUMN method TEXT;
ALTER TABLE audit_log ADD COLUMN status INTEGER;
ALTER TABLE audit_log ADD COLUMN path TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_retention ON audit_log(ts);
