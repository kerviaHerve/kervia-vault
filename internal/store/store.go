// Package store implements the SQLite persistence layer.
// All queries are parameterized (gosec G201/G202 clean by design).
// SPDX-License-Identifier: AGPL-3.0
package store

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"strconv"
	"strings"
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
// The version is the leading number of the filename (001.sql,
// 001_init.sql, 004_coffre.sql → 1, 1, 4). embed ReadDir is sorted,
// so the order is deterministic.
func (s *Store) migrate() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`); err != nil {
		return fmt.Errorf("store: migration table: %w", err)
	}
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("store: migrations dir: %w", err)
	}
	seen := make(map[int]bool)
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".sql") {
			continue
		}
		// version = leading digits ("001_init.sql" → 1, "002.sql" → 2)
		digits := name
		for i, c := range name {
			if c < '0' || c > '9' {
				digits = name[:i]
				break
			}
		}
		version, err := strconv.Atoi(digits)
		if err != nil || version < 1 {
			return fmt.Errorf("store: migration name %q: want NNN[...].sql", name)
		}
		if seen[version] {
			return fmt.Errorf("store: duplicate migration version %d (%s)", version, name)
		}
		seen[version] = true
		var done int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, version).Scan(&done); err != nil {
			return fmt.Errorf("store: migration check: %w", err)
		}
		if done > 0 {
			continue
		}
		data, err := migrationsFS.ReadFile("migrations/" + name)
		if err != nil {
			return fmt.Errorf("store: migration read %s: %w", name, err)
		}
		tx, err := s.db.Begin()
		if err != nil {
			return fmt.Errorf("store: migration begin: %w", err)
		}
		if _, err := tx.Exec(string(data)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("store: migration %s: %w", name, err)
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`, version, time.Now().UTC().Format(time.RFC3339)); err != nil {
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
