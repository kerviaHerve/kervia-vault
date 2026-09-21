# Kervia-vault — multi-stage distroless build.
# Build:  docker build -t kervia-vault .
# Run:    see docker-compose.yml
#
# SPDX-License-Identifier: AGPL-3.0

FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# static binary, no CGO (modernc sqlite is pure Go)
RUN CGO_ENABLED=0 go build \
    -trimpath \
    -ldflags="-s -w -X main.version=$(git describe --tags --always 2>/dev/null || echo dev)" \
    -o /out/kervia-vault ./cmd/kervia-vault

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/kervia-vault /kervia-vault
# data dir for the sqlite file (mount a volume here)
VOLUME /data
ENV KERVIA_VAULT_DB=/data/kervia-vault.db
EXPOSE 8321
USER nonroot
ENTRYPOINT ["/kervia-vault"]