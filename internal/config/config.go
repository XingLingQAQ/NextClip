package config

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	Port           string
	SessionSecret  string
	NodeEnv        string
	AllowedOrigins []string
	DBPath         string
	LogDebug       bool
}

func Load() (*Config, error) {
	secret := os.Getenv("SESSION_SECRET")
	if secret == "" {
		secret = os.Getenv("AUTH_SIGNING_SECRET")
	}
	if secret == "" {
		return nil, fmt.Errorf("missing session secret: set SESSION_SECRET or AUTH_SIGNING_SECRET")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	nodeEnv := os.Getenv("NODE_ENV")
	if nodeEnv == "" {
		nodeEnv = "development"
	}

	var origins []string
	if raw := os.Getenv("ALLOWED_ORIGINS"); raw != "" {
		for _, o := range strings.Split(raw, ",") {
			if trimmed := strings.TrimSpace(o); trimmed != "" {
				origins = append(origins, trimmed)
			}
		}
	}

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "clipboard.db"
	}

	return &Config{
		Port:           port,
		SessionSecret:  secret,
		NodeEnv:        nodeEnv,
		AllowedOrigins: origins,
		DBPath:         dbPath,
		LogDebug:       os.Getenv("LOG_DEBUG") == "true",
	}, nil
}

func (c *Config) IsProduction() bool {
	return c.NodeEnv == "production"
}
