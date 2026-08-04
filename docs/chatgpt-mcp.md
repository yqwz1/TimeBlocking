# Connect TimeBlocking to ChatGPT

The TimeBlocking MCP server exposes tasks, calendar blocks, projects, labels, habits, and goals to ChatGPT. It uses a bearer token and Streamable HTTP, which is the transport required for a ChatGPT custom app.

## Start it beside the desktop app

1. Start the TimeBlocking desktop app and leave it running. It normally serves its local API at `http://127.0.0.1:4141/api`.
2. In a second PowerShell window at the repository root, generate a token and start the server:

   ```powershell
   $env:TIMEBLOCK_MCP_TOKEN = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | ForEach-Object {[char]$_})
   npm run mcp:http
   ```

   Keep that PowerShell window open. The MCP endpoint is `http://127.0.0.1:3333/mcp`.

If the desktop app selected a fallback port (4142–4144), set its API URL before starting MCP. For example:

```powershell
$env:TIMEBLOCK_API_URL = 'http://127.0.0.1:4142/api'
```

Optional environment variables:

- `TIMEBLOCK_MCP_PORT` — MCP port (default `3333`)
- `TIMEBLOCK_MCP_HOST` — bind address (default `127.0.0.1`)

## Add it in ChatGPT

ChatGPT custom apps connect to remote MCP servers, not directly to localhost. Use OpenAI's Secure MCP Tunnel to make the local endpoint available without opening your router or publishing your TimeBlocking data.

1. Create a Secure MCP Tunnel for `http://127.0.0.1:3333/mcp` and copy the HTTPS endpoint it provides.
2. In ChatGPT on the web, enable Developer mode and create a custom app.
3. Enter the tunnel's HTTPS endpoint, choose bearer/API-key authentication, and provide the value of `TIMEBLOCK_MCP_TOKEN`.
4. Scan the tools, create the app, then add it to a chat from the Apps menu.

Do not expose the local MCP port publicly or reuse this token elsewhere. Stop the MCP process when you no longer want ChatGPT to access the app.

For the current ChatGPT plan and Developer mode requirements, see OpenAI's [Developer mode and MCP apps guide](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta).
