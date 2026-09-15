# Spec – NoteDiscovery MCP over HTTP for several agents

| | |
|---|---|
| status | ready-to-build |
| created | 2026-09-16 |
| for | Neo (builds + tests, ships on `main`) |
| owner | Hunter (deploys on p5jc as a systemd service, adds the client to each agent) |
| sibling | `mrchenoz/kanban-tui` → `ktui mcp --transport http` (same shape; copy what worked) |

## Goal

Every agent (goku, raja, neo, bart, lisa, …) reads and writes the **shared Obsidian vault**
through NoteDiscovery's MCP tools as a client of **one always-on HTTP endpoint** on p5jc, with a
one-line MCP client entry (URL + bearer token) and no ssh, shell or file-system access to the
machine that holds the vault. This replaces the per-agent `rsync … mdnote:JCNotes/` route.

## Background (verified 2026-09-16 on `main` = `9363b98`)

- `mcp_server/` is a **hand-rolled JSON-RPC 2.0 server over stdio** (`server.py`, class
  `MCPServer`, `run()` reads stdin line by line). It does not use the `mcp` SDK at runtime. It is
  a thin client of the REST API (`client.py`, `NoteDiscoveryClient`, `X-API-Key` auth) with
  **19 tools** defined in `tools.py`: `search_notes list_notes get_note list_tags
  get_notes_by_tag get_graph get_backlinks create_note delete_note create_folder append_to_note
  move_note get_recent_notes create_note_from_template list_templates get_template health_check
  get_config`.
- Config is env-only (`config.py`): `NOTEDISCOVERY_URL`, `NOTEDISCOVERY_API_KEY`,
  `NOTEDISCOVERY_TIMEOUT`, `NOTEDISCOVERY_MAX_RETRIES`.
- `documentation/MCP.md` recommends `sparfenyuk/mcp-proxy` for a long-lived endpoint. Rejected
  here: a fresh `uvx mcp-proxy` currently fails to import against the current `mcp` SDK
  (`cannot import name 'request_ctx'`), and it has no authentication of its own.
- Deployment target (Hunter's side, not yours): the NoteDiscovery **web app** runs on p5jc as a
  rootless podman container (`raja-note.service`, user jeremy, `-p 0.0.0.0:5056:8000`,
  `NOTES_DIR=/app/data`), and will be re-pointed at the Obsidian vault that `obsidian-headless`
  keeps in sync on the same box. The MCP HTTP server will run **next to it, outside the
  container**, as user jeremy, talking to the app on loopback.

## The ask

### 1. `--transport http` for the MCP server

Add a Streamable-HTTP transport to `mcp_server` (entry points: `python -m mcp_server` and the
`notediscovery-mcp` console script), keeping stdio as the default so nothing changes for
Cursor/Claude Desktop users:

```
notediscovery-mcp                                   # stdio, as today
notediscovery-mcp --transport http --host 192.168.0.222 --port 5058
notediscovery-mcp --gen-token                       # writes the token file (0600), prints it once
```

Requirements (mirror `kanban_tui/mcp_http.py`; the flags should read the same):

- **Endpoint** `POST/GET /mcp`, MCP Streamable HTTP. Any other path → 404.
- **Bearer token on every request**: `Authorization: Bearer <token>`, constant-time compare,
  anything else → `401` with no body that leaks whether the path exists. Token from
  `--token-file` (default `~/.config/notediscovery/mcp-token`; refuse if group/world readable)
  or `NOTEDISCOVERY_MCP_TOKEN` for ad-hoc runs. Minimum 16 chars, no whitespace.
- `--host` / `--port` (never default to `0.0.0.0`), `--ssl-certfile` / `--ssl-keyfile`,
  `--log-level`.
- `--exclude REGEX` on **tool names**, enforced on `tools/list` *and* `tools/call` (an excluded
  tool called by name gets a refusal, not a 500). Deployment will use
  `--exclude '^(delete_note|move_note)$'` so agents cannot remove or rename notes; keep it a
  flag, not a hard-code.
- The **same 19 tools with the same schemas** are served over both transports. Implement once,
  dispatch twice: the cleanest route is to lift the tool handlers (`_tool_*`) into a
  transport-independent class and add an HTTP front end with the official `mcp` SDK (low-level
  `Server` + `StreamableHTTPSessionManager` under Starlette/uvicorn), while the stdio path keeps
  the existing hand-rolled loop. If you would rather port stdio to the SDK too, fine, but the
  stdio behaviour visible to clients must not change.
- **Concurrency**: several agents will call at once. Calls are independent HTTP requests to the
  REST API, so no serialisation is needed; just make sure the client (`httpx`/`requests`
  session) is safe to share or is per-call.
- **Health**: `GET /healthz` (no auth) returning 200 when the server is up and the upstream
  `health_check` succeeds, else 503. Used by the systemd unit and by the migration suite.
- Startup log line: version, upstream URL, exposed tool names, bind URL. (Same as ktui.)

### 2. Dependencies

Add the HTTP extra as an optional dependency (`notediscovery[mcp-http]`: `mcp`, `starlette`,
`uvicorn`) so the container image and the stdio path stay unchanged. Document it.

### 3. Unit file + docs

- `documentation/notediscovery-mcp.service`: systemd template (copy the shape of
  `kanban-tui/docs/ktui-mcp.service`): `User=<USER>`, `EnvironmentFile=` providing
  `NOTEDISCOVERY_URL=http://127.0.0.1:5056` and `NOTEDISCOVERY_API_KEY`, `ExecStart=… --transport
  http --host <LAN_IP> --port <PORT> --exclude '^(delete_note|move_note)$'`, `Restart=on-failure`,
  the same hardening block.
- `documentation/MCP.md`: a new section "MCP over HTTP for several agents" with the run line,
  the Claude Code client entry (both the `claude mcp add --transport http … --header` form and
  the raw JSON `{"type":"http","url":…,"headers":{"Authorization":"Bearer …"}}` form), token
  rotation, and the `--exclude` note. Keep the mcp-proxy section but mark it as the alternative.

### 4. Tests

- Token: missing / wrong / world-readable file / short token → refused; correct → 200.
- `tools/list` over HTTP equals `tools/list` over stdio (names + input schemas), minus excluded.
- `tools/call` for `search_notes`, `get_note`, `create_note`, `append_to_note` against a
  throwaway NoteDiscovery started from `run.py` with a temp `NOTES_DIR` (the repo already runs
  the app locally without Docker).
- Excluded tool called by name → refusal, no upstream request made.
- Two concurrent `create_note` calls both land.

### 6. Search must see notes changed outside the app (backend, small, phase 1)

Verified on the live vault 2026-09-16: a note created by Obsidian Sync (i.e. written straight into
`NOTES_DIR`) is **listed and readable** through the API and MCP, but **`search_notes` does not find
it until the app restarts**. Cause: `NoteIndex.bulk_set()` (the rescan that runs when the vault
fingerprint changes) only calls `_prune_search_unlocked()`, which drops deleted paths from the
inverted index; nothing re-extracts terms for paths that are new or whose mtime changed. Only
`update_note()` (app-side writes) updates search terms incrementally.

Fix in `backend/note_index.py`: in `bulk_set()`, when `_search_built` is true, compute the set of
paths that are new or whose recorded mtime differs from the previous record, read those files
(outside the lock, like `ensure_search_index_built`) and replace their terms via
`_update_search_for_note_unlocked`. Prune as today. Add a stat counter (`search_incremental_paths`).
Test: start the app on a temp vault, write a `.md` file directly into `NOTES_DIR`, call
`/api/search?q=<word from it>` → found, no restart. Also cover: external edit of an existing note
(old terms gone, new terms present) and external delete.

### 7. Phase 2 (separate PR, do not block phase 1)

The vault is edited by Jeremy in Obsidian at the same time agents write through the API, and
`utils.save_note` is an unconditional whole-file write. Add an optional `expected_mtime` (or
ETag) to `create_note` / `append_to_note`: when supplied and the file changed since, the API
returns `409` and the tool reports "note changed since you read it, re-read and retry" instead
of overwriting. Requires a small backend change on `POST /api/notes/{path}` plus the MCP tool
schema. Spec it in the PR description; Hunter will review.

## Security requirements (must hold)

1. No agent gains shell, file-system or container access on p5jc; the endpoint exposes the 19
   tools minus the excluded ones, nothing else.
2. LAN bind + bearer token; the token is per-deployment, in a 0600 file, never in the repo, a
   transcript, or the client config committed anywhere.
3. The NoteDiscovery API key is known only to the MCP server process (env from a root-owned
   EnvironmentFile), never returned by any tool (`get_config` must not echo it).
4. The web app's own auth is unchanged; agents never get its password or key.
5. Survives reboot (`systemctl enable`), restarts on failure.

## Scope split

- **Neo builds & tests** on the Mac: code, tests, unit template, docs, and a smoke script
  (`scripts/mcp_http_smoke.py`: start `run.py` on a temp vault, start the HTTP server with a temp
  token, list tools, create → append → read → search a note, assert an excluded tool is refused).
  Deliver on `main` of `mrchenoz/NoteDiscovery`. Neo cannot reach p5jc.
- **Hunter deploys**: installs the checkout's venv with the extra on p5jc, generates the token,
  installs the unit, runs the acceptance below against the real vault, then adds the client to
  each agent via `setup-agent-notediscovery.sh` (which becomes a copy of `setup-agent-kanban.sh`)
  and rewrites the agent tools block.

## Acceptance (Hunter, on p5jc)

1. `curl http://192.168.0.222:5058/healthz` → 200; `curl …/mcp` without a token → 401.
2. An agent with only the client entry lists the tools, creates
   `_agent-tests/<agent>-<date>.md`, appends to it, reads it back, and finds it by search.
3. The note appears in Obsidian on the Mac within a few seconds (vault sync), and a note edited in
   Obsidian is returned by `get_note` with the new content on the next call.
4. `delete_note` and `move_note` are refused by name.
5. Service comes back after `sudo reboot`.

## Out of scope

Attachment upload/download tools, the vault-backed container change and `mdnote` retirement
(Hunter's ops work), Excalidraw compatibility with Obsidian's plugin format.
