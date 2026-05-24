# ===== Stage 1: Build Go server =====
FROM golang:1.22-alpine AS go-builder

RUN apk add --no-cache gcc musl-dev sqlite-dev

WORKDIR /app/go-server
COPY go-server/go.mod go-server/go.sum ./
RUN go mod download

COPY go-server/ ./
RUN CGO_ENABLED=1 GOOS=linux go build -ldflags="-s -w" -o /app/server .

# ===== Stage 2: Build client =====
FROM node:20-alpine AS client-builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY client/ ./client/
COPY shared/ ./shared/
COPY vite.config.ts tsconfig.json postcss.config.js components.json ./
COPY vite-plugin-meta-images.ts ./
COPY client/public/ ./client/public/

RUN npm run build:client

# ===== Stage 3: Production image =====
FROM alpine:3.19

RUN apk add --no-cache ca-certificates sqlite-libs

WORKDIR /app

COPY --from=go-builder /app/server ./server
COPY --from=client-builder /app/dist/public ./dist/public

ENV PORT=5000
ENV NODE_ENV=production

EXPOSE 5000

CMD ["./server"]
