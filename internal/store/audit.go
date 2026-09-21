// Store: audit log — append-only trail. No update, no delete.
// SPDX-License-Identifier: AGPL-3.0

package store

import (
	"time"

	"github.com/kerviaHerve/kervia-vault/internal/model"
)

// AppendAudit writes one audit line. detail must NEVER contain a secret value —
// enforced by convention + reviewed in tests.
func (s *Store) AppendAudit(agentID, action, resource, detail string) error {
	_, err := s.db.Exec(`INSERT INTO audit_log (ts, agent_id, action, resource, detail) VALUES (?, ?, ?, ?, ?)`,
		now(), agentID, action, resource, detail)
	return err
}

// ListAudit returns paginated audit entries, newest first.
func (s *Store) ListAudit(limit, offset int, agentFilter string) ([]*model.AuditEntry, error) {
	var rows interface{ Next() bool; Scan(...any) error; Err() error; Close() error }
	var err error
	if agentFilter != "" {
		rows, err = s.db.Query(`SELECT id, ts, agent_id, action, resource, detail,
			COALESCE(source,''), COALESCE(ip,''), COALESCE(user_agent,''), COALESCE(method,''), COALESCE(status,0), COALESCE(path,'')
			FROM audit_log WHERE agent_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
			agentFilter, limit, offset)
	} else {
		rows, err = s.db.Query(`SELECT id, ts, agent_id, action, resource, detail,
			COALESCE(source,''), COALESCE(ip,''), COALESCE(user_agent,''), COALESCE(method,''), COALESCE(status,0), COALESCE(path,'')
			FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?`, limit, offset)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*model.AuditEntry
	for rows.Next() {
		var e model.AuditEntry
		var ts string
		if err := rows.Scan(&e.ID, &ts, &e.AgentID, &e.Action, &e.Resource, &e.Detail,
			&e.Source, &e.IP, &e.UserAgent, &e.Method, &e.Status, &e.Path); err != nil {
			return nil, err
		}
		e.TS, _ = parseTS(ts)
		out = append(out, &e)
	}
	return out, rows.Err()
}
func parseTS(s string) (time.Time, error) { return time.Parse(time.RFC3339Nano, s) }
