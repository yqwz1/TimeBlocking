# Second Brain integration API

Phase 4 exposes a small, files-first API for a timeblocking client. The API is mounted at `/api/integration`; all note changes still use atomic vault writes, snapshots, conflict checks, and the rebuildable note index.

## Configuration

Set these values in `data/.env` (or the process environment) and restart the server:

```dotenv
TB_INTEGRATION_TOKEN=replace-with-a-long-random-secret
TB_INTEGRATION_ORIGIN=https://time.example.com
TB_PUBLIC_APP_URL=https://brain.example.com
TB_TIMEBLOCK_APP_URL=https://time.example.com
TB_INTEGRATION_EVENT_LOG=true
```

- `TB_INTEGRATION_TOKEN` is required. When absent, the integration endpoints return `503` instead of becoming public.
- `TB_INTEGRATION_ORIGIN` is the one browser origin allowed to call the API. Requests with another `Origin` are rejected. Server-to-server requests without an `Origin` are allowed when their bearer token is valid.
- `TB_PUBLIC_APP_URL` builds note deep links. `TB_TIMEBLOCK_APP_URL` builds links from daily notes to blocks.
- `TB_INTEGRATION_EVENT_LOG=false` disables the optional JSONL event log at `data/integration-events.jsonl`.

Send the secret on every request:

```http
Authorization: Bearer <TB_INTEGRATION_TOKEN>
```

## Notes

`id` is an opaque URL-safe identifier for the vault-relative path. Use the returned ID and do not construct it yourself. `url` is a browser deep link such as `https://brain.example.com/note/<id>`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/integration/notes?query=shader` | Search title/body; omit `query` to list notes |
| `GET` | `/api/integration/notes/{id}` | Read one note, including Markdown content |
| `POST` | `/api/integration/notes` | Create with `{ "path", "title"?, "content"? }` |
| `PATCH` | `/api/integration/notes/{id}` | Save with `{ "content", "expectedUpdatedAt"? }` |

Always send the last observed `updatedAt` as `expectedUpdatedAt`. A stale write receives `409` with `serverContent` and `serverUpdatedAt` so the caller can present a diff rather than overwrite another tab.

```bash
curl -H "Authorization: Bearer $TB_INTEGRATION_TOKEN" \
  "http://127.0.0.1:4141/api/integration/notes?query=shader"
```

## Markdown tasks

The API scans checkbox lines in every vault note. Both open and completed tasks are returned by default; pass `status=open` or `status=done` to filter.

```markdown
- [ ] Finish outline shader #gamedev @due(2026-08-01) #time-estimate(90m)
- [ ] Read chapter 4 #university #time-estimate(1.5h)
```

Conventions:

- `@due(YYYY-MM-DD)` sets `due`.
- `#time-estimate(30m)` or `#time-estimate(1.5h)` sets `estimateMinutes`.
- Other inline tags are merged with the source note's tags.
- Task IDs are stable while the source line and its line number are unchanged. If the line moves or is edited, fetch tasks again.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/integration/tasks?status=open` | List vault checkbox tasks |
| `POST` | `/api/integration/tasks/{id}/complete` | Atomically change the source checkbox to `[x]` |

## Daily notes and blocks

New daily notes include `## Today's blocks`. Managed content is bounded by HTML comments, so repeated syncs replace only the integration-owned portion and preserve everything written by hand.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/integration/daily/{YYYY-MM-DD}/sync` | Write that day's current blocks into the daily note |
| `POST` | `/api/integration/daily/{YYYY-MM-DD}/reflection` | Sync blocks and append/update an end-of-day reflection |

The reflection request accepts `{ "reflection": "What worked and what did not." }`. It includes completed and incomplete block lists. Block links use `/plan/{blockId}`; note links use `/note/{id}`. Both routes are SPA-safe and survive a direct browser refresh in production.

When a completed native time block belongs to a task whose `url` or `links[]` contains a Second Brain `/note/{id}` URL, its duration contributes to that note's `timeSpentMin`. The graph renders this as an amber attention halo.

## Event log

`GET /api/integration/events?after={eventId}` returns up to 200 events after the supplied cursor. Events include note creation/update, checkbox completion, daily-block sync, and reflection updates. The log is local JSONL and is optional; it is not a second source of truth.

## Manual test checklist

1. Start the app with the five variables above and confirm a missing/wrong bearer token receives `401` (or `503` when the token is not configured).
2. Create, search, read, and patch a nested-path note. Repeat the patch with an old `expectedUpdatedAt` and confirm `409`.
3. Add the two sample checkbox tasks to a note, list them, complete one through the API, and verify the Markdown file now contains `[x]`.
4. Sync today's daily note twice and confirm only one managed blocks section exists.
5. Append the reflection twice and confirm it updates in place with completed/incomplete blocks.
6. Open a returned note `url` directly in a new browser tab. Open a block link from the daily note.
7. Link a native timeblocking task to a returned note `url`, complete one of its blocks, refresh the graph, and confirm the note has an amber time-attention halo.
