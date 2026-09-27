# Super Productivity MCP adapter

This is a narrow, standard-stdio MCP server over Super Productivity's local REST API. It does not open a network listener, read the task database, execute shell commands, or expose arbitrary REST paths.

Set `SUPER_PRODUCTIVITY_API_TOKEN` only in the process environment, or point `SUPER_PRODUCTIVITY_API_TOKEN_FILE` at the desktop app's token file (`~/Library/Application Support/superProductivity/local-rest-api-token` on macOS); never commit the token. `SUPER_PRODUCTIVITY_API_URL` defaults to `http://127.0.0.1:3876` and should stay loopback-only.

Run it after enabling the desktop app's Local REST API:

```sh
SUPER_PRODUCTIVITY_API_TOKEN="$SP_TOKEN" node tools/super-productivity-mcp/server.mjs
```

The available tools are intentionally limited to projects/tasks and controlled create, update, and completion. Create searches exact-title duplicates and verifies the project; update and complete read before changing and read back afterward. The adapter deliberately omits deletion, bulk operations, task-control/timers, tags, notes, archives, and arbitrary API forwarding.

This stdio server can be used by a local MCP-capable client today. ChatGPT cannot connect directly to it because ChatGPT requires a remote MCP server. Do not expose it publicly; use a supported private/tunnel deployment only when a ChatGPT workspace that supports the desired MCP permissions is available.
