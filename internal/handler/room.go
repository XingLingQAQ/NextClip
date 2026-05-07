package handler

import (
	"encoding/json"
	"net/http"
	"regexp"
	"time"

	"github.com/XingLingQAQ/NextClip/internal/config"
	"github.com/XingLingQAQ/NextClip/internal/store"
	"github.com/XingLingQAQ/NextClip/internal/ws"
)

var validRoomCode = regexp.MustCompile(`^[a-z0-9]{1,20}$`)

func RegisterRoomRoutes(mux *http.ServeMux, db *store.SQLiteStore, cfg *config.Config, hub *ws.Hub) {
	mux.HandleFunc("GET /api/rooms/{roomCode}", handleGetRoom(db, cfg))
	mux.HandleFunc("POST /api/rooms/{roomCode}/join", handleJoinRoom(db, cfg))
	mux.HandleFunc("POST /api/rooms/{roomCode}/password", handleSetRoomPassword(db, cfg))
	mux.HandleFunc("POST /api/rooms/{roomCode}/expiry", handleSetRoomExpiry(db, cfg))
	mux.HandleFunc("GET /api/rooms/{roomCode}/audit", handleGetAudit(db, cfg))
	mux.HandleFunc("POST /api/rooms/{roomCode}/pins/{clipId}", handlePinClip(db, cfg))
}

func validateRoomCode(w http.ResponseWriter, roomCode string) bool {
	if !validRoomCode.MatchString(roomCode) {
		writeJSON(w, 400, errMsg("Invalid room code format. Must be 1-20 lowercase alphanumeric characters."))
		return false
	}
	return true
}

func getRoomToken(r *http.Request) string {
	if t := r.Header.Get("x-room-token"); t != "" {
		return t
	}
	if t := r.URL.Query().Get("token"); t != "" {
		return t
	}
	return ""
}

func handleGetRoom(db *store.SQLiteStore, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		roomCode := r.PathValue("roomCode")
		if !validateRoomCode(w, roomCode) {
			return
		}
		room, _ := db.GetRoom(roomCode)
		if room == nil {
			writeJSON(w, 200, map[string]any{"exists": false})
			return
		}
		token := getRoomToken(r)
		sess := getSessionUser(r, db)
		canManage := sess != nil && room.OwnerID != nil && *room.OwnerID == sess.UserID && token != "" && db.ValidateRoomToken(roomCode, token)
		resp := map[string]any{"exists": true, "hasPassword": room.HasPassword, "canManage": canManage}
		if canManage {
			resp["expiresAt"] = room.ExpiresAt
			resp["createdAt"] = room.CreatedAt
		}
		writeJSON(w, 200, resp)
	}
}

func handleJoinRoom(db *store.SQLiteStore, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		roomCode := r.PathValue("roomCode")
		if !validateRoomCode(w, roomCode) {
			return
		}
		var body struct {
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&body)

		room, _ := db.GetRoom(roomCode)
		if room == nil {
			expiresAt := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
			sess := getSessionUser(r, db)
			var ownerID *string
			if sess != nil && sess.UserID != "" {
				ownerID = &sess.UserID
			}
			db.CreateRoom(roomCode, ownerID, nil, &expiresAt)
			token := db.IssueRoomToken(roomCode)
			writeJSON(w, 200, map[string]any{"success": true, "created": true, "hasPassword": false, "token": token})
			return
		}

		if room.HasPassword {
			if body.Password == "" {
				writeJSON(w, 401, map[string]any{"message": "Password required", "needPassword": true})
				return
			}
			if !db.VerifyRoomPassword(roomCode, body.Password) {
				writeJSON(w, 403, errMsg("Incorrect password"))
				return
			}
		}

		token := db.IssueRoomToken(roomCode)
		writeJSON(w, 200, map[string]any{"success": true, "created": false, "hasPassword": room.HasPassword, "expiresAt": room.ExpiresAt, "token": token})
	}
}

func handleSetRoomPassword(db *store.SQLiteStore, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		roomCode := r.PathValue("roomCode")
		if !validateRoomCode(w, roomCode) {
			return
		}
		sess := getSessionUser(r, db)
		if sess == nil || sess.UserID == "" {
			writeJSON(w, 401, errMsg("Unauthorized"))
			return
		}
		var body struct {
			Password string `json:"password"`
			Token    string `json:"token"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if !db.ValidateRoomToken(roomCode, body.Token) {
			writeJSON(w, 403, errMsg("Unauthorized"))
			return
		}
		if body.Password != "" {
			matched, _ := regexp.MatchString(`^\d{6}$`, body.Password)
			if !matched {
				writeJSON(w, 400, errMsg("Password must be exactly 6 digits"))
				return
			}
		}
		var pw *string
		if body.Password != "" {
			pw = &body.Password
		}
		db.SetRoomPassword(roomCode, pw)
		db.RevokeRoomTokens(roomCode)
		writeJSON(w, 200, map[string]any{"success": true})
	}
}

func handleSetRoomExpiry(db *store.SQLiteStore, cfg *config.Config) http.HandlerFunc {
	validExpiry := map[string]bool{"1": true, "24": true, "168": true, "720": true, "permanent": true}
	return func(w http.ResponseWriter, r *http.Request) {
		roomCode := r.PathValue("roomCode")
		if !validateRoomCode(w, roomCode) {
			return
		}
		sess := getSessionUser(r, db)
		if sess == nil || sess.UserID == "" {
			writeJSON(w, 401, errMsg("Unauthorized"))
			return
		}
		var body struct {
			ExpiryHours string `json:"expiryHours"`
			Token       string `json:"token"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if !db.ValidateRoomToken(roomCode, body.Token) {
			writeJSON(w, 403, errMsg("Unauthorized"))
			return
		}
		if !validExpiry[body.ExpiryHours] {
			writeJSON(w, 400, errMsg("Invalid expiry value"))
			return
		}
		var expiresAt *string
		if body.ExpiryHours != "permanent" {
			hours := 0
			switch body.ExpiryHours {
			case "1":
				hours = 1
			case "24":
				hours = 24
			case "168":
				hours = 168
			case "720":
				hours = 720
			}
			t := time.Now().Add(time.Duration(hours) * time.Hour).UTC().Format(time.RFC3339)
			expiresAt = &t
		}
		db.SetRoomExpiry(roomCode, expiresAt)
		writeJSON(w, 200, map[string]any{"success": true, "expiresAt": expiresAt})
	}
}

func handleGetAudit(db *store.SQLiteStore, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		roomCode := r.PathValue("roomCode")
		if !validateRoomCode(w, roomCode) {
			return
		}
		sess := getSessionUser(r, db)
		if sess == nil || sess.UserID == "" {
			writeJSON(w, 401, errMsg("Unauthorized"))
			return
		}
		token := getRoomToken(r)
		if !db.ValidateRoomToken(roomCode, token) {
			writeJSON(w, 403, errMsg("Unauthorized"))
			return
		}
		events, _ := db.GetAuditEvents(roomCode, 100)
		writeJSON(w, 200, map[string]any{"events": events})
	}
}

func handlePinClip(db *store.SQLiteStore, cfg *config.Config) http.HandlerFunc {
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
		var body struct {
			Pinned bool `json:"pinned"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		ok := db.SetClipPinned(roomCode, clipId, body.Pinned)
		if !ok {
			writeJSON(w, 404, errMsg("Clip not found"))
			return
		}
		writeJSON(w, 200, map[string]any{"success": true, "pinned": body.Pinned})
	}
}
