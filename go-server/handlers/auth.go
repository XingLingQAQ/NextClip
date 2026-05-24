package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/XingLingQAQ/NextClip/go-server/middleware"
	"github.com/XingLingQAQ/NextClip/go-server/storage"
)

type AuthHandler struct {
	store *storage.Store
	rl    *middleware.RateLimiter
}

func NewAuthHandler(store *storage.Store, rl *middleware.RateLimiter) *AuthHandler {
	return &AuthHandler{store: store, rl: rl}
}

func (h *AuthHandler) CSRF(w http.ResponseWriter, r *http.Request) {
	token := middleware.EnsureCSRFCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]string{"csrfToken": token})
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Invalid request body"})
		return
	}

	username := trimString(body.Username)
	password := body.Password

	if username == "" || password == "" || len(username) < 2 || len(password) < 4 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Username (2+ chars) and password (4+ chars) required"})
		return
	}

	existing, _, _ := h.store.GetUser(username)
	if existing != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"message": "Username already taken"})
		return
	}

	user, err := h.store.CreateUser(username, password)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "Failed to create user"})
		return
	}

	middleware.CreateSessionCookie(w, h.store, user.ID)
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "user": user})
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Invalid request body"})
		return
	}

	if body.Username == "" || body.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "Username and password required"})
		return
	}

	user, err := h.store.VerifyUser(trimString(body.Username), body.Password)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "Internal error"})
		return
	}
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Invalid credentials"})
		return
	}

	middleware.CreateSessionCookie(w, h.store, user.ID)
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "user": user})
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetCurrentUser(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Unauthorized"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"user": user})
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	middleware.DestroySessionCookie(w, r, h.store)
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true})
}
