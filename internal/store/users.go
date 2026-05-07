package store

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/XingLingQAQ/NextClip/internal/model"
	"github.com/google/uuid"
	"golang.org/x/crypto/scrypt"
)

const (
	scryptN       = 1 << 15
	scryptR       = 8
	scryptP       = 2
	scryptKeyLen  = 64
	scryptSaltLen = 16
	hashAlgo      = "scrypt"
)

func hashPassword(plain string) (string, error) {
	salt := make([]byte, scryptSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	derived, err := scrypt.Key([]byte(plain), salt, scryptN, scryptR, scryptP, scryptKeyLen)
	if err != nil {
		return "", err
	}
	saltB64 := base64.StdEncoding.EncodeToString(salt)
	derivedB64 := base64.StdEncoding.EncodeToString(derived)
	return fmt.Sprintf("%s$%d$%d$%d$%s$%s", hashAlgo, scryptN, scryptR, scryptP, saltB64, derivedB64), nil
}

type passwordResult struct {
	Matched    bool
	NeedsRehash bool
}

func verifyPassword(plain, storedHash string) passwordResult {
	if strings.HasPrefix(storedHash, hashAlgo+"$") {
		parts := strings.Split(storedHash, "$")
		if len(parts) != 6 {
			return passwordResult{}
		}
		var n, r, p int
		fmt.Sscanf(parts[1], "%d", &n)
		fmt.Sscanf(parts[2], "%d", &r)
		fmt.Sscanf(parts[3], "%d", &p)
		salt, err1 := base64.StdEncoding.DecodeString(parts[4])
		expected, err2 := base64.StdEncoding.DecodeString(parts[5])
		if err1 != nil || err2 != nil || n == 0 {
			return passwordResult{}
		}
		derived, err := scrypt.Key([]byte(plain), salt, n, r, p, scryptKeyLen)
		if err != nil || len(derived) != len(expected) {
			return passwordResult{}
		}
		matched := subtle.ConstantTimeCompare(derived, expected) == 1
		return passwordResult{
			Matched:     matched,
			NeedsRehash: matched && (n != scryptN || r != scryptR || p != scryptP),
		}
	}
	// Legacy SHA-256 check
	if len(storedHash) == 64 {
		h := sha256.Sum256([]byte(plain))
		legacy := hex.EncodeToString(h[:])
		if strings.EqualFold(legacy, storedHash) {
			return passwordResult{Matched: true, NeedsRehash: true}
		}
	}
	return passwordResult{}
}

func (s *SQLiteStore) CreateUser(username, password string) (*model.User, error) {
	id := uuid.New().String()
	createdAt := time.Now().UTC().Format(time.RFC3339)
	normalized := strings.ToLower(username)

	hash, err := hashPassword(password)
	if err != nil {
		return nil, err
	}

	_, err = s.db.Exec(
		"INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
		id, normalized, hash, createdAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return nil, fmt.Errorf("username already taken")
		}
		return nil, err
	}
	return &model.User{ID: id, Username: normalized, CreatedAt: createdAt}, nil
}

func (s *SQLiteStore) GetUser(username string) (*model.UserWithHash, error) {
	row := s.db.QueryRow("SELECT id, username, password_hash, created_at FROM users WHERE username = ?", strings.ToLower(username))
	var u model.UserWithHash
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *SQLiteStore) VerifyUser(username, password string) (*model.User, error) {
	u, err := s.GetUser(username)
	if err != nil || u == nil {
		return nil, err
	}
	result := verifyPassword(password, u.PasswordHash)
	if !result.Matched {
		return nil, nil
	}
	if result.NeedsRehash {
		newHash, _ := hashPassword(password)
		if newHash != "" {
			s.db.Exec("UPDATE users SET password_hash = ? WHERE id = ?", newHash, u.ID)
		}
	}
	return &u.User, nil
}

func (s *SQLiteStore) GetUserByID(id string) (*model.User, error) {
	row := s.db.QueryRow("SELECT id, username, created_at FROM users WHERE id = ?", id)
	var u model.User
	err := row.Scan(&u.ID, &u.Username, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *SQLiteStore) UpdateUserPassword(userID, newPassword string) error {
	hash, err := hashPassword(newPassword)
	if err != nil {
		return err
	}
	_, err = s.db.Exec("UPDATE users SET password_hash = ? WHERE id = ?", hash, userID)
	return err
}

func (s *SQLiteStore) DeleteUser(userID string) error {
	s.db.Exec("UPDATE rooms SET owner_id = NULL WHERE owner_id = ?", userID)
	s.db.Exec("DELETE FROM user_sessions WHERE data LIKE ?", fmt.Sprintf(`%%"userId":"%s"%%`, userID))
	_, err := s.db.Exec("DELETE FROM users WHERE id = ?", userID)
	return err
}
