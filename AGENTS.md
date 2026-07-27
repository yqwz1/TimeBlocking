## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

### Second Brain graph

- The private notes graph lives at `data/graphify-second-brain/graphify-out/graph.json` and is generated from the app's Markdown vault.
- Before answering questions about the user's notes, run `graphify query "<question>" --graph data/graphify-second-brain/graphify-out/graph.json` when that file exists.
- Rebuild it with `npm run graphify:brain`. Serve it as an MCP endpoint at `http://127.0.0.1:8765/mcp` with `npm run graphify:brain:serve`.
