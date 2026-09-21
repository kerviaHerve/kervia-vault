// MCP helpers.
// SPDX-License-Identifier: AGPL-3.0

package mcp

import (
	"encoding/json"
	"os"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
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
