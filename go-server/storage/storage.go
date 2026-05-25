package storage

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/XingLingQAQ/NextClip/go-server/models"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/scrypt"
)

const (
	scryptN        = 1 << 15 // 32768
	scryptR        = 8
	scryptP        = 2
	scryptKeyLen   = 64
	scryptSaltLen  = 16
	hashAlgo       = "scrypt"
)

var legacySha256Re = regexp.MustCompile(`^[a-f0-9]{64}$`)

// Store handles all database operations.
type Store struct {
	db *sql.DB
}

// New creates a new Store and initializes the database schema.
func New(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_foreign_keys=ON&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	s := &Store{db: db}
	if err := s.initSchema(); err != nil {
		db.Close()
		return nil, fmt.Errorf("init schema: %w", err)
	}

	// Start background cleanup
	go s.cleanupLoop()

	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) initSchema() error {
	statements := []string{
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

	for _, stmt := range statements {
		if _, err := s.db.Exec(stmt); err != nil {
			return fmt.Errorf("exec %q: %w", stmt[:50], err)
		}
	}

	return nil
}

func (s *Store) cleanupLoop() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	// Initial cleanup
	s.cleanExpiredRooms()
	s.cleanExpiredSessions()

	for range ticker.C {
		s.cleanExpiredRooms()
		s.cleanExpiredSessions()
	}
}

func (s *Store) cleanExpiredRooms() {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	rows, err := s.db.Query(`SELECT room_code FROM rooms WHERE expires_at IS NOT NULL AND expires_at < ?`, now)
	if err != nil {
		return
	}
	defer rows.Close()

	var codes []string
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err == nil {
			codes = append(codes, code)
		}
	}

	for _, code := range codes {
		s.db.Exec(`DELETE FROM pinned_clips WHERE room_code = ?`, code)
		s.db.Exec(`DELETE FROM clips WHERE room_code = ?`, code)
		s.db.Exec(`DELETE FROM audit_events WHERE room_code = ?`, code)
		s.db.Exec(`DELETE FROM rooms WHERE room_code = ?`, code)
	}
}

func (s *Store) cleanExpiredSessions() {
	s.db.Exec(`DELETE FROM user_sessions WHERE expires_at < ?`, time.Now().UnixMilli())
}

// ===== Password Hashing =====

func HashPassword(plainText string) (string, error) {
	salt := make([]byte, scryptSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}

	derived, err := scrypt.Key([]byte(plainText), salt, scryptN, scryptR, scryptP, scryptKeyLen)
	if err != nil {
		return "", err
	}

	saltB64 := base64.StdEncoding.EncodeToString(salt)
	derivedB64 := base64.StdEncoding.EncodeToString(derived)

	return fmt.Sprintf("%s$%d$%d$%d$%s$%s", hashAlgo, scryptN, scryptR, scryptP, saltB64, derivedB64), nil
}

type passwordResult struct {
	Matched    bool
	NeedsRehash bool
}

func VerifyPassword(plainText, storedHash string) passwordResult {
	if strings.HasPrefix(storedHash, hashAlgo+"$") {
		parts := strings.Split(storedHash, "$")
		if len(parts) != 6 {
			return passwordResult{false, false}
		}

		var n, r, p int
		fmt.Sscanf(parts[1], "%d", &n)
		fmt.Sscanf(parts[2], "%d", &r)
		fmt.Sscanf(parts[3], "%d", &p)
		salt := parts[4]
		digest := parts[5]

		if n == 0 || r == 0 || p == 0 || salt == "" || digest == "" {
			return passwordResult{false, false}
		}

		saltBytes, err := base64.StdEncoding.DecodeString(salt)
		if err != nil {
			return passwordResult{false, false}
		}

		expected, err := base64.StdEncoding.DecodeString(digest)
		if err != nil {
			return passwordResult{false, false}
		}

		derived, err := scrypt.Key([]byte(plainText), saltBytes, n, r, p, scryptKeyLen)
		if err != nil {
			return passwordResult{false, false}
		}

		if len(expected) != len(derived) {
			return passwordResult{false, false}
		}

		matched := subtle.ConstantTimeCompare(derived, expected) == 1
		needsRehash := n != scryptN || r != scryptR || p != scryptP

		return passwordResult{matched, needsRehash}
	}

	// Legacy SHA-256 compatibility
	if legacySha256Re.MatchString(storedHash) {
		hash := sha256.Sum256([]byte(plainText))
		legacy := hex.EncodeToString(hash[:])
		matched := legacy == storedHash
		return passwordResult{matched, matched}
	}

	return passwordResult{false, false}
}

// ===== Users =====

func (s *Store) CreateUser(username, password string) (*models.User, error) {
	id := uuid.New().String()
	createdAt := time.Now().UTC().Format(time.RFC3339Nano)
	hash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}

	_, err = s.db.Exec(
		`INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`,
		id, username, hash, createdAt,
	)
	if err != nil {
		return nil, err
	}

	return &models.User{ID: id, Username: username, CreatedAt: createdAt}, nil
}

func (s *Store) GetUser(username string) (*models.User, string, error) {
	row := s.db.QueryRow(`SELECT id, username, password_hash, created_at FROM users WHERE username = ?`, username)
	var user models.User
	var hash string
	err := row.Scan(&user.ID, &user.Username, &hash, &user.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	return &user, hash, nil
}

func (s *Store) VerifyUser(username, password string) (*models.User, error) {
	user, hash, err := s.GetUser(username)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, nil
	}

	result := VerifyPassword(password, hash)
	if !result.Matched {
		return nil, nil
	}

	if result.NeedsRehash {
		newHash, err := HashPassword(password)
		if err == nil {
			s.db.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, newHash, user.ID)
		}
	}

	return user, nil
}

func (s *Store) GetUserByID(id string) (*models.User, error) {
	row := s.db.QueryRow(`SELECT id, username, created_at FROM users WHERE id = ?`, id)
	var user models.User
	err := row.Scan(&user.ID, &user.Username, &user.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// ===== Sessions =====

func (s *Store) GetSession(sid string) (*models.Session, error) {
	row := s.db.QueryRow(`SELECT sid, data, expires_at FROM user_sessions WHERE sid = ?`, sid)
	var session models.Session
	var data string
	err := row.Scan(&session.SID, &data, &session.ExpiresAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if session.ExpiresAt < time.Now().UnixMilli() {
		return nil, nil
	}

	// Parse data JSON to extract userId
	var sessionData map[string]interface{}
	if err := json.Unmarshal([]byte(data), &sessionData); err == nil {
		if uid, ok := sessionData["userId"].(string); ok {
			session.UserID = uid
		}
	}

	return &session, nil
}

func (s *Store) SetSession(sid, userID string, expiresAt int64) error {
	data, _ := json.Marshal(map[string]string{"userId": userID})
	_, err := s.db.Exec(`
		INSERT INTO user_sessions (sid, expires_at, data)
		VALUES (?, ?, ?)
		ON CONFLICT(sid) DO UPDATE SET
			expires_at = excluded.expires_at,
			data = excluded.data
	`, sid, expiresAt, string(data))
	return err
}

func (s *Store) DestroySession(sid string) error {
	_, err := s.db.Exec(`DELETE FROM user_sessions WHERE sid = ?`, sid)
	return err
}

// ===== Rooms =====

func (s *Store) GetRoom(roomCode string) (*models.RoomInfo, error) {
	row := s.db.QueryRow(`SELECT room_code, password_hash, owner_id, expires_at, created_at FROM rooms WHERE room_code = ?`, roomCode)
	var code, createdAt string
	var passwordHash, ownerID, expiresAt sql.NullString
	err := row.Scan(&code, &passwordHash, &ownerID, &expiresAt, &createdAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	room := &models.RoomInfo{
		RoomCode:    code,
		HasPassword: passwordHash.Valid && passwordHash.String != "",
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

func (s *Store) CreateRoom(roomCode string, ownerID *string, password *string, expiresAt *string) (*models.RoomInfo, error) {
	var passwordHash *string
	if password != nil && *password != "" {
		hash, err := HashPassword(*password)
		if err != nil {
			return nil, err
		}
		passwordHash = &hash
	}

	createdAt := time.Now().UTC().Format(time.RFC3339Nano)
	var ownerVal, passVal, expiresVal interface{}
	ownerVal = nil
	passVal = nil
	expiresVal = nil
	if ownerID != nil {
		ownerVal = *ownerID
	}
	if passwordHash != nil {
		passVal = *passwordHash
	}
	if expiresAt != nil {
		expiresVal = *expiresAt
	}

	_, err := s.db.Exec(
		`INSERT INTO rooms (room_code, password_hash, owner_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
		roomCode, passVal, ownerVal, expiresVal, createdAt,
	)
	if err != nil {
		return nil, err
	}

	return &models.RoomInfo{
		RoomCode:    roomCode,
		HasPassword: password != nil && *password != "",
		ExpiresAt:   expiresAt,
		OwnerID:     ownerID,
		CreatedAt:   createdAt,
	}, nil
}

func (s *Store) RoomExists(roomCode string) bool {
	room, _ := s.GetRoom(roomCode)
	return room != nil
}

func (s *Store) VerifyRoomPassword(roomCode, password string) bool {
	row := s.db.QueryRow(`SELECT password_hash FROM rooms WHERE room_code = ?`, roomCode)
	var hashStr sql.NullString
	if err := row.Scan(&hashStr); err != nil || !hashStr.Valid {
		return false
	}

	result := VerifyPassword(password, hashStr.String)
	if !result.Matched {
		return false
	}

	if result.NeedsRehash {
		newHash, err := HashPassword(password)
		if err == nil {
			s.db.Exec(`UPDATE rooms SET password_hash = ? WHERE room_code = ?`, newHash, roomCode)
		}
	}

	return true
}

func (s *Store) SetRoomPassword(roomCode string, password *string) error {
	var hashVal interface{}
	if password != nil && *password != "" {
		hash, err := HashPassword(*password)
		if err != nil {
			return err
		}
		hashVal = hash
	}
	_, err := s.db.Exec(`UPDATE rooms SET password_hash = ? WHERE room_code = ?`, hashVal, roomCode)
	return err
}

func (s *Store) SetRoomExpiry(roomCode string, expiresAt *string) error {
	var val interface{}
	if expiresAt != nil {
		val = *expiresAt
	}
	_, err := s.db.Exec(`UPDATE rooms SET expires_at = ? WHERE room_code = ?`, val, roomCode)
	return err
}

// ===== Clips =====

func (s *Store) CreateClip(roomCode, content, clipType, sourceDevice string, metadata *string, isSensitive, burnAfterRead bool, attachments []models.Attachment, idempotencyKey *string) (*models.Clip, error) {
	// Check idempotency
	if idempotencyKey != nil && *idempotencyKey != "" {
		row := s.db.QueryRow(`
			SELECT id, room_code, content, type, timestamp, source_device, metadata, is_sensitive, burn_after_read, attachments
			FROM clips WHERE room_code = ? AND idempotency_key = ? AND deleted_at IS NULL
		`, roomCode, *idempotencyKey)

		var clip models.Clip
		var meta, att sql.NullString
		var isSens, bar int
		err := row.Scan(&clip.ID, &clip.RoomCode, &clip.Content, &clip.Type, &clip.Timestamp, &clip.SourceDevice, &meta, &isSens, &bar, &att)
		if err == nil {
			clip.IsSensitive = isSens == 1
			clip.BurnAfterRead = bar == 1
			if meta.Valid {
				clip.Metadata = meta.String
			}
			if att.Valid {
				json.Unmarshal([]byte(att.String), &clip.Attachments)
			}
			return &clip, nil
		}
	}

	id := uuid.New().String()
	timestamp := time.Now().UTC().Format(time.RFC3339Nano)

	var attJSON *string
	if len(attachments) > 0 {
		data, _ := json.Marshal(attachments)
		s := string(data)
		attJSON = &s
	}

	var metaVal, attVal, idempVal interface{}
	if metadata != nil {
		metaVal = *metadata
	}
	if attJSON != nil {
		attVal = *attJSON
	}
	if idempotencyKey != nil && *idempotencyKey != "" {
		idempVal = *idempotencyKey
	}

	sensInt := 0
	if isSensitive {
		sensInt = 1
	}
	barInt := 0
	if burnAfterRead {
		barInt = 1
	}

	_, err := s.db.Exec(`
		INSERT INTO clips (id, room_code, content, type, timestamp, source_device, metadata, is_sensitive, burn_after_read, attachments, updated_at, version, idempotency_key)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
	`, id, roomCode, content, clipType, timestamp, sourceDevice, metaVal, sensInt, barInt, attVal, timestamp, idempVal)
	if err != nil {
		return nil, err
	}

	return &models.Clip{
		ID:            id,
		RoomCode:      roomCode,
		Content:       content,
		Type:          clipType,
		Timestamp:     timestamp,
		SourceDevice:  sourceDevice,
		Metadata:      stringFromPtr(metadata),
		IsSensitive:   isSensitive,
		BurnAfterRead: burnAfterRead,
		Attachments:   attachments,
	}, nil
}

func (s *Store) UpdateClip(id, roomCode, content, clipType string) bool {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.Exec(`
		UPDATE clips SET content = ?, type = ?, updated_at = ?, version = version + 1
		WHERE id = ? AND room_code = ? AND deleted_at IS NULL
	`, content, clipType, now, id, roomCode)
	if err != nil {
		return false
	}
	n, _ := result.RowsAffected()
	return n > 0
}

func (s *Store) GetClipsByRoom(roomCode string) []models.Clip {
	rows, err := s.db.Query(`
		SELECT id, room_code, content, type, timestamp, source_device, metadata, is_sensitive, burn_after_read, attachments
		FROM clips WHERE room_code = ? AND deleted_at IS NULL
		ORDER BY timestamp DESC LIMIT 200
	`, roomCode)
	if err != nil {
		return nil
	}
	defer rows.Close()
	return scanClips(rows)
}

func (s *Store) GetClipsByRoomPage(roomCode string, beforeTimestamp *string, limit int) []models.Clip {
	safeLimit := int(math.Min(math.Max(float64(limit), 1), 200))

	var rows *sql.Rows
	var err error
	if beforeTimestamp != nil && *beforeTimestamp != "" {
		rows, err = s.db.Query(`
			SELECT id, room_code, content, type, timestamp, source_device, metadata, is_sensitive, burn_after_read, attachments
			FROM clips WHERE room_code = ? AND deleted_at IS NULL AND timestamp < ?
			ORDER BY timestamp DESC LIMIT ?
		`, roomCode, *beforeTimestamp, safeLimit)
	} else {
		rows, err = s.db.Query(`
			SELECT id, room_code, content, type, timestamp, source_device, metadata, is_sensitive, burn_after_read, attachments
			FROM clips WHERE room_code = ? AND deleted_at IS NULL
			ORDER BY timestamp DESC LIMIT ?
		`, roomCode, safeLimit)
	}
	if err != nil {
		return nil
	}
	defer rows.Close()
	return scanClips(rows)
}

func (s *Store) GetClipsSince(roomCode, sinceTimestamp string, limit int) []models.Clip {
	safeLimit := int(math.Min(math.Max(float64(limit), 1), 500))
	rows, err := s.db.Query(`
		SELECT id, room_code, content, type, timestamp, source_device, metadata, is_sensitive, burn_after_read, attachments
		FROM clips WHERE room_code = ? AND deleted_at IS NULL AND timestamp > ?
		ORDER BY timestamp ASC LIMIT ?
	`, roomCode, sinceTimestamp, safeLimit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	return scanClips(rows)
}

func (s *Store) GetClipByID(id, roomCode string) *models.Clip {
	row := s.db.QueryRow(`
		SELECT id, room_code, content, type, timestamp, source_device, metadata, is_sensitive, burn_after_read, attachments
		FROM clips WHERE id = ? AND room_code = ? AND deleted_at IS NULL
	`, id, roomCode)

	var clip models.Clip
	var meta, att sql.NullString
	var isSens, bar int
	err := row.Scan(&clip.ID, &clip.RoomCode, &clip.Content, &clip.Type, &clip.Timestamp, &clip.SourceDevice, &meta, &isSens, &bar, &att)
	if err != nil {
		return nil
	}
	clip.IsSensitive = isSens == 1
	clip.BurnAfterRead = bar == 1
	if meta.Valid {
		clip.Metadata = meta.String
	}
	if att.Valid {
		json.Unmarshal([]byte(att.String), &clip.Attachments)
	}
	return &clip
}

func (s *Store) DeleteClip(id, roomCode string) bool {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	s.db.Exec(`DELETE FROM pinned_clips WHERE room_code = ? AND clip_id = ?`, roomCode, id)
	result, err := s.db.Exec(`
		UPDATE clips SET deleted_at = ?, updated_at = ?, version = version + 1
		WHERE id = ? AND room_code = ? AND deleted_at IS NULL
	`, now, now, id, roomCode)
	if err != nil {
		return false
	}
	n, _ := result.RowsAffected()
	return n > 0
}

func (s *Store) ClearRoom(roomCode string) int64 {
	s.db.Exec(`DELETE FROM pinned_clips WHERE room_code = ?`, roomCode)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, _ := s.db.Exec(`
		UPDATE clips SET deleted_at = ?, updated_at = ?, version = version + 1
		WHERE room_code = ? AND deleted_at IS NULL
	`, now, now, roomCode)
	n, _ := result.RowsAffected()
	return n
}

func (s *Store) RestoreClip(id, roomCode string) bool {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.Exec(`
		UPDATE clips SET deleted_at = NULL, updated_at = ?, version = version + 1
		WHERE id = ? AND room_code = ? AND deleted_at IS NOT NULL
	`, now, id, roomCode)
	if err != nil {
		return false
	}
	n, _ := result.RowsAffected()
	return n > 0
}

// ===== Pinned Clips =====

func (s *Store) GetPinnedClipIds(roomCode string) []string {
	rows, err := s.db.Query(`SELECT clip_id FROM pinned_clips WHERE room_code = ? ORDER BY created_at DESC`, roomCode)
	if err != nil {
		return []string{}
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	if ids == nil {
		return []string{}
	}
	return ids
}

func (s *Store) SetClipPinned(roomCode, clipID string, pinned bool) bool {
	if pinned {
		var exists int
		err := s.db.QueryRow(`SELECT 1 FROM clips WHERE id = ? AND room_code = ?`, clipID, roomCode).Scan(&exists)
		if err != nil {
			return false
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		s.db.Exec(`INSERT OR IGNORE INTO pinned_clips (room_code, clip_id, created_at) VALUES (?, ?, ?)`, roomCode, clipID, now)
		return true
	}
	s.db.Exec(`DELETE FROM pinned_clips WHERE room_code = ? AND clip_id = ?`, roomCode, clipID)
	return true
}

// ===== Audit =====

func (s *Store) AddAuditEvent(roomCode, eventType string, clipID, actorUserID, actorDeviceID *string, payload map[string]interface{}) {
	id := uuid.New().String()
	createdAt := time.Now().UTC().Format(time.RFC3339Nano)

	var payloadJSON *string
	if payload != nil {
		data, _ := json.Marshal(payload)
		s := string(data)
		payloadJSON = &s
	}

	s.db.Exec(`
		INSERT INTO audit_events (id, room_code, clip_id, event_type, actor_user_id, actor_device_id, payload, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, id, roomCode, clipID, eventType, actorUserID, actorDeviceID, payloadJSON, createdAt)
}

func (s *Store) GetAuditEvents(roomCode string, limit int) []models.AuditEvent {
	safeLimit := int(math.Min(math.Max(float64(limit), 1), 500))
	rows, err := s.db.Query(`
		SELECT id, room_code, clip_id, event_type, actor_user_id, actor_device_id, payload, created_at
		FROM audit_events WHERE room_code = ?
		ORDER BY created_at DESC LIMIT ?
	`, roomCode, safeLimit)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var events []models.AuditEvent
	for rows.Next() {
		var event models.AuditEvent
		var clipID, actorUserID, actorDeviceID, payload sql.NullString
		err := rows.Scan(&event.ID, &event.RoomCode, &clipID, &event.EventType, &actorUserID, &actorDeviceID, &payload, &event.CreatedAt)
		if err != nil {
			continue
		}
		if clipID.Valid {
			event.ClipID = &clipID.String
		}
		if actorUserID.Valid {
			event.ActorUserID = &actorUserID.String
		}
		if actorDeviceID.Valid {
			event.ActorDeviceID = &actorDeviceID.String
		}
		if payload.Valid {
			json.Unmarshal([]byte(payload.String), &event.Payload)
		}
		events = append(events, event)
	}
	return events
}

// ===== Helpers =====

func scanClips(rows *sql.Rows) []models.Clip {
	var clips []models.Clip
	for rows.Next() {
		var clip models.Clip
		var meta, att sql.NullString
		var isSens, bar int
		err := rows.Scan(&clip.ID, &clip.RoomCode, &clip.Content, &clip.Type, &clip.Timestamp, &clip.SourceDevice, &meta, &isSens, &bar, &att)
		if err != nil {
			continue
		}
		clip.IsSensitive = isSens == 1
		clip.BurnAfterRead = bar == 1
		if meta.Valid {
			clip.Metadata = meta.String
		}
		if att.Valid {
			json.Unmarshal([]byte(att.String), &clip.Attachments)
		}
		clips = append(clips, clip)
	}
	if clips == nil {
		return []models.Clip{}
	}
	return clips
}

func stringFromPtr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
