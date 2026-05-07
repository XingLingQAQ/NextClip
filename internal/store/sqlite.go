package store

import (
	"database/sql"
	"time"

	_ "modernc.org/sqlite"
)

// SQLiteStore wraps the database connection and provides data access methods.
type SQLiteStore struct {
	db *sql.DB
}

// NewSQLiteStore opens/creates the SQLite database and runs migrations.
func NewSQLiteStore(dbPath string) (*SQLiteStore, error) {
	db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_foreign_keys=ON&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // SQLite single-writer
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	s := &SQLiteStore{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}

	// Start cleanup goroutines
	go s.cleanupLoop()

	return s, nil
}

func (s *SQLiteStore) Close() error {
	return s.db.Close()
}

func (s *SQLiteStore) migrate() error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			created_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS rooms (
			room_code TEXT PRIMARY KEY,
			password_hash TEXT,
			owner_id TEXT,
			expires_at TEXT,
			created_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS clips (
			id TEXT PRIMARY KEY,
			room_code TEXT NOT NULL,
			content TEXT NOT NULL DEFAULT '',
			type TEXT NOT NULL DEFAULT 'text',
			timestamp TEXT NOT NULL,
			source_device TEXT NOT NULL DEFAULT 'Unknown',
			metadata TEXT,
			is_sensitive INTEGER NOT NULL DEFAULT 0,
			burn_after_read INTEGER NOT NULL DEFAULT 0,
			attachments TEXT,
			deleted_at TEXT,
			updated_at TEXT,
			version INTEGER NOT NULL DEFAULT 1,
			idempotency_key TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS idx_clips_room ON clips(room_code)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_clips_room_idempotency ON clips(room_code, idempotency_key) WHERE idempotency_key IS NOT NULL`,
		`CREATE TABLE IF NOT EXISTS pinned_clips (
			room_code TEXT NOT NULL,
			clip_id TEXT NOT NULL,
			created_at TEXT NOT NULL,
			PRIMARY KEY(room_code, clip_id)
		)`,
		`CREATE TABLE IF NOT EXISTS audit_events (
			id TEXT PRIMARY KEY,
			room_code TEXT NOT NULL,
			clip_id TEXT,
			event_type TEXT NOT NULL,
			actor_user_id TEXT,
			actor_device_id TEXT,
			payload TEXT,
			created_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_room_time ON audit_events(room_code, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS user_sessions (
			sid TEXT PRIMARY KEY,
			expires_at INTEGER NOT NULL,
			data TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at)`,
	}

	for _, m := range migrations {
		if _, err := s.db.Exec(m); err != nil {
			return err
		}
	}
	return nil
}

func (s *SQLiteStore) cleanupLoop() {
	ticker60s := time.NewTicker(60 * time.Second)
	ticker1h := time.NewTicker(1 * time.Hour)
	defer ticker60s.Stop()
	defer ticker1h.Stop()

	for {
		select {
		case <-ticker60s.C:
			s.cleanExpiredRooms()
			s.cleanExpiredSessions()
		case <-ticker1h.C:
			s.cleanExpiredAuditEvents()
		}
	}
}

func (s *SQLiteStore) cleanExpiredRooms() {
	now := time.Now().UTC().Format(time.RFC3339)
	rows, _ := s.db.Query("SELECT room_code FROM rooms WHERE expires_at IS NOT NULL AND expires_at < ?", now)
	if rows == nil {
		return
	}
	defer rows.Close()
	var codes []string
	for rows.Next() {
		var code string
		rows.Scan(&code)
		codes = append(codes, code)
	}
	for _, code := range codes {
		s.db.Exec("DELETE FROM pinned_clips WHERE room_code = ?", code)
		s.db.Exec("DELETE FROM clips WHERE room_code = ?", code)
		s.db.Exec("DELETE FROM rooms WHERE room_code = ?", code)
	}
}

func (s *SQLiteStore) cleanExpiredSessions() {
	s.db.Exec("DELETE FROM user_sessions WHERE expires_at < ?", time.Now().UnixMilli())
}

func (s *SQLiteStore) cleanExpiredAuditEvents() {
	cutoff := time.Now().Add(-30 * 24 * time.Hour).UTC().Format(time.RFC3339)
	s.db.Exec("DELETE FROM audit_events WHERE created_at < ?", cutoff)
}
