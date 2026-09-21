// Package store implements the SQLite persistence layer.
// All queries are parameterized (gosec G201/G202 clean by design).
// SPDX-License-Identifier: AGPL-3.0
package store

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite" // pure-Go SQLite driver, no CGO
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Store wraps the SQLite database.
type Store struct {
	db *sql.DB
}

// Open opens (creating if needed) the database and runs migrations.
func Open(path string) (*Store, error) {
	// _pragma: WAL + busy timeout are set via DSN (modernc-specific options)
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("store: open: %w", err)
	}
	// SQLite is a single-writer database: one connection avoids
	// SQLITE_BUSY storms under concurrency.
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("store: ping: %w", err)
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

// Close closes the underlying database.
func (s *Store) Close() error { return s.db.Close() }

// migrate applies every embedded migration in order, exactly once.
func (s *Store) migrate() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`); err != nil {
		return fmt.Errorf("store: migration table: %w", err)
	}
	for i := 1; ; i++ {
		name := fmt.Sprintf("migrations/%03d_init.sql", i)
		if i > 1 {
			name = fmt.Sprintf("migrations/%03d.sql", i)
		}
		data, err := migrationsFS.ReadFile(name)
		if err != nil {
			break // no more migrations
		}
		var done int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, i).Scan(&done); err != nil {
			return fmt.Errorf("store: migration check: %w", err)
		}
		if done > 0 {
			continue
		}
		tx, err := s.db.Begin()
		if err != nil {
			return fmt.Errorf("store: migration begin: %w", err)
		}
		if _, err := tx.Exec(string(data)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("store: migration %d: %w", i, err)
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`, i, time.Now().UTC().Format(time.RFC3339)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("store: migration record: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("store: migration commit: %w", err)
		}
	}
	return nil
}

// now returns the canonical UTC timestamp format used everywhere.
func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }

// Sentinel errors — callers use errors.Is.
var (
	ErrNotFound = errors.New("store: not found")
	ErrConflict = errors.New("store: already exists")
)
