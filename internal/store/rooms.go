package store

import (
	"database/sql"
	"time"

	"github.com/XingLingQAQ/NextClip/internal/model"
	"github.com/google/uuid"
)

func (s *SQLiteStore) GetRoom(roomCode string) (*model.RoomInfo, error) {
	row := s.db.QueryRow("SELECT room_code, password_hash, owner_id, expires_at, created_at FROM rooms WHERE room_code = ?", roomCode)
	var code, createdAt string
	var pwHash, ownerID, expiresAt sql.NullString
	err := row.Scan(&code, &pwHash, &ownerID, &expiresAt, &createdAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	room := &model.RoomInfo{
		RoomCode:    code,
		HasPassword: pwHash.Valid && pwHash.String != "",
		CreatedAt:   createdAt,
	}
	if expiresAt.Valid {
		room.ExpiresAt = &expiresAt.String
	}
	if ownerID.Valid {
		room.OwnerID = &ownerID.String
	}
	return room, nil
}

func (s *SQLiteStore) RoomExists(roomCode string) bool {
	r, _ := s.GetRoom(roomCode)
	return r != nil
}

func (s *SQLiteStore) CreateRoom(roomCode string, ownerID *string, password *string, expiresAt *string) (*model.RoomInfo, error) {
	var pwHash sql.NullString
	if password != nil && *password != "" {
		h, err := hashPassword(*password)
		if err != nil {
			return nil, err
		}
		pwHash = sql.NullString{String: h, Valid: true}
	}
	var ownerNull sql.NullString
	if ownerID != nil {
		ownerNull = sql.NullString{String: *ownerID, Valid: true}
	}
	var expiresNull sql.NullString
	if expiresAt != nil {
		expiresNull = sql.NullString{String: *expiresAt, Valid: true}
	}

	createdAt := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(
		"INSERT INTO rooms (room_code, password_hash, owner_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
		roomCode, pwHash, ownerNull, expiresNull, createdAt,
	)
	if err != nil {
		return nil, err
	}
	room := &model.RoomInfo{
		RoomCode:    roomCode,
		HasPassword: pwHash.Valid,
		ExpiresAt:   expiresAt,
		OwnerID:     ownerID,
		CreatedAt:   createdAt,
	}
	return room, nil
}

func (s *SQLiteStore) VerifyRoomPassword(roomCode, password string) bool {
	row := s.db.QueryRow("SELECT password_hash FROM rooms WHERE room_code = ?", roomCode)
	var pwHash sql.NullString
	if err := row.Scan(&pwHash); err != nil || !pwHash.Valid {
		return false
	}
	result := verifyPassword(password, pwHash.String)
	if !result.Matched {
		return false
	}
	if result.NeedsRehash {
		if newHash, err := hashPassword(password); err == nil {
			s.db.Exec("UPDATE rooms SET password_hash = ? WHERE room_code = ?", newHash, roomCode)
		}
	}
	return true
}

func (s *SQLiteStore) SetRoomPassword(roomCode string, password *string) error {
	if password == nil || *password == "" {
		_, err := s.db.Exec("UPDATE rooms SET password_hash = NULL WHERE room_code = ?", roomCode)
		return err
	}
	hash, err := hashPassword(*password)
	if err != nil {
		return err
	}
	_, err = s.db.Exec("UPDATE rooms SET password_hash = ? WHERE room_code = ?", hash, roomCode)
	return err
}

func (s *SQLiteStore) SetRoomExpiry(roomCode string, expiresAt *string) error {
	var val sql.NullString
	if expiresAt != nil {
		val = sql.NullString{String: *expiresAt, Valid: true}
	}
	_, err := s.db.Exec("UPDATE rooms SET expires_at = ? WHERE room_code = ?", val, roomCode)
	return err
}

// Token management (in-memory, same as Node.js version)
type RoomTokenEntry struct {
	ExpiresAt time.Time
}

var roomTokens = make(map[string]map[string]RoomTokenEntry)

const roomTokenTTL = 24 * time.Hour

func (s *SQLiteStore) IssueRoomToken(roomCode string) string {
	token := uuid.New().String()
	if _, ok := roomTokens[roomCode]; !ok {
		roomTokens[roomCode] = make(map[string]RoomTokenEntry)
	}
	roomTokens[roomCode][token] = RoomTokenEntry{ExpiresAt: time.Now().Add(roomTokenTTL)}
	return token
}

func (s *SQLiteStore) ValidateRoomToken(roomCode, token string) bool {
	tokens, ok := roomTokens[roomCode]
	if !ok {
		return false
	}
	entry, ok := tokens[token]
	if !ok {
		return false
	}
	if time.Now().After(entry.ExpiresAt) {
		delete(tokens, token)
		return false
	}
	return true
}

func (s *SQLiteStore) RevokeRoomTokens(roomCode string) {
	delete(roomTokens, roomCode)
}

func init() {
	// Periodic cleanup of expired tokens
	go func() {
		for {
			time.Sleep(60 * time.Second)
			now := time.Now()
			for code, tokens := range roomTokens {
				for t, entry := range tokens {
					if now.After(entry.ExpiresAt) {
						delete(tokens, t)
					}
				}
				if len(tokens) == 0 {
					delete(roomTokens, code)
				}
			}
		}
	}()
}
