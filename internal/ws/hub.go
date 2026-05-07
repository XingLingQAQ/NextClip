package ws

import (
	"encoding/json"
	"sync"

	"github.com/XingLingQAQ/NextClip/internal/model"
	"github.com/XingLingQAQ/NextClip/internal/store"
)

// Hub manages WebSocket connections and room subscriptions.
type Hub struct {
	clients    map[*Client]bool
	rooms      map[string]map[*Client]bool
	broadcast  chan roomMessage
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
	store      *store.SQLiteStore
}

type roomMessage struct {
	roomCode string
	data     []byte
}

func NewHub(s *store.SQLiteStore) *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		rooms:      make(map[string]map[*Client]bool),
		broadcast:  make(chan roomMessage, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		store:      s,
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				if client.room != "" {
					if room, ok := h.rooms[client.room]; ok {
						delete(room, client)
						if len(room) == 0 {
							delete(h.rooms, client.room)
						}
					}
				}
				close(client.send)
			}
			h.mu.Unlock()

		case msg := <-h.broadcast:
			h.mu.RLock()
			if room, ok := h.rooms[msg.roomCode]; ok {
				for client := range room {
					select {
					case client.send <- msg.data:
					default:
						close(client.send)
						delete(room, client)
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *Hub) JoinRoom(client *Client, roomCode string) {
	h.mu.Lock()
	// Leave old room
	if client.room != "" {
		if room, ok := h.rooms[client.room]; ok {
			delete(room, client)
			if len(room) == 0 {
				delete(h.rooms, client.room)
			}
		}
	}
	// Join new room
	client.room = roomCode
	if _, ok := h.rooms[roomCode]; !ok {
		h.rooms[roomCode] = make(map[*Client]bool)
	}
	h.rooms[roomCode][client] = true
	h.mu.Unlock()

	// Send history (filter BAR clips)
	clips, _ := h.store.GetClipsByRoom(roomCode, 200)
	var filtered []model.Clip
	for _, c := range clips {
		if !c.BurnAfterRead {
			filtered = append(filtered, c)
		}
	}
	pinned := h.store.GetPinnedClipIDs(roomCode)
	msg := model.WSMessage{
		Type:          "clip:history",
		Clips:         filtered,
		PinnedClipIDs: pinned,
	}
	data, _ := json.Marshal(msg)
	client.send <- data

	// Send room user count
	h.broadcastRoomCount(roomCode)
}

func (h *Hub) BroadcastToRoom(roomCode string, msg model.WSMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.broadcast <- roomMessage{roomCode: roomCode, data: data}
}

func (h *Hub) broadcastRoomCount(roomCode string) {
	h.mu.RLock()
	count := 0
	if room, ok := h.rooms[roomCode]; ok {
		count = len(room)
	}
	h.mu.RUnlock()
	data, _ := json.Marshal(map[string]any{"type": "room-users", "count": count})
	h.broadcast <- roomMessage{roomCode: roomCode, data: data}
}

func (h *Hub) Register(client *Client) {
	h.register <- client
}

func (h *Hub) GetRoomUserCount(roomCode string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if room, ok := h.rooms[roomCode]; ok {
		return len(room)
	}
	return 0
}
