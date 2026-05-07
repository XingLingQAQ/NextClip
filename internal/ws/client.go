package ws

import (
	"encoding/json"
	"log"
	"time"

	"github.com/XingLingQAQ/NextClip/internal/model"
	"github.com/XingLingQAQ/NextClip/internal/store"
	"github.com/gorilla/websocket"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10
	maxMsgSize = 5 * 1024 * 1024
)

// Client represents a single WebSocket connection.
type Client struct {
	hub   *Hub
	conn  *websocket.Conn
	send  chan []byte
	room  string
	token string
	store *store.SQLiteStore
}

func NewClient(hub *Hub, conn *websocket.Conn, s *store.SQLiteStore) *Client {
	return &Client{
		hub:   hub,
		conn:  conn,
		send:  make(chan []byte, 256),
		store: s,
	}
}

// ReadPump reads messages from the WebSocket connection.
func (c *Client) ReadPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMsgSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		c.handleMessage(message)
	}
}

// WritePump writes messages to the WebSocket connection.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			c.conn.WriteMessage(websocket.TextMessage, message)

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) handleMessage(raw []byte) {
	var msg struct {
		Type string          `json:"type"`
		Data json.RawMessage `json:"data,omitempty"`
	}
	if err := json.Unmarshal(raw, &msg); err != nil {
		return
	}

	switch msg.Type {
	case "join-room":
		c.handleJoinRoom(msg.Data)
	case "send-clip":
		c.handleSendClip(msg.Data)
	case "delete-clip":
		c.handleDeleteClip(msg.Data)
	case "clear-room":
		c.handleClearRoom()
	case "pin-clip":
		c.handlePinClip(msg.Data)
	case "consume-clip":
		c.handleConsumeClip(msg.Data)
	}
}

func (c *Client) handleJoinRoom(data json.RawMessage) {
	var req struct {
		RoomCode   string `json:"roomCode"`
		Token      string `json:"token"`
		DeviceID   string `json:"deviceId"`
		DeviceName string `json:"deviceName"`
	}
	json.Unmarshal(data, &req)
	if req.RoomCode == "" || !c.store.ValidateRoomToken(req.RoomCode, req.Token) {
		c.sendError("Invalid room token. Please rejoin.")
		return
	}
	c.token = req.Token
	c.hub.JoinRoom(c, req.RoomCode)
}

func (c *Client) validateToken() bool {
	if c.room == "" || !c.store.ValidateRoomToken(c.room, c.token) {
		c.sendError("Room token expired. Please rejoin.")
		c.room = ""
		return false
	}
	return true
}

func (c *Client) handleSendClip(data json.RawMessage) {
	if !c.validateToken() {
		return
	}
	var req struct {
		Content       string             `json:"content"`
		Type          string             `json:"type"`
		SourceDevice  string             `json:"sourceDevice"`
		Metadata      *string            `json:"metadata"`
		IsSensitive   bool               `json:"isSensitive"`
		BurnAfterRead bool               `json:"burnAfterRead"`
		Attachments   []model.Attachment `json:"attachments"`
	}
	json.Unmarshal(data, &req)
	if req.Type == "" {
		req.Type = "text"
	}
	if req.SourceDevice == "" {
		req.SourceDevice = "Unknown"
	}
	if req.Content == "" && len(req.Attachments) == 0 {
		c.sendError("Clip content or attachments required.")
		return
	}

	clip, err := c.store.CreateClip(c.room, req.Content, req.Type, req.SourceDevice,
		req.Metadata, req.IsSensitive, req.BurnAfterRead, req.Attachments, nil)
	if err != nil {
		log.Printf("ws: create clip error: %v", err)
		return
	}
	c.store.AddAuditEvent(c.room, "clip:create", &clip.ID, nil, nil, nil)
	c.hub.BroadcastToRoom(c.room, model.WSMessage{Type: "clip:new", Clip: clip})
}

func (c *Client) handleDeleteClip(data json.RawMessage) {
	if !c.validateToken() {
		return
	}
	var clipID string
	json.Unmarshal(data, &clipID)
	if clipID == "" {
		return
	}
	if c.store.DeleteClip(clipID, c.room) {
		c.store.AddAuditEvent(c.room, "clip:delete", &clipID, nil, nil, nil)
		c.hub.BroadcastToRoom(c.room, model.WSMessage{Type: "clip:delete", ClipID: clipID})
	}
}

func (c *Client) handleClearRoom() {
	if !c.validateToken() {
		return
	}
	c.store.ClearRoom(c.room)
	c.store.AddAuditEvent(c.room, "clip:clear", nil, nil, nil, nil)
	c.hub.BroadcastToRoom(c.room, model.WSMessage{Type: "clip:clear"})
}

func (c *Client) handlePinClip(data json.RawMessage) {
	if !c.validateToken() {
		return
	}
	var req struct {
		ClipID string `json:"clipId"`
		Pinned bool   `json:"pinned"`
	}
	json.Unmarshal(data, &req)
	if req.ClipID == "" {
		return
	}
	if c.store.SetClipPinned(c.room, req.ClipID, req.Pinned) {
		pinned := req.Pinned
		c.hub.BroadcastToRoom(c.room, model.WSMessage{
			Type:          "clip:pin",
			ClipID:        req.ClipID,
			PinState:      &pinned,
			PinnedClipIDs: c.store.GetPinnedClipIDs(c.room),
		})
	}
}

func (c *Client) handleConsumeClip(data json.RawMessage) {
	if !c.validateToken() {
		return
	}
	var clipID string
	json.Unmarshal(data, &clipID)
	if clipID == "" {
		return
	}
	if c.store.ConsumeBurnAfterRead(clipID, c.room) {
		c.store.AddAuditEvent(c.room, "clip:burn", &clipID, nil, nil, nil)
		c.hub.BroadcastToRoom(c.room, model.WSMessage{Type: "clip:delete", ClipID: clipID})
	}
}

func (c *Client) sendError(msg string) {
	data, _ := json.Marshal(map[string]string{"type": "error", "message": msg})
	select {
	case c.send <- data:
	default:
	}
}
