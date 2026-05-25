package websocket

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/XingLingQAQ/NextClip/go-server/models"
	"github.com/XingLingQAQ/NextClip/go-server/storage"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024 * 10,
	WriteBufferSize: 1024 * 10,
	CheckOrigin: func(r *http.Request) bool {
		return true // In production, validate origin
	},
}

// TokenValidator validates room tokens.
type TokenValidator interface {
	Validate(roomCode, token string) bool
}

// Hub manages WebSocket connections and room state.
type Hub struct {
	mu             sync.RWMutex
	rooms          map[string]map[*Client]bool           // roomCode -> set of clients
	roomDevices    map[string]map[string]*models.RoomDevice // roomCode -> socketID -> device
	store          *storage.Store
	tokenValidator TokenValidator
}

// Client represents a single WebSocket connection.
type Client struct {
	ID       string
	conn     *websocket.Conn
	hub      *Hub
	room     string
	deviceID string
	send     chan []byte
}

func NewHub(store *storage.Store, tokenValidator TokenValidator) *Hub {
	return &Hub{
		rooms:          make(map[string]map[*Client]bool),
		roomDevices:    make(map[string]map[string]*models.RoomDevice),
		store:          store,
		tokenValidator: tokenValidator,
	}
}

// BroadcastToRoom sends a message to all clients in a room.
// Messages are wrapped in {"type":"room-message","data":{...}} envelope for the client.
func (h *Hub) BroadcastToRoom(roomCode string, msg models.RoomMessage) {
	envelope := map[string]interface{}{
		"type": "room-message",
		"data": msg,
	}
	data, err := json.Marshal(envelope)
	if err != nil {
		return
	}

	h.mu.RLock()
	clients := h.rooms[roomCode]
	// Copy client references while holding the lock to avoid race on map iteration
	targets := make([]*Client, 0, len(clients))
	for client := range clients {
		targets = append(targets, client)
	}
	h.mu.RUnlock()

	for _, client := range targets {
		select {
		case client.send <- data:
		default:
			// Client buffer full, skip
		}
	}
}

// BroadcastToClient sends a message to a specific client.
// Messages are wrapped in {"type":"room-message","data":{...}} envelope for the client.
func (h *Hub) BroadcastToClient(client *Client, msg models.RoomMessage) {
	envelope := map[string]interface{}{
		"type": "room-message",
		"data": msg,
	}
	data, err := json.Marshal(envelope)
	if err != nil {
		return
	}
	select {
	case client.send <- data:
	default:
	}
}

func (h *Hub) emitRoomUsers(roomCode string) {
	h.mu.RLock()
	clients := h.rooms[roomCode]
	count := len(clients)
	devices := make([]models.RoomDevice, 0)
	if devMap, ok := h.roomDevices[roomCode]; ok {
		for _, d := range devMap {
			devices = append(devices, *d)
		}
	}
	// Copy client references while holding the lock
	targets := make([]*Client, 0, len(clients))
	for client := range clients {
		targets = append(targets, client)
	}
	h.mu.RUnlock()

	// Send room-users count
	countMsg, _ := json.Marshal(map[string]interface{}{
		"type": "room-users",
		"data": count,
	})
	// Send room-devices list
	devicesMsg, _ := json.Marshal(map[string]interface{}{
		"type": "room-devices",
		"data": devices,
	})

	for _, client := range targets {
		select {
		case client.send <- countMsg:
		default:
		}
		select {
		case client.send <- devicesMsg:
		default:
		}
	}
}

func (h *Hub) addClient(client *Client, roomCode string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.rooms[roomCode]; !ok {
		h.rooms[roomCode] = make(map[*Client]bool)
	}
	h.rooms[roomCode][client] = true
	client.room = roomCode
}

func (h *Hub) removeClient(client *Client) {
	h.mu.Lock()
	roomCode := client.room
	if roomCode != "" {
		delete(h.rooms[roomCode], client)
		if len(h.rooms[roomCode]) == 0 {
			delete(h.rooms, roomCode)
		}
		if devMap, ok := h.roomDevices[roomCode]; ok {
			delete(devMap, client.ID)
			if len(devMap) == 0 {
				delete(h.roomDevices, roomCode)
			}
		}
	}
	h.mu.Unlock()

	if roomCode != "" {
		h.emitRoomUsers(roomCode)
	}
}

func (h *Hub) setDevice(roomCode, socketID, deviceID, deviceName string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.roomDevices[roomCode]; !ok {
		h.roomDevices[roomCode] = make(map[string]*models.RoomDevice)
	}
	h.roomDevices[roomCode][socketID] = &models.RoomDevice{
		SocketID:   socketID,
		DeviceID:   deviceID,
		DeviceName: deviceName,
	}
}

func (h *Hub) getDeviceID(roomCode, socketID string) string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if devMap, ok := h.roomDevices[roomCode]; ok {
		if dev, ok := devMap[socketID]; ok {
			return dev.DeviceID
		}
	}
	return ""
}

func (h *Hub) getClientsByDeviceID(roomCode, deviceID string) []*Client {
	h.mu.RLock()
	defer h.mu.RUnlock()

	var result []*Client
	if devMap, ok := h.roomDevices[roomCode]; ok {
		for socketID, dev := range devMap {
			if dev.DeviceID == deviceID {
				// Find client with this socket ID
				if clients, ok := h.rooms[roomCode]; ok {
					for client := range clients {
						if client.ID == socketID {
							result = append(result, client)
						}
					}
				}
			}
		}
	}
	return result
}

// HandleWebSocket handles WebSocket upgrade and message processing.
func (h *Hub) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	client := &Client{
		ID:   uuid.New().String(),
		conn: conn,
		hub:  h,
		send: make(chan []byte, 256),
	}

	go client.writePump()
	go client.readPump()
}

func (c *Client) readPump() {
	defer func() {
		c.hub.removeClient(c)
		c.conn.Close()
	}()

	c.conn.SetReadLimit(10 * 1024 * 1024) // 10MB max
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
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

func (c *Client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) handleMessage(raw []byte) {
	var msg map[string]interface{}
	if err := json.Unmarshal(raw, &msg); err != nil {
		return
	}

	// Client sends event name as "_event" field to avoid collision with data "type" field
	eventType, _ := msg["_event"].(string)
	if eventType == "" {
		// Fallback: try "type" field for backward compatibility
		eventType, _ = msg["type"].(string)
	}

	switch eventType {
	case "join-room":
		c.handleJoinRoom(msg)
	case "send-clip":
		c.handleSendClip(msg)
	case "update-clip":
		c.handleUpdateClip(msg)
	case "delete-clip":
		c.handleDeleteClip(msg)
	case "clear-room":
		c.handleClearRoom()
	case "pin-clip":
		c.handlePinClip(msg)
	}
}

func (c *Client) handleJoinRoom(msg map[string]interface{}) {
	roomCode, _ := msg["roomCode"].(string)
	token, _ := msg["token"].(string)
	deviceID, _ := msg["deviceId"].(string)
	deviceName, _ := msg["deviceName"].(string)

	if roomCode == "" {
		return
	}
	if deviceName == "" {
		deviceName = "Unknown Device"
	}
	if deviceID == "" {
		deviceID = c.ID
	}

	if !c.hub.tokenValidator.Validate(roomCode, token) {
		errMsg, _ := json.Marshal(map[string]interface{}{
			"type": "room-error",
			"data": map[string]string{"message": "Invalid room token. Please rejoin."},
		})
		select {
		case c.send <- errMsg:
		default:
		}
		return
	}

	// Leave current room
	if c.room != "" {
		oldRoom := c.room
		c.hub.mu.Lock()
		delete(c.hub.rooms[c.room], c)
		if len(c.hub.rooms[c.room]) == 0 {
			delete(c.hub.rooms, c.room)
		}
		if devMap, ok := c.hub.roomDevices[c.room]; ok {
			delete(devMap, c.ID)
		}
		c.hub.mu.Unlock()
		// Notify remaining clients in the old room about the updated user count
		c.hub.emitRoomUsers(oldRoom)
	}

	c.room = roomCode
	c.deviceID = deviceID
	c.hub.addClient(c, roomCode)
	c.hub.setDevice(roomCode, c.ID, deviceID, deviceName)

	// Send clip history
	clips := c.hub.store.GetClipsByRoom(roomCode)
	pinnedClipIds := c.hub.store.GetPinnedClipIds(roomCode)
	historyMsg := models.RoomMessage{
		Type:          "clip:history",
		Clips:         clips,
		PinnedClipIds: pinnedClipIds,
	}
	c.hub.BroadcastToClient(c, historyMsg)

	// Emit room users
	c.hub.emitRoomUsers(roomCode)
}

func (c *Client) handleSendClip(msg map[string]interface{}) {
	if c.room == "" {
		return
	}
	if !c.hub.store.RoomExists(c.room) {
		errMsg, _ := json.Marshal(map[string]interface{}{
			"type": "room-error",
			"data": map[string]string{"message": "Room expired. Please rejoin."},
		})
		select {
		case c.send <- errMsg:
		default:
		}
		return
	}

	content, _ := msg["content"].(string)
	clipType, _ := msg["type"].(string)
	sourceDevice, _ := msg["sourceDevice"].(string)
	metadata, _ := msg["metadata"].(string)
	isSensitive, _ := msg["isSensitive"].(bool)
	burnAfterRead, _ := msg["burnAfterRead"].(bool)
	targetDeviceID, _ := msg["targetDeviceId"].(string)

	if clipType == "" {
		clipType = "text"
	}
	if sourceDevice == "" {
		sourceDevice = "Unknown"
	}

	var metaPtr *string
	if metadata != "" {
		metaPtr = &metadata
	}

	// Parse attachments
	var attachments []models.Attachment
	if rawAtt, ok := msg["attachments"]; ok {
		data, _ := json.Marshal(rawAtt)
		json.Unmarshal(data, &attachments)
	}

	clip, err := c.hub.store.CreateClip(c.room, content, clipType, sourceDevice, metaPtr, isSensitive, burnAfterRead, attachments, nil)
	if err != nil {
		return
	}

	// Audit
	actorDeviceID := c.hub.getDeviceID(c.room, c.ID)
	var actorDevPtr *string
	if actorDeviceID != "" {
		actorDevPtr = &actorDeviceID
	}
	targeted := targetDeviceID != "" && targetDeviceID != "all"
	c.hub.store.AddAuditEvent(c.room, "clip:create", &clip.ID, nil, actorDevPtr, map[string]interface{}{
		"via":      "socket",
		"targeted": targeted,
	})

	roomMsg := models.RoomMessage{Type: "clip:new", Clip: clip}

	if targetDeviceID == "" || targetDeviceID == "all" {
		c.hub.BroadcastToRoom(c.room, roomMsg)
	} else {
		// Send to target device and sender (with envelope)
		envelope := map[string]interface{}{
			"type": "room-message",
			"data": roomMsg,
		}
		data, _ := json.Marshal(envelope)
		targets := c.hub.getClientsByDeviceID(c.room, targetDeviceID)
		for _, target := range targets {
			select {
			case target.send <- data:
			default:
			}
		}
		// Also send to sender
		select {
		case c.send <- data:
		default:
		}
	}
}

func (c *Client) handleUpdateClip(msg map[string]interface{}) {
	if c.room == "" {
		return
	}
	clipID, _ := msg["clipId"].(string)
	content, _ := msg["content"].(string)
	clipType, _ := msg["type"].(string)

	if clipID == "" {
		return
	}

	if c.hub.store.UpdateClip(clipID, c.room, content, clipType) {
		actorDeviceID := c.hub.getDeviceID(c.room, c.ID)
		var actorDevPtr *string
		if actorDeviceID != "" {
			actorDevPtr = &actorDeviceID
		}
		c.hub.store.AddAuditEvent(c.room, "clip:update", &clipID, nil, actorDevPtr, nil)

		clip := c.hub.store.GetClipByID(clipID, c.room)
		if clip != nil {
			c.hub.BroadcastToRoom(c.room, models.RoomMessage{Type: "clip:update", Clip: clip})
		}
	}
}

func (c *Client) handleDeleteClip(msg map[string]interface{}) {
	if c.room == "" {
		return
	}
	clipID, _ := msg["clipId"].(string)
	if clipID == "" {
		return
	}

	if c.hub.store.DeleteClip(clipID, c.room) {
		actorDeviceID := c.hub.getDeviceID(c.room, c.ID)
		var actorDevPtr *string
		if actorDeviceID != "" {
			actorDevPtr = &actorDeviceID
		}
		c.hub.store.AddAuditEvent(c.room, "clip:delete", &clipID, nil, actorDevPtr, nil)
		c.hub.BroadcastToRoom(c.room, models.RoomMessage{Type: "clip:delete", ClipID: clipID})
	}
}

func (c *Client) handleClearRoom() {
	if c.room == "" {
		return
	}
	c.hub.store.ClearRoom(c.room)

	actorDeviceID := c.hub.getDeviceID(c.room, c.ID)
	var actorDevPtr *string
	if actorDeviceID != "" {
		actorDevPtr = &actorDeviceID
	}
	c.hub.store.AddAuditEvent(c.room, "clip:clear", nil, nil, actorDevPtr, nil)
	c.hub.BroadcastToRoom(c.room, models.RoomMessage{Type: "clip:clear"})
}

func (c *Client) handlePinClip(msg map[string]interface{}) {
	if c.room == "" {
		return
	}
	clipID, _ := msg["clipId"].(string)
	pinned, _ := msg["pinned"].(bool)

	if clipID == "" {
		return
	}

	success := c.hub.store.SetClipPinned(c.room, clipID, pinned)
	if !success {
		return
	}

	actorDeviceID := c.hub.getDeviceID(c.room, c.ID)
	var actorDevPtr *string
	if actorDeviceID != "" {
		actorDevPtr = &actorDeviceID
	}

	eventType := "clip:pin"
	if !pinned {
		eventType = "clip:unpin"
	}
	c.hub.store.AddAuditEvent(c.room, eventType, &clipID, nil, actorDevPtr, nil)

	pinnedClipIds := c.hub.store.GetPinnedClipIds(c.room)
	c.hub.BroadcastToRoom(c.room, models.RoomMessage{
		Type:          "clip:pin",
		ClipID:        clipID,
		PinState:      &pinned,
		PinnedClipIds: pinnedClipIds,
	})
}
