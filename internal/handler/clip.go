package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/XingLingQAQ/NextClip/internal/config"
	"github.com/XingLingQAQ/NextClip/internal/model"
	"github.com/XingLingQAQ/NextClip/internal/store"
	"github.com/XingLingQAQ/NextClip/internal/ws"
)

func RegisterClipRoutes(mux *http.ServeMux, db *store.SQLiteStore, cfg *config.Config, hub *ws.Hub) {
	mux.HandleFunc("POST /api/rooms/{roomCode}/clips", handleCreateClip(db, cfg, hub))
	mux.HandleFunc("GET /api/rooms/{roomCode}/clips", handleGetClips(db, cfg))
	mux.HandleFunc("GET /api/rooms/{roomCode}/clips/since/{timestamp}", handleGetClipsSince(db, cfg))
	mux.HandleFunc("DELETE /api/rooms/{roomCode}/clips/{clipId}", handleDeleteClip(db, cfg, hub))
	mux.HandleFunc("DELETE /api/rooms/{roomCode}/clips", handleClearRoom(db, cfg, hub))
	mux.HandleFunc("POST /api/rooms/{roomCode}/clips/{clipId}/restore", handleRestoreClip(db, cfg, hub))
	mux.HandleFunc("POST /api/rooms/{roomCode}/clips/{clipId}/consume", handleConsumeClip(db, cfg, hub))
}

func handleCreateClip(db *store.SQLiteStore, cfg *config.Config, hub *ws.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		roomCode := r.PathValue("roomCode")
		if !validateRoomCode(w, roomCode) {
			return
		}
		token := getRoomToken(r)
		if !db.ValidateRoomToken(roomCode, token) {
			writeJSON(w, 403, errMsg("Unauthorized"))
			return
		}
		if !db.RoomExists(roomCode) {
			writeJSON(w, 404, errMsg("Room not found"))
			return
		}

		var body struct {
			Content       string             `json:"content"`
			Type          string             `json:"type"`
			SourceDevice  string             `json:"sourceDevice"`
			Metadata      *string            `json:"metadata"`
			IsSensitive   bool               `json:"isSensitive"`
			BurnAfterRead bool               `json:"burnAfterRead"`
			Attachments   []model.Attachment `json:"attachments"`
			IdempotencyKey string            `json:"idempotencyKey"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.Type == "" {
			body.Type = "text"
		}
		if body.SourceDevice == "" {
			body.SourceDevice = "Unknown"
		}
		if body.Content == "" && len(body.Attachments) == 0 {
			writeJSON(w, 400, errMsg("Clip content or attachments required"))
			return
		}

		var idemKey *string
		if body.IdempotencyKey != "" {
			idemKey = &body.IdempotencyKey
		}

		clip, err := db.CreateClip(roomCode, body.Content, body.Type, body.SourceDevice,
			body.Metadata, body.IsSensitive, body.BurnAfterRead, body.Attachments, idemKey)
		if err != nil {
			writeJSON(w, 500, errMsg("Failed to create clip"))
			return
		}
		db.AddAuditEvent(roomCode, "clip:create", &clip.ID, nil, nil, nil)
		hub.BroadcastToRoom(roomCode, model.WSMessage{Type: "clip:new", Clip: clip})
		writeJSON(w, 200, map[string]any{"success": true, "clip": clip})
	}
}

func handleGetClips(db *store.SQLiteStore, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		roomCode := r.PathValue("roomCode")
		if !validateRoomCode(w, roomCode) {
			return
		}
		token := getRoomToken(r)
		if !db.ValidateRoomToken(roomCode, token) {
			writeJSON(w, 403, errMsg("Unauthorized"))
			return
		}
		if !db.RoomExists(roomCode) {
			writeJSON(w, 404, errMsg("Room not found"))
			return
		}
		before := r.URL.Query().Get("before")
		var beforePtr *string
		if before != "" {
			beforePtr = &before
		}
		limit := 50
		if l := r.URL.Query().Get("limit"); l != "" {
			if n, err := strconv.Atoi(l); err == nil {
				limit = n
			}
		}
		clips, _ := db.GetClipsByRoomPage(roomCode, beforePtr, limit)
		if clips == nil {
			clips = []model.Clip{}
		}
		var nextCursor *string
		if len(clips) > 0 {
			nextCursor = &clips[len(clips)-1].Timestamp
		}
		writeJSON(w, 200, map[string]any{
			"clips":        clips,
			"pinnedClipIds": db.GetPinnedClipIDs(roomCode),
			"nextCursor":   nextCursor,
		})
	}
}

func handleGetClipsSince(db *store.SQLiteStore, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		roomCode := r.PathValue("roomCode")
		timestamp := r.PathValue("timestamp")
		if !validateRoomCode(w, roomCode) {
			return
		}
		token := getRoomToken(r)
		if !db.ValidateRoomToken(roomCode, token) {
			writeJSON(w, 403, errMsg("Unauthorized"))
			return
		}
		if !db.RoomExists(roomCode) {
			writeJSON(w, 404, errMsg("Room not found"))
			return
		}
		limit := 200
		if l := r.URL.Query().Get("limit"); l != "" {
			if n, err := strconv.Atoi(l); err == nil {
				limit = n
			}
		}
		clips, _ := db.GetClipsSince(roomCode, timestamp, limit)
		if clips == nil {
			clips = []model.Clip{}
		}
		var nextCursor string
		if len(clips) > 0 {
			nextCursor = clips[len(clips)-1].Timestamp
		} else {
			nextCursor = timestamp
		}
		writeJSON(w, 200, map[string]any{"clips": clips, "serverTime": "", "nextCursor": nextCursor})
	}
}

func handleDeleteClip(db *store.SQLiteStore, cfg *config.Config, hub *ws.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		roomCode := r.PathValue("roomCode")
		clipId := r.PathValue("clipId")
		if !validateRoomCode(w, roomCode) {
			return
		}
		token := getRoomToken(r)
		if !db.ValidateRoomToken(roomCode, token) {
			writeJSON(w, 403, errMsg("Unauthorized"))
			return
		}
		if !db.DeleteClip(clipId, roomCode) {
			writeJSON(w, 404, errMsg("Clip not found"))
			return
		}
		db.AddAuditEvent(roomCode, "clip:delete", &clipId, nil, nil, nil)
		hub.BroadcastToRoom(roomCode, model.WSMessage{Type: "clip:delete", ClipID: clipId})
		writeJSON(w, 200, map[string]any{"success": true})
	}
}

func handleClearRoom(db *store.SQLiteStore, cfg *config.Config, hub *ws.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		roomCode := r.PathValue("roomCode")
		if !validateRoomCode(w, roomCode) {
			return
		}
		token := getRoomToken(r)
		if !db.ValidateRoomToken(roomCode, token) {
			writeJSON(w, 403, errMsg("Unauthorized"))
			return
		}
		deleted := db.ClearRoom(roomCode)
		db.AddAuditEvent(roomCode, "clip:clear", nil, nil, nil, nil)
		hub.BroadcastToRoom(roomCode, model.WSMessage{Type: "clip:clear"})
		writeJSON(w, 200, map[string]any{"success": true, "deleted": deleted})
	}
}

func handleRestoreClip(db *store.SQLiteStore, cfg *config.Config, hub *ws.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		roomCode := r.PathValue("roomCode")
		clipId := r.PathValue("clipId")
		if !validateRoomCode(w, roomCode) {
			return
		}
		token := getRoomToken(r)
		if !db.ValidateRoomToken(roomCode, token) {
			writeJSON(w, 403, errMsg("Unauthorized"))
			return
		}
		if !db.RestoreClip(clipId, roomCode) {
			writeJSON(w, 404, errMsg("Clip not found or not deleted"))
			return
		}
		db.AddAuditEvent(roomCode, "clip:restore", &clipId, nil, nil, nil)
		writeJSON(w, 200, map[string]any{"success": true})
	}
}

func handleConsumeClip(db *store.SQLiteStore, cfg *config.Config, hub *ws.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		roomCode := r.PathValue("roomCode")
		clipId := r.PathValue("clipId")
		if !validateRoomCode(w, roomCode) {
			return
		}
		token := getRoomToken(r)
		if !db.ValidateRoomToken(roomCode, token) {
			writeJSON(w, 403, errMsg("Unauthorized"))
			return
		}
		consumed := db.ConsumeBurnAfterRead(clipId, roomCode)
		if consumed {
			db.AddAuditEvent(roomCode, "clip:burn", &clipId, nil, nil, nil)
			hub.BroadcastToRoom(roomCode, model.WSMessage{Type: "clip:delete", ClipID: clipId})
		}
		writeJSON(w, 200, map[string]any{"success": true, "consumed": consumed})
	}
}
