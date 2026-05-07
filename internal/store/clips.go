package store

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/XingLingQAQ/NextClip/internal/model"
	"github.com/google/uuid"
)

func scanClip(row interface{ Scan(...any) error }) (*model.Clip, error) {
	var c model.Clip
	var metadata, attachments, deletedAt, updatedAt, idempotencyKey sql.NullString
	var isSensitive, burnAfterRead int
	err := row.Scan(&c.ID, &c.RoomCode, &c.Content, &c.Type, &c.Timestamp,
		&c.SourceDevice, &metadata, &isSensitive, &burnAfterRead,
		&attachments, &deletedAt, &updatedAt, new(int), &idempotencyKey)
	if err != nil {
		return nil, err
	}
	if metadata.Valid {
		c.Metadata = &metadata.String
	}
	c.IsSensitive = isSensitive == 1
	c.BurnAfterRead = burnAfterRead == 1
	if attachments.Valid && attachments.String != "" {
		json.Unmarshal([]byte(attachments.String), &c.Attachments)
	}
	return &c, nil
}

func (s *SQLiteStore) CreateClip(roomCode, content, clipType, sourceDevice string, metadata *string, isSensitive, burnAfterRead bool, attachments []model.Attachment, idempotencyKey *string) (*model.Clip, error) {
	if idempotencyKey != nil && *idempotencyKey != "" {
		row := s.db.QueryRow("SELECT * FROM clips WHERE room_code = ? AND idempotency_key = ? AND deleted_at IS NULL", roomCode, *idempotencyKey)
		if existing, err := scanClip(row); err == nil && existing != nil {
			return existing, nil
		}
	}

	id := uuid.New().String()
	ts := time.Now().UTC().Format(time.RFC3339Nano)
	var attJSON sql.NullString
	if len(attachments) > 0 {
		b, _ := json.Marshal(attachments)
		attJSON = sql.NullString{String: string(b), Valid: true}
	}
	var metaNull sql.NullString
	if metadata != nil {
		metaNull = sql.NullString{String: *metadata, Valid: true}
	}
	var idemNull sql.NullString
	if idempotencyKey != nil && *idempotencyKey != "" {
		idemNull = sql.NullString{String: *idempotencyKey, Valid: true}
	}

	sens := 0
	if isSensitive {
		sens = 1
	}
	burn := 0
	if burnAfterRead {
		burn = 1
	}

	_, err := s.db.Exec(`INSERT INTO clips (id, room_code, content, type, timestamp, source_device, metadata,
		is_sensitive, burn_after_read, attachments, updated_at, version, idempotency_key)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
		id, roomCode, content, clipType, ts, sourceDevice, metaNull, sens, burn, attJSON, ts, idemNull)
	if err != nil {
		return nil, err
	}

	return &model.Clip{
		ID: id, RoomCode: roomCode, Content: content, Type: clipType,
		Timestamp: ts, SourceDevice: sourceDevice, Metadata: metadata,
		IsSensitive: isSensitive, BurnAfterRead: burnAfterRead, Attachments: attachments,
	}, nil
}

func (s *SQLiteStore) UpdateClip(id, roomCode, content, clipType string) bool {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	res, _ := s.db.Exec("UPDATE clips SET content = ?, type = ?, updated_at = ?, version = version + 1 WHERE id = ? AND room_code = ? AND deleted_at IS NULL",
		content, clipType, now, id, roomCode)
	if res == nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n > 0
}

func (s *SQLiteStore) GetClipsByRoom(roomCode string, limit int) ([]model.Clip, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := s.db.Query("SELECT * FROM clips WHERE room_code = ? AND deleted_at IS NULL ORDER BY timestamp DESC LIMIT ?", roomCode, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var clips []model.Clip
	for rows.Next() {
		c, err := scanClip(rows)
		if err != nil {
			continue
		}
		clips = append(clips, *c)
	}
	return clips, nil
}

func (s *SQLiteStore) GetClipsByRoomPage(roomCode string, before *string, limit int) ([]model.Clip, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var rows *sql.Rows
	var err error
	if before != nil && *before != "" {
		rows, err = s.db.Query("SELECT * FROM clips WHERE room_code = ? AND deleted_at IS NULL AND timestamp < ? ORDER BY timestamp DESC LIMIT ?", roomCode, *before, limit)
	} else {
		rows, err = s.db.Query("SELECT * FROM clips WHERE room_code = ? AND deleted_at IS NULL ORDER BY timestamp DESC LIMIT ?", roomCode, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var clips []model.Clip
	for rows.Next() {
		c, err := scanClip(rows)
		if err != nil {
			continue
		}
		clips = append(clips, *c)
	}
	return clips, nil
}

func (s *SQLiteStore) GetClipsSince(roomCode, since string, limit int) ([]model.Clip, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.db.Query("SELECT * FROM clips WHERE room_code = ? AND deleted_at IS NULL AND timestamp > ? ORDER BY timestamp ASC LIMIT ?", roomCode, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var clips []model.Clip
	for rows.Next() {
		c, err := scanClip(rows)
		if err != nil {
			continue
		}
		clips = append(clips, *c)
	}
	return clips, nil
}

func (s *SQLiteStore) DeleteClip(id, roomCode string) bool {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	s.db.Exec("DELETE FROM pinned_clips WHERE room_code = ? AND clip_id = ?", roomCode, id)
	res, _ := s.db.Exec("UPDATE clips SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND room_code = ? AND deleted_at IS NULL", now, now, id, roomCode)
	if res == nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n > 0
}

func (s *SQLiteStore) ClearRoom(roomCode string) int64 {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	s.db.Exec("DELETE FROM pinned_clips WHERE room_code = ?", roomCode)
	res, _ := s.db.Exec("UPDATE clips SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE room_code = ? AND deleted_at IS NULL", now, now, roomCode)
	if res == nil {
		return 0
	}
	n, _ := res.RowsAffected()
	return n
}

func (s *SQLiteStore) RestoreClip(id, roomCode string) bool {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	res, _ := s.db.Exec("UPDATE clips SET deleted_at = NULL, updated_at = ?, version = version + 1 WHERE id = ? AND room_code = ? AND deleted_at IS NOT NULL", now, id, roomCode)
	if res == nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n > 0
}

func (s *SQLiteStore) ConsumeBurnAfterRead(clipID, roomCode string) bool {
	var bar int
	err := s.db.QueryRow("SELECT burn_after_read FROM clips WHERE id = ? AND room_code = ? AND deleted_at IS NULL", clipID, roomCode).Scan(&bar)
	if err != nil || bar != 1 {
		return false
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	s.db.Exec("UPDATE clips SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND room_code = ?", now, now, clipID, roomCode)
	return true
}

func (s *SQLiteStore) GetPinnedClipIDs(roomCode string) []string {
	rows, _ := s.db.Query("SELECT clip_id FROM pinned_clips WHERE room_code = ? ORDER BY created_at DESC", roomCode)
	if rows == nil {
		return nil
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		rows.Scan(&id)
		ids = append(ids, id)
	}
	return ids
}

func (s *SQLiteStore) SetClipPinned(roomCode, clipID string, pinned bool) bool {
	if pinned {
		var exists int
		s.db.QueryRow("SELECT 1 FROM clips WHERE id = ? AND room_code = ?", clipID, roomCode).Scan(&exists)
		if exists == 0 {
			return false
		}
		s.db.Exec("INSERT OR IGNORE INTO pinned_clips (room_code, clip_id, created_at) VALUES (?, ?, ?)", roomCode, clipID, time.Now().UTC().Format(time.RFC3339))
		return true
	}
	s.db.Exec("DELETE FROM pinned_clips WHERE room_code = ? AND clip_id = ?", roomCode, clipID)
	return true
}

func (s *SQLiteStore) AddAuditEvent(roomCode, eventType string, clipID, actorUserID, actorDeviceID *string, payload *string) {
	id := uuid.New().String()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	s.db.Exec(`INSERT INTO audit_events (id, room_code, clip_id, event_type, actor_user_id, actor_device_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, roomCode, clipID, eventType, actorUserID, actorDeviceID, payload, now)
}

func (s *SQLiteStore) GetAuditEvents(roomCode string, limit int) ([]model.AuditEvent, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.Query("SELECT id, room_code, clip_id, event_type, actor_user_id, actor_device_id, payload, created_at FROM audit_events WHERE room_code = ? ORDER BY created_at DESC LIMIT ?", roomCode, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var events []model.AuditEvent
	for rows.Next() {
		var e model.AuditEvent
		rows.Scan(&e.ID, &e.RoomCode, &e.ClipID, &e.EventType, &e.ActorUserID, &e.ActorDeviceID, &e.Payload, &e.CreatedAt)
		events = append(events, e)
	}
	return events, nil
}
