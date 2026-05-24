package models

// Attachment represents a file attachment on a clip.
type Attachment struct {
	Name     string `json:"name"`
	MimeType string `json:"mimeType"`
	Data     string `json:"data"`
	Size     int64  `json:"size"`
}

// Clip represents a clipboard entry in a room.
type Clip struct {
	ID            string       `json:"id"`
	RoomCode      string       `json:"roomCode"`
	Content       string       `json:"content"`
	Type          string       `json:"type"` // text, link, code, image, file, mixed
	Timestamp     string       `json:"timestamp"`
	SourceDevice  string       `json:"sourceDevice"`
	Attachments   []Attachment `json:"attachments,omitempty"`
	Metadata      string       `json:"metadata,omitempty"`
	IsSensitive   bool         `json:"isSensitive,omitempty"`
	BurnAfterRead bool         `json:"burnAfterRead,omitempty"`
}

// RoomMessage is the WebSocket message format for room events.
type RoomMessage struct {
	Type         string   `json:"type"`
	Clip         *Clip    `json:"clip,omitempty"`
	ClipID       string   `json:"clipId,omitempty"`
	Clips        []Clip   `json:"clips,omitempty"`
	PinnedClipIds []string `json:"pinnedClipIds,omitempty"`
	PinState     *bool    `json:"pinState,omitempty"`
}

// RoomDevice represents a connected device in a room.
type RoomDevice struct {
	DeviceID   string `json:"deviceId"`
	DeviceName string `json:"deviceName"`
	SocketID   string `json:"socketId"`
}

// RoomInfo contains room metadata.
type RoomInfo struct {
	RoomCode    string  `json:"roomCode"`
	HasPassword bool    `json:"hasPassword"`
	ExpiresAt   *string `json:"expiresAt"`
	OwnerID     *string `json:"ownerId"`
	CreatedAt   string  `json:"createdAt,omitempty"`
}

// User represents an authenticated user.
type User struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	CreatedAt string `json:"createdAt"`
}

// AuditEvent represents an audit log entry.
type AuditEvent struct {
	ID            string                 `json:"id"`
	RoomCode      string                 `json:"roomCode"`
	ClipID        *string                `json:"clipId"`
	EventType     string                 `json:"eventType"`
	ActorUserID   *string                `json:"actorUserId"`
	ActorDeviceID *string                `json:"actorDeviceId"`
	Payload       map[string]interface{} `json:"payload,omitempty"`
	CreatedAt     string                 `json:"createdAt"`
}

// Session represents a user session stored in SQLite.
type Session struct {
	SID       string `json:"sid"`
	UserID    string `json:"userId"`
	ExpiresAt int64  `json:"expiresAt"`
}
