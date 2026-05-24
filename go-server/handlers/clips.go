package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/XingLingQAQ/NextClip/go-server/middleware"
	"github.com/XingLingQAQ/NextClip/go-server/models"
	"github.com/XingLingQAQ/NextClip/go-server/storage"
	"github.com/XingLingQAQ/NextClip/go-server/websocket"
	"github.com/go-chi/chi/v5"
)

// ClipHandler handles clip-related API endpoints.
type ClipHandler struct {
	store    *storage.Store
	tokenMgr *RoomTokenManager
	hub      *websocket.Hub
	rl       *middleware.RateLimiter
}

func NewClipHandler(store *storage.Store, tokenMgr *RoomTokenManager, hub *websocket.Hub, rl *middleware.RateLimiter) *ClipHandler {
	return &ClipHandler{store: store, tokenMgr: tokenMgr, hub: hub, rl: rl}
}

func (h *ClipHandler) validateRoomAccess(w http.ResponseWriter, r *http.Request) (string, bool) {
	roomCode := chi.URLParam(r, "roomCode")
	token := getRoomTokenFromRequest(r)

	// Also check body token for POST requests
	if token == "" && r.Method == "POST" {
		// Try to peek at body token - already parsed by caller if needed
	}

	if token == "" || !h.tokenMgr.Validate(roomCode, token) {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "Unauthorized"})
		return "", false
	}
	if !h.store.RoomExists(roomCode) {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Room not found"})
		return "", false
	}
	return roomCode, true
}

func (h *ClipHandler) CreateClip(w http.ResponseWriter, r *http.Request) {
	roomCode, ok := h.validateRoomAccess(w, r)
	if !ok {
		return
	}

	var body struct {
		Content       string              `json:"content"`
		Type          string              `json:"type"`
		SourceDevice  string              `json:"sourceDevice"`
		Metadata      *string             `json:"metadata"`
		IsSensitive   bool                `json:"isSensitive"`
		BurnAfterRead bool                `json:"burnAfterRead"`
		Attachments   []models.Attachment `json:"attachments"`
		Token         string              `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Invalid clip payload"})
		return
	}

	if body.Type == "" {
		body.Type = "text"
	}
	if body.SourceDevice == "" {
		body.SourceDevice = "Web Clipper"
	}

	// Validate
	if len(body.Content) > 200000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Invalid clip payload"})
		return
	}
	if body.Content == "" && len(body.Attachments) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Clip content or attachments required"})
		return
	}

	idempotencyKey := getIdempotencyKey(r)
	var idempPtr *string
	if idempotencyKey != "" {
		idempPtr = &idempotencyKey
	}

	clip, err := h.store.CreateClip(
		roomCode,
		trimString(body.Content),
		body.Type,
		trimString(body.SourceDevice),
		body.Metadata,
		body.IsSensitive,
		body.BurnAfterRead,
		body.Attachments,
		idempPtr,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "Failed to create clip"})
		return
	}

	// Audit
	user := middleware.GetCurrentUser(r)
	var userID *string
	if user != nil {
		userID = &user.ID
	}
	payload := map[string]interface{}{
		"via":            "rest",
		"hasAttachments": len(body.Attachments) > 0,
	}
	if idempotencyKey != "" {
		payload["idempotencyKey"] = idempotencyKey
	}
	h.store.AddAuditEvent(roomCode, "clip:create", &clip.ID, userID, nil, payload)

	// Broadcast via WebSocket
	h.hub.BroadcastToRoom(roomCode, models.RoomMessage{Type: "clip:new", Clip: clip})

	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "clip": clip})
}

func (h *ClipHandler) GetClips(w http.ResponseWriter, r *http.Request) {
	roomCode, ok := h.validateRoomAccess(w, r)
	if !ok {
		return
	}

	before := r.URL.Query().Get("before")
	limitStr := r.URL.Query().Get("limit")
	limit := 50
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil {
			limit = l
		}
	}

	var beforePtr *string
	if before != "" {
		beforePtr = &before
	}

	clips := h.store.GetClipsByRoomPage(roomCode, beforePtr, limit)
	pinnedClipIds := h.store.GetPinnedClipIds(roomCode)

	var nextCursor *string
	if len(clips) > 0 {
		ts := clips[len(clips)-1].Timestamp
		nextCursor = &ts
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"clips":         clips,
		"pinnedClipIds": pinnedClipIds,
		"nextCursor":    nextCursor,
	})
}

func (h *ClipHandler) GetClipsSince(w http.ResponseWriter, r *http.Request) {
	roomCode, ok := h.validateRoomAccess(w, r)
	if !ok {
		return
	}

	since := chi.URLParam(r, "timestamp")
	limitStr := r.URL.Query().Get("limit")
	limit := 200
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil {
			limit = l
		}
	}

	clips := h.store.GetClipsSince(roomCode, since, limit)

	var nextCursor string
	if len(clips) > 0 {
		nextCursor = clips[len(clips)-1].Timestamp
	} else {
		nextCursor = since
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"clips":      clips,
		"serverTime": timeNowISO(),
		"nextCursor": nextCursor,
	})
}

func (h *ClipHandler) DeleteClip(w http.ResponseWriter, r *http.Request) {
	roomCode, ok := h.validateRoomAccess(w, r)
	if !ok {
		return
	}

	clipID := chi.URLParam(r, "clipId")
	if !h.store.DeleteClip(clipID, roomCode) {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Clip not found"})
		return
	}

	user := middleware.GetCurrentUser(r)
	var userID *string
	if user != nil {
		userID = &user.ID
	}
	h.store.AddAuditEvent(roomCode, "clip:delete", &clipID, userID, nil, nil)
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}

func (h *ClipHandler) ClearClips(w http.ResponseWriter, r *http.Request) {
	roomCode, ok := h.validateRoomAccess(w, r)
	if !ok {
		return
	}

	deleted := h.store.ClearRoom(roomCode)

	user := middleware.GetCurrentUser(r)
	var userID *string
	if user != nil {
		userID = &user.ID
	}
	h.store.AddAuditEvent(roomCode, "clip:clear", nil, userID, nil, map[string]interface{}{"deleted": deleted})
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "deleted": deleted})
}

func (h *ClipHandler) RestoreClip(w http.ResponseWriter, r *http.Request) {
	roomCode, ok := h.validateRoomAccess(w, r)
	if !ok {
		return
	}

	clipID := chi.URLParam(r, "clipId")
	if !h.store.RestoreClip(clipID, roomCode) {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Clip not found or not deleted"})
		return
	}

	user := middleware.GetCurrentUser(r)
	var userID *string
	if user != nil {
		userID = &user.ID
	}
	h.store.AddAuditEvent(roomCode, "clip:restore", &clipID, userID, nil, nil)

	clip := h.store.GetClipByID(clipID, roomCode)
	if clip != nil {
		h.hub.BroadcastToRoom(roomCode, models.RoomMessage{Type: "clip:new", Clip: clip})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}

func (h *ClipHandler) GetAudit(w http.ResponseWriter, r *http.Request) {
	roomCode, ok := h.validateRoomAccess(w, r)
	if !ok {
		return
	}

	limitStr := r.URL.Query().Get("limit")
	limit := 100
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil {
			limit = l
		}
	}

	events := h.store.GetAuditEvents(roomCode, limit)
	writeJSON(w, http.StatusOK, map[string]interface{}{"events": events})
}

func (h *ClipHandler) SetPinned(w http.ResponseWriter, r *http.Request) {
	roomCode := chi.URLParam(r, "roomCode")
	clipID := chi.URLParam(r, "clipId")

	token := getRoomTokenFromRequest(r)
	if token == "" || !h.tokenMgr.Validate(roomCode, token) {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "Unauthorized"})
		return
	}

	var body struct {
		Pinned bool `json:"pinned"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	success := h.store.SetClipPinned(roomCode, clipID, body.Pinned)
	if !success {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Clip not found"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "pinned": body.Pinned})
}

func timeNowISO() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
