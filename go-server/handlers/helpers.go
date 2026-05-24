package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
)

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func trimString(s string) string {
	return strings.TrimSpace(s)
}

func getRoomTokenFromRequest(r *http.Request) string {
	if token := r.Header.Get("X-Room-Token"); token != "" {
		return strings.TrimSpace(token)
	}
	if token := r.URL.Query().Get("token"); token != "" {
		return strings.TrimSpace(token)
	}
	// Check body token (for POST requests with parsed body)
	return ""
}

func getIdempotencyKey(r *http.Request) string {
	if key := r.Header.Get("X-Idempotency-Key"); key != "" {
		k := strings.TrimSpace(key)
		if len(k) > 120 {
			return k[:120]
		}
		return k
	}
	return ""
}
