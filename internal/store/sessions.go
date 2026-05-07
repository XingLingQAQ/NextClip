package store

import (
	"database/sql"
	"encoding/json"
	"time"
)

type SessionData struct {
	UserID string `json:"userId,omitempty"`
}

func (s *SQLiteStore) GetSession(sid string) (*SessionData, error) {
	var data string
	var expiresAt int64
	err := s.db.QueryRow("SELECT data, expires_at FROM user_sessions WHERE sid = ?", sid).Scan(&data, &expiresAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if expiresAt < time.Now().UnixMilli() {
		return nil, nil
	}
	var sd SessionData
	json.Unmarshal([]byte(data), &sd)
	return &sd, nil
}

func (s *SQLiteStore) SetSession(sid string, data *SessionData, maxAge time.Duration) error {
	expiresAt := time.Now().Add(maxAge).UnixMilli()
	b, _ := json.Marshal(data)
	_, err := s.db.Exec(`INSERT INTO user_sessions (sid, expires_at, data) VALUES (?, ?, ?)
		ON CONFLICT(sid) DO UPDATE SET expires_at = excluded.expires_at, data = excluded.data`,
		sid, expiresAt, string(b))
	return err
}

func (s *SQLiteStore) DestroySession(sid string) error {
	_, err := s.db.Exec("DELETE FROM user_sessions WHERE sid = ?", sid)
	return err
}
