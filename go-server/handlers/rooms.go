package handlers

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"sync"
	"time"

	"github.com/XingLingQAQ/NextClip/go-server/middleware"
	"github.com/XingLingQAQ/NextClip/go-server/storage"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

var validExpiry = map[string]bool{"1": true, "24": true, "168": true, "720": true, "permanent": true}
var pinRegex = regexp.MustCompile(`^\d{6}$`)

const roomTokenTTL = 24 * time.Hour

type roomTokenEntry struct {
	expiresAt time.Time
}

// RoomTokenManager manages room access tokens.
type RoomTokenManager struct {
	mu     sync.RWMutex
	tokens map[string]map[string]*roomTokenEntry // roomCode -> token -> entry
}

func NewRoomTokenManager() *RoomTokenManager {
	rtm := &RoomTokenManager{tokens: make(map[string]map[string]*roomTokenEntry)}
	go rtm.cleanupLoop()
	return rtm
}

func (rtm *RoomTokenManager) cleanupLoop() {
	ticker := time.NewTicker(60 * time.Second)
	for range ticker.C {
		rtm.mu.Lock()
		now := time.Now()
		for roomCode, tokens := range rtm.tokens {
			for token, entry := range tokens {
				if entry.expiresAt.Before(now) {
					delete(tokens, token)
				}
			}
			if len(tokens) == 0 {
				delete(rtm.tokens, roomCode)
			}
		}
		rtm.mu.Unlock()
	}
}

func (rtm *RoomTokenManager) Issue(roomCode string) string {
	token := uuid.New().String()
	rtm.mu.Lock()
	defer rtm.mu.Unlock()

	if _, ok := rtm.tokens[roomCode]; !ok {
		rtm.tokens[roomCode] = make(map[string]*roomTokenEntry)
	}
	rtm.tokens[roomCode][token] = &roomTokenEntry{expiresAt: time.Now().Add(roomTokenTTL)}
	return token
}

func (rtm *RoomTokenManager) Validate(roomCode, token string) bool {
	rtm.mu.RLock()
	defer rtm.mu.RUnlock()

	roomTokens, ok := rtm.tokens[roomCode]
	if !ok {
		return false
	}
	entry, ok := roomTokens[token]
	if !ok {
		return false
	}
	if entry.expiresAt.Before(time.Now()) {
		return false
	}
	return true
}

func (rtm *RoomTokenManager) Revoke(roomCode string) {
	rtm.mu.Lock()
	defer rtm.mu.Unlock()
	delete(rtm.tokens, roomCode)
}

// RoomHandler handles room-related API endpoints.
type RoomHandler struct {
	store    *storage.Store
	tokenMgr *RoomTokenManager
	rl       *middleware.RateLimiter
}

func NewRoomHandler(store *storage.Store, tokenMgr *RoomTokenManager, rl *middleware.RateLimiter) *RoomHandler {
	return &RoomHandler{store: store, tokenMgr: tokenMgr, rl: rl}
}

func (h *RoomHandler) GetRoom(w http.ResponseWriter, r *http.Request) {
	roomCode := chi.URLParam(r, "roomCode")
	room, err := h.store.GetRoom(roomCode)
	if err != nil || room == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"exists": false})
		return
	}

	user := middleware.GetCurrentUser(r)
	token := getRoomTokenFromRequest(r)
	canManage := user != nil && room.OwnerID != nil && *room.OwnerID == user.ID && token != "" && h.tokenMgr.Validate(room.RoomCode, token)

	resp := map[string]interface{}{
		"exists":      true,
		"hasPassword": room.HasPassword,
		"canManage":   canManage,
	}
	if canManage {
		resp["expiresAt"] = room.ExpiresAt
		resp["createdAt"] = room.CreatedAt
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *RoomHandler) JoinRoom(w http.ResponseWriter, r *http.Request) {
	roomCode := chi.URLParam(r, "roomCode")

	var body struct {
		Password string `json:"password"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	room, _ := h.store.GetRoom(roomCode)

	if room == nil {
		// Create room with 24h expiry
		expiresAt := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339Nano)
		user := middleware.GetCurrentUser(r)
		var ownerID *string
		if user != nil {
			ownerID = &user.ID
		}
		h.store.CreateRoom(roomCode, ownerID, nil, &expiresAt)
		token := h.tokenMgr.Issue(roomCode)
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"success":     true,
			"created":     true,
			"hasPassword": false,
			"token":       token,
		})
		return
	}

	if room.HasPassword {
		if body.Password == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
				"message":      "Password required",
				"needPassword": true,
			})
			return
		}
		if !h.store.VerifyRoomPassword(roomCode, body.Password) {
			writeJSON(w, http.StatusForbidden, map[string]string{"message": "Incorrect password"})
			return
		}
	}

	token := h.tokenMgr.Issue(roomCode)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":     true,
		"created":     false,
		"hasPassword": room.HasPassword,
		"expiresAt":   room.ExpiresAt,
		"token":       token,
	})
}

func (h *RoomHandler) SetPassword(w http.ResponseWriter, r *http.Request) {
	roomCode := chi.URLParam(r, "roomCode")
	user := middleware.GetCurrentUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Unauthorized"})
		return
	}

	var body struct {
		Password string `json:"password"`
		Token    string `json:"token"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	if !h.tokenMgr.Validate(roomCode, body.Token) {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "Unauthorized"})
		return
	}

	if !h.assertRoomOwner(w, roomCode, user.ID, true) {
		return
	}

	if body.Password != "" {
		if !pinRegex.MatchString(body.Password) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Password must be exactly 6 digits"})
			return
		}
	}

	var pass *string
	if body.Password != "" {
		pass = &body.Password
	}
	h.store.SetRoomPassword(roomCode, pass)
	h.tokenMgr.Revoke(roomCode)
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}

func (h *RoomHandler) SetExpiry(w http.ResponseWriter, r *http.Request) {
	roomCode := chi.URLParam(r, "roomCode")
	user := middleware.GetCurrentUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Unauthorized"})
		return
	}

	var body struct {
		ExpiryHours interface{} `json:"expiryHours"`
		Token       string      `json:"token"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	if !h.tokenMgr.Validate(roomCode, body.Token) {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "Unauthorized"})
		return
	}

	if !h.assertRoomOwner(w, roomCode, user.ID, true) {
		return
	}

	var expiryStr string
	switch v := body.ExpiryHours.(type) {
	case string:
		expiryStr = v
	case float64:
		expiryStr = strconv.FormatFloat(v, 'f', -1, 64)
	default:
		expiryStr = ""
	}

	if !validExpiry[expiryStr] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Invalid expiry value"})
		return
	}

	var expiresAt *string
	if expiryStr != "permanent" {
		hours, _ := strconv.Atoi(expiryStr)
		exp := time.Now().Add(time.Duration(hours) * time.Hour).UTC().Format(time.RFC3339Nano)
		expiresAt = &exp
	}

	h.store.SetRoomExpiry(roomCode, expiresAt)
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "expiresAt": expiresAt})
}

func (h *RoomHandler) assertRoomOwner(w http.ResponseWriter, roomCode, userID string, hasValidToken bool) bool {
	room, _ := h.store.GetRoom(roomCode)
	if room == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Room not found"})
		return false
	}
	if room.OwnerID == nil {
		if !hasValidToken {
			writeJSON(w, http.StatusForbidden, map[string]string{"message": "Only the room owner can perform this action"})
			return false
		}
		return true
	}
	if *room.OwnerID != userID {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "Only the room owner can perform this action"})
		return false
	}
	return true
}
