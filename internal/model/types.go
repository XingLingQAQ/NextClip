package model

// User represents a registered user.
type User struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	CreatedAt string `json:"createdAt"`
}

// UserWithHash is User plus the password hash (not serialized to JSON).
type UserWithHash struct {
	User
	PasswordHash string `json:"-"`
}

// RoomInfo represents room metadata.
type RoomInfo struct {
	RoomCode    string  `json:"roomCode"`
	HasPassword bool    `json:"hasPassword"`
	ExpiresAt   *string `json:"expiresAt"`
	OwnerID     *string `json:"ownerId"`
	CreatedAt   string  `json:"createdAt,omitempty"`
}

// Clip represents a clipboard entry.
type Clip struct {
	ID            string       `json:"id"`
	RoomCode      string       `json:"roomCode"`
	Content       string       `json:"content"`
	Type          string       `json:"type"`
	Timestamp     string       `json:"timestamp"`
	SourceDevice  string       `json:"sourceDevice"`
	Metadata      *string      `json:"metadata,omitempty"`
	IsSensitive   bool         `json:"isSensitive,omitempty"`
	BurnAfterRead bool         `json:"burnAfterRead,omitempty"`
	Attachments   []Attachment `json:"attachments,omitempty"`
}

// Attachment represents a file attached to a clip.
type Attachment struct {
	Name     string `json:"name"`
	MimeType string `json:"mimeType"`
	Data     string `json:"data"`
	Size     int64  `json:"size"`
}

// AuditEvent represents an audit log entry.
type AuditEvent struct {
	ID            string  `json:"id"`
	RoomCode      string  `json:"roomCode"`
	ClipID        *string `json:"clipId"`
	EventType     string  `json:"eventType"`
	ActorUserID   *string `json:"actorUserId"`
	ActorDeviceID *string `json:"actorDeviceId"`
	Payload       *string `json:"payload,omitempty"`
	CreatedAt     string  `json:"createdAt"`
}

// RoomDevice represents a connected device in a room.
type RoomDevice struct {
	SocketID   string `json:"socketId"`
	DeviceID   string `json:"deviceId"`
	DeviceName string `json:"deviceName"`
}

// WSMessage represents a WebSocket message sent to clients.
type WSMessage struct {
	Type         string  `json:"type"`
	Clip         *Clip   `json:"clip,omitempty"`
	ClipID       string  `json:"clipId,omitempty"`
	Clips        []Clip  `json:"clips,omitempty"`
	PinnedClipIDs []string `json:"pinnedClipIds,omitempty"`
	PinState     *bool   `json:"pinState,omitempty"`
}
