// MCP helpers.
// SPDX-License-Identifier: AGPL-3.0

package mcp

import (
	"context"
	"encoding/json"
	"os"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kerviaHerve/kervia-vault/internal/model"
)

func textResult(s string) *mcp.CallToolResult {
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: s}},
	}
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func newID() string { return uuid.NewString() }

func boolPtr(b bool) *bool { return &b }

func getEnv(k string) string { return os.Getenv(k) }

// WithAgent attaches the resolved agent to the MCP context (HTTP transport).
func WithAgent(ctx context.Context, agent *model.Agent) context.Context {
	return context.WithValue(ctx, agentCtxKey{}, agent)
}
