// MCP transports: stdio (subprocess) + streamable HTTP.
// SPDX-License-Identifier: AGPL-3.0

package mcp

import (
	"context"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// RunStdio serves the MCP over stdin/stdout until the client disconnects.
// Subprocess mode: opencode/hermes spawn the binary with KERVIA_VAULT_API_KEY
// in the environment.
func RunStdio(deps Deps) error {
	srv := Build(deps)
	return srv.Run(context.Background(), &mcp.StdioTransport{})
}

// HTTPHandler returns the streamable-HTTP MCP handler, to be mounted at /mcp
// behind the same API-key auth middleware as the REST API.
func HTTPHandler(deps Deps) (http.Handler, error) {
	srv := Build(deps)
	return mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		return srv
	}, &mcp.StreamableHTTPOptions{Stateless: true}), nil
}
