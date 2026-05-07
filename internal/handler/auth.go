package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/XingLingQAQ/NextClip/internal/config"
	"github.com/XingLingQAQ/NextClip/internal/store"
	"github.com/google/uuid"
)

const sessionCookieName = "session_id"
const sessionMaxAge = 7 * 24 * time.Hour

func RegisterAuthRoutes(mux *http.ServeMux, db *store.SQLiteStore, cfg *config.Config) {
	mux.HandleFunc("GET /api/auth/csrf", handleCSRF(db, cfg))
	mux.HandleFunc("POST /api/auth/register", handleRegister(db, cfg))
	mux.HandleFunc("POST /api/auth/login", handleLogin(db, cfg))
	mux.HandleFunc("GET /api/auth/me", handleMe(db, cfg))
	mux.HandleFunc("POST /api/auth/logout", handleLogout(db, cfg))
	mux.HandleFunc("POST /api/auth/password", handleChangePassword(db, cfg))
	mux.HandleFunc("DELETE /api/auth/account", handleDeleteAccount(db, cfg))
}

func getSessionUser(r *http.Request, db *store.SQLiteStore) *store.SessionData {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		return nil
	}
	sess, _ := db.GetSession(cookie.Value)
	return sess
}

func setSession(w http.ResponseWriter, db *store.SQLiteStore, cfg *config.Config, userID string) {
	sid := uuid.New().String()
	db.SetSession(sid, &store.SessionData{UserID: userID}, sessionMaxAge)
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    sid,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   cfg.IsProduction(),
		MaxAge:   int(sessionMaxAge.Seconds()),
	})
}

func handleCSRF(db *store.SQLiteStore, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := uuid.New().String()
		http.SetCookie(w, &http.Cookie{
			Name:     "csrf-token",
			Value:    token,
			Path:     "/",
			HttpOnly: false,
			SameSite: http.SameSiteLaxMode,
			Secure:   cfg.IsProduction(),
		})
		writeJSON(w, 200, map[string]string{"csrfToken": token})
	}
}

func handleRegister(db *store.SQLiteStore, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, 400, errMsg("Invalid request body"))
			return
		}
		if len(body.Username) < 2 || len(body.Password) < 6 {
			writeJSON(w, 400, errMsg("Username (2+ chars) and password (6+ chars) required"))
			return
		}
		user, err := db.CreateUser(body.Username, body.Password)
		if err != nil {
			if err.Error() == "username already taken" {
				writeJSON(w, 409, errMsg("Username already taken"))
			} else {
				writeJSON(w, 500, errMsg("Internal error"))
			}
			return
		}
		setSession(w, db, cfg, user.ID)
		writeJSON(w, 200, map[string]any{"success": true, "user": user})
	}
}

func handleLogin(db *store.SQLiteStore, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Username == "" || body.Password == "" {
			writeJSON(w, 400, errMsg("Username and password required"))
			return
		}
		user, _ := db.VerifyUser(body.Username, body.Password)
		if user == nil {
			writeJSON(w, 401, errMsg("Invalid credentials"))
			return
		}
		setSession(w, db, cfg, user.ID)
		writeJSON(w, 200, map[string]any{"success": true, "user": user})
	}
}

func handleMe(db *store.SQLiteStore, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := getSessionUser(r, db)
		if sess == nil || sess.UserID == "" {
			writeJSON(w, 401, errMsg("Unauthorized"))
			return
		}
		user, _ := db.GetUserByID(sess.UserID)
		if user == nil {
			writeJSON(w, 401, errMsg("Unauthorized"))
			return
		}
		writeJSON(w, 200, map[string]any{"user": user})
	}
}

func handleLogout(db *store.SQLiteStore, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookieName)
		if err == nil && cookie.Value != "" {
			db.DestroySession(cookie.Value)
		}
		http.SetCookie(w, &http.Cookie{
			Name:   sessionCookieName,
			Value:  "",
			Path:   "/",
			MaxAge: -1,
		})
		writeJSON(w, 200, map[string]any{"success": true})
	}
}

func handleChangePassword(db *store.SQLiteStore, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := getSessionUser(r, db)
		if sess == nil || sess.UserID == "" {
			writeJSON(w, 401, errMsg("Unauthorized"))
			return
		}
		var body struct {
			CurrentPassword string `json:"currentPassword"`
			NewPassword     string `json:"newPassword"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.CurrentPassword == "" || len(body.NewPassword) < 6 {
			writeJSON(w, 400, errMsg("Current password and new password (6+ chars) required"))
			return
		}
		user, _ := db.GetUserByID(sess.UserID)
		if user == nil {
			writeJSON(w, 401, errMsg("Unauthorized"))
			return
		}
		verified, _ := db.VerifyUser(user.Username, body.CurrentPassword)
		if verified == nil {
			writeJSON(w, 403, errMsg("Current password is incorrect"))
			return
		}
		db.UpdateUserPassword(sess.UserID, body.NewPassword)
		writeJSON(w, 200, map[string]any{"success": true})
	}
}

func handleDeleteAccount(db *store.SQLiteStore, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := getSessionUser(r, db)
		if sess == nil || sess.UserID == "" {
			writeJSON(w, 401, errMsg("Unauthorized"))
			return
		}
		var body struct {
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.Password == "" {
			writeJSON(w, 400, errMsg("Password confirmation required"))
			return
		}
		user, _ := db.GetUserByID(sess.UserID)
		if user == nil {
			writeJSON(w, 401, errMsg("Unauthorized"))
			return
		}
		verified, _ := db.VerifyUser(user.Username, body.Password)
		if verified == nil {
			writeJSON(w, 403, errMsg("Incorrect password"))
			return
		}
		db.DeleteUser(sess.UserID)
		cookie, _ := r.Cookie(sessionCookieName)
		if cookie != nil {
			db.DestroySession(cookie.Value)
		}
		http.SetCookie(w, &http.Cookie{Name: sessionCookieName, Value: "", Path: "/", MaxAge: -1})
		writeJSON(w, 200, map[string]any{"success": true})
	}
}

// Helpers
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func errMsg(msg string) map[string]string {
	return map[string]string{"message": msg}
}
