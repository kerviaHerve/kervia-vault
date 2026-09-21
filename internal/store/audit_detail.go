// Audit: detailed append with request context + 90-day retention.
// Every agent/webui call is logged with source, IP, user-agent, method, status.
// SPDX-License-Identifier: AGPL-3.0

package store

import (
	"log/slog"
	"time"
)

// RequestInfo carries the caller context for audit detail.
type RequestInfo struct {
	Source    string // "agent" | "webui" | "mcp"
	IP        string
	UserAgent string
	Method    string
	Path      string
	Status    int
}

// AppendAuditDetail writes one rich audit line.
func (s *Store) AppendAuditDetail(agentID, action, resource, detail string, info RequestInfo) error {
	_, err := s.db.Exec(`INSERT INTO audit_log
		(ts, agent_id, action, resource, detail, source, ip, user_agent, method, status, path)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		now(), agentID, action, resource, detail,
		info.Source, info.IP, info.UserAgent, info.Method, info.Status, info.Path)
	return err
}

// StartRetention deletes audit entries older than retentionDays, once per day.
// Returns a stop channel.
func (s *Store) StartRetention(retentionDays int) (stop chan struct{}) {
	stop = make(chan struct{})
	go func() {
		cleanup := func() {
			cutoff := time.Now().UTC().AddDate(0, 0, -retentionDays).Format(time.RFC3339Nano)
			if _, err := s.db.Exec(`DELETE FROM audit_log WHERE ts < ?`, cutoff); err != nil {
				slog.Error("audit retention", "err", err)
			}
		}
		cleanup() // run once at boot
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				cleanup()
			case <-stop:
				return
			}
		}
	}()
	return stop
}