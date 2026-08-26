# @gzl10/plane-client

<!-- badges -->
<img src="https://img.shields.io/npm/v/@gzl10/plane-client" alt="npm version">
<img src="https://img.shields.io/npm/dm/@gzl10/plane-client" alt="npm downloads">
<img src="https://img.shields.io/npm/l/@gzl10/plane-client" alt="license">

Unofficial typed HTTP client for [Plane API](https://plane.so). Zero runtime dependencies for library usage (CLI requires `commander`). Tested with Plane **v1.3.0**.

## Table of Contents

- [Installation](#installation)
- [Library Usage](#library-usage)
- [CLI Usage](#cli-usage)
- [Using with AI agents](#using-with-ai-agents)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Error Handling](#error-handling)
- [Changelog](#changelog)
- [License](#license)

## Installation

```bash
pnpm add @gzl10/plane-client
```

Requires Node >=20. ESM-only — use `"type": "module"` in `package.json` or `.mjs` extension.

## Library Usage

```typescript
import { PlaneClient } from '@gzl10/plane-client'

const client = new PlaneClient({
  baseUrl: 'https://plane.example.com',
  apiKey: 'pk_...',
  workspace: 'my-workspace',
})

// Work items
const page = await client.workItems.list('project-uuid', { orderBy: '-created_at' })
const item = await client.workItems.get('PREFIX-42')
await client.workItems.create('project-uuid', { name: 'New task' })

// Iterate all pages
for await (const item of client.workItems.listAll('project-uuid')) {
  console.log(item.name)
}

// Projects — the workspace-level listing that resolves an identifier (HL, PCL) to its UUID
const projects = await client.projects.list()
for await (const project of client.projects.listAll()) {
  console.log(project.identifier, project.name, project.id)
}

// Project CRUD. The feature toggles are applied with a follow-up PATCH — see the gotchas.
const project = await client.projects.create({
  name: 'New project',
  identifier: 'NEW',
  moduleView: true, intakeView: true, viewsView: true,
  cycleView: false, pageView: false,
})
await client.projects.update(project.id, { description: 'updated' })
await client.projects.delete(project.id)   // cascades to work items, modules, cycles, intake

// Cycles
const cycles = await client.cycles.list('project-uuid')
await client.cycles.create('project-uuid', { name: 'Sprint 1', start_date: '2026-04-01' })

// Modules, states, labels, intake
const states = await client.states.list('project-uuid')
const modules = await client.modules.list('project-uuid')
await client.intake.create('project-uuid', { name: 'Bug report' })

// Attachments — one call drives the full presigned-URL flow (credentials -> S3 upload -> confirm)
import { readFileSync } from 'node:fs'
const file = readFileSync('report.pdf')
const attachment = await client.workItems.attachments.upload(
  'project-uuid', 'work-item-uuid',
  { name: 'report.pdf', type: 'application/pdf', size: file.length },
  file,
)
const attachments = await client.workItems.attachments.list('project-uuid', 'work-item-uuid')
const downloadUrl = await client.workItems.attachments.getDownloadUrl('project-uuid', 'work-item-uuid', attachment.id)
await client.workItems.attachments.delete('project-uuid', 'work-item-uuid', attachment.id)
// Also works on intake work items — resolve to the underlying issue id first:
const issueId = await client.intake.resolveIssueId('project-uuid', intakeRecordId)
```

## CLI Usage

The package includes a CLI tool `planec` for interacting with Plane from the command line.

### Installation

```bash
npm install -g @gzl10/plane-client
```

### Configuration

```bash
planec config set baseUrl https://plane.example.com
planec login --token YOUR_API_KEY
planec workspace use YOUR_WORKSPACE_SLUG   # or use --workspace / PLANE_WORKSPACE
planec use PROJECT_UUID                    # or use -p / PLANE_PROJECT
```

Config is stored in `~/.planec/config.json` (token-protected, chmod 600).

### Help & Version

```bash
planec --help         # Show global help and available commands
planec --version      # Show installed version
```

Workspace and project can be omitted from config and passed per-command instead:

```bash
# Via flag (workspace is a global flag before the subcommand)
planec --workspace my-slug work-items list -p <project-uuid>

# Via environment variables
PLANE_WORKSPACE=my-slug PLANE_PROJECT=<uuid> planec work-items list
```

### Usage

```bash
# Projects — discover the project UUID every other command needs
planec projects list
planec projects list --json | jq '.[] | {identifier, name, id}'
planec projects get PCL                     # by UUID or identifier
planec projects create --name "New project" --identifier NEW    # modules+intake+views on, cycles+pages off
planec projects update PCL --description "..." --cycles
planec projects delete NEW --dry-run        # what it would cascade to, without deleting
planec projects delete NEW --confirm NEW    # the identifier must be typed back; --yes is NOT accepted

# Work items
planec work-items list
planec work-items list --expand state,modules   # expand fields; defaults to state,modules
planec work-items list --with-modules           # attach module membership client-side (see notes below)
planec work-items get PROJ-42
planec work-items get PROJ-42 --with-comments   # attach comment bodies (a count hint prints to stderr regardless)
planec work-items search "query" --workspace-search
planec work-items create --name "Fix bug" --priority high
planec work-items create --name "Fix bug" --module <moduleUuid>   # create + add to a module in one step
# update (and comments/links/relations/get-by-id/activities) accept a PROJ-42 identifier or a UUID
planec work-items update PROJ-42 --state <stateUuid>

# Comments, links, relations
planec work-items comments list <workItemId>
planec work-items comments create <workItemId> --comment-html "<p>text</p>"
planec work-items links create <workItemId> --url https://...
planec work-items relations create <workItemId> --type blocking --issues PROJ-43,PROJ-44   # UUIDs or PROJ-N

# Attachments (also works on intake work items — same underlying issue id)
planec work-items attachments list <workItemId>
planec work-items attachments upload <workItemId> --file ./report.pdf --type application/pdf
planec work-items attachments download-url <workItemId> <attachmentId>   # the detail GET redirects, this resolves it
planec work-items attachments delete <workItemId> <attachmentId>

# Cycles
planec cycles list
planec cycles create --name "Sprint 1" --start-date 2026-01-01 --end-date 2026-01-14
planec cycles add-work-items <cycleId> --work-items PROJ-42,PROJ-43   # UUIDs or PROJ-N
planec cycles transfer <fromId> --to <toId>
planec cycles delete <cycleId> --yes   # --yes skips the confirmation prompt

# Modules, states, labels, intake
planec modules list
planec modules delete <moduleId> --yes   # --yes skips the confirmation prompt
planec states list
planec labels list
planec intake list
planec intake accept <id>     # <id> is the intake record id (as listed) or the work item id
planec intake decline <id>

# JSON output (for piping with jq)
planec --json work-items list | jq '.items[].name'

# Override workspace and project per command
planec --workspace my-slug work-items list -p <uuid>
# or via env vars
PLANE_WORKSPACE=my-slug PLANE_PROJECT=<uuid> planec work-items list
```

### CLI behaviour notes

- **`--json` is safe to pipe.** Output is flushed before exit, so large payloads (dense `description_html`) are never truncated when piped to `jq`.
- **`work-items get` / `get-by-id`** request `expand=state,modules`, so the response carries the expanded `state` object. `work-items list` defaults to `--expand state,modules`; pass `--expand <fields>` to override. Note that `modules` is requested but **the API never actually returns it** (see below) — `expand=state` is the part that works.
- **`--with-modules`** (`work-items list`/`get`/`get-by-id`) attaches a `modules` array to each item by walking every module in the project client-side — a workaround for the API limitation above. Costs one extra request per module, so it's opt-in; not needed if you already know which module you're looking at (`modules work-items <id>`).
- **`work-items get` / `get-by-id` always check for comments and warn on stderr if any exist** (`N comment(s) on <id> — ... planec work-items comments list <id> ...`), because comments are a separate resource the item response never includes — context, corrections, or "this no longer applies" living only in a comment used to go silently unread. One extra request, so it's unconditional (unlike `--with-modules`, which is N+1). Pass `--with-comments` to attach the comment bodies to the output instead of just the hint. If the comments check itself fails (e.g. a differently-scoped token), it warns on stderr and still prints the work item — it never hides data that was already fetched successfully. `--with-modules` and the comments check run concurrently, not sequentially.
- **`update` and the other work-item subcommands** (`get-by-id`, `activities`, `comments`, `links`, `relations`, `modules/cycles remove-work-item`) accept a `PROJ-42` identifier or a UUID.
- **Empty lists print the resolved workspace/project to stderr** (stdout stays clean) so a wrong-context empty result is not silent.
- **`-p/--project` accepts a UUID or the project identifier** (`-p PCL`) on every command, as do `PLANE_PROJECT` and the saved config. Resolving an identifier costs one extra request; a UUID goes through untouched.
- **`intake list` shows the work item title and a labelled status.** The API keeps the title inside `issue_detail` and the status as a bare integer, so the table flattens both (`pending (-2)`, `declined (-1)`, `snoozed (0)`, `accepted (1)`, `duplicate (2)`); the numeric code stays visible and an unknown code is shown as-is rather than mislabelled. `--json` returns the raw objects.
- **`projects delete` does not accept a bare `--yes`.** Deleting a project cascades to its work items, modules, cycles and intake queue, and the API neither warns nor refuses. The command prints that inventory first, then requires the project identifier to be typed back (or passed as `--confirm <identifier>` for scripts); `--dry-run` shows the blast radius and exits. `projects get|update|delete` all accept a UUID **or** the identifier (`PCL`) — reading a prefix back is a lot safer than pasting a UUID.
- **`projects create` applies the feature toggles with a second request.** A project created with `intake_view: true` in the POST body keeps the flag but answers **500** on the first intake call; the same value sent as a PATCH provisions it properly. `create()` does the POST + PATCH for you, so one create is two requests.
- **`projects list` walks every page** instead of stopping at the API's 20-item default, so a workspace with more projects than one page never comes back silently truncated. `--per-page <n>` only tunes the page size (the API caps it at 100).
- **The project is resolved uniformly** (`-p` flag > `PLANE_PROJECT` env > saved config); a missing or unresolvable project fails with a clear error, and `planec use PCL` stores the resolved UUID rather than the prefix.
- **`401`/`403` errors add an actionable hint** on stderr (invalid key vs. missing permission).
- **`modules delete` / `cycles delete` prompt for confirmation** unless `--yes` is passed.

## Using with AI agents (Claude, Codex, etc.)

Any agent with bash access can drive Plane through the `planec` CLI with no extra code. Install it globally and point the agent at the commands — JSON output makes it easy to pipe into further processing:

```bash
# Discover work items
planec --json work-items search "auth bug"

# Get a work item by human-readable identifier
planec --json work-items get PROJ-42

# Create a work item and capture the ID
planec --json work-items create -p $PROJECT --name "Fix login" --priority high | jq -r '.id'

# List cycles and add a work item to the active one
planec --json cycles list -p $PROJECT | jq -r '.[0].id'
planec cycles add-work-items $CYCLE_ID --work-items $WORK_ITEM_ID -p $PROJECT

# List projects (for resolving the project UUID)
planec --json projects list | jq '.[] | {identifier, name, id}'

# List states and labels (for resolving IDs)
planec --json states list -p $PROJECT | jq '.[] | {id, name, group}'
planec --json labels list -p $PROJECT
```

See `llms.txt` for a complete command reference optimised for AI agents.

## API Reference

### Resources

| Resource | Methods |
|----------|---------|
| `workItems` | list, get, getById, search, create, update, listAll |
| `workItems.comments` | list, create, update, delete |
| `workItems.links` | create |
| `workItems.relations` | list, create |
| `workItems.activities` | list |
| `workItems.attachments` | list, upload, getDownloadUrl, delete |
| `projects` | list, listAll, get, create, update, delete |
| `states` | list |
| `labels` | list, create |
| `modules` | list, get, create, update, delete, workItems, workItemsAll, addWorkItems, removeWorkItem, membershipMap |
| `cycles` | list, get, create, update, delete, archive, workItems, workItemsAll, addWorkItems, removeWorkItem, transfer |
| `intake` | list, create, accept, decline |

> **Note:** `PagesResource` exists in `src/resources/pages.ts` but is not mounted on `PlaneClient` — the Pages API is not available in Plane v1 (see [gotchas](#api-v1-gotchas)).

### Configuration

```typescript
new PlaneClient({
  baseUrl: string,          // Your Plane instance URL
  apiKey: string,           // API key
  workspace: string,        // Workspace slug
  timeout?: number,         // Default 30000ms
  retry?: {
    maxRetries?: number,    // Default 2
    retryOn?: number[],     // Default [429, 502, 503, 504]
  },
  onRequest?: (req: { method: string; url: string }) => void,   // Debug hook
  onResponse?: (res: { method: string; url: string; status: number; durationMs: number }) => void,  // Observability hook
})
```

### Error Handling

```typescript
import { PlaneApiError } from '@gzl10/plane-client'

try {
  await client.workItems.create('proj', { name: '' })
} catch (err) {
  if (err instanceof PlaneApiError) {
    err.status      // 400
    err.isAuth       // false
    err.isRateLimit  // false
    err.isNotFound   // false
    err.isPermission // false
    err.isTimeout    // false
  }
}
```

`get()` returns `null` on 404 instead of throwing.

### API v1 Gotchas

- **`/work-items/` does not filter by `state`, `state_group`, `priority`, `labels`, `assignees`.** These query params are silently ignored by the API. Use dedicated endpoints (`/cycles/{id}/cycle-issues/`, `/modules/{id}/module-issues/`), the search endpoint, or `listAll()` + local filter.
- **`expand=modules` is accepted but returns nothing.** Work-item endpoints never include module membership regardless of `expand` (verified against Plane 1.4.1) — an empty/missing `modules` field does **not** mean the item has no module. Client-side workaround: `client.modules.membershipMap(projectId)` + `attachModules(items, membership)`, or `--with-modules` on the CLI.
- **Project visibility (`network`) cannot be set through the API v1.** It is accepted on create and update and silently discarded (200/201 with the value unchanged), so it is not part of `CreateProjectInput`. Change it in the UI.
- **`intake_view: true` in a project POST does not provision the intake queue.** The flag is stored, but the first intake request answers 500. Re-sending the same value as a PATCH fixes it — `projects.create()` does this automatically.
- **Project names are unique per workspace** — a repeat gives `409 {"name":"The project name is already taken"}`.
- **Deleting a project cascades** to its work items, modules, cycles and intake, with no warning from the API. A cycle left behind answers `403`, not `404`, because the permission check runs against a project membership that no longer exists.
- **Pages API not available in v1.** `PagesResource` exists but is not mounted on `PlaneClient`.
- **Views API not available in v1.** No views endpoint in Plane v1.
- **Sub-issues not available in v1.** The `parent` field on WorkItem works (read/write), but `/work-items/{id}/sub-issues/` is not mounted.
- **The attachment detail GET redirects, it doesn't return JSON.** `GET .../attachments/{id}/` 302s to a presigned S3 download URL (confirmed against Plane's public source); it is not a metadata endpoint. `workItems.attachments.getDownloadUrl()` follows this with a manual redirect and returns the `Location` header — use `list()` for metadata instead.
- **`attachments.list()` returns a plain array**, not the `{ results: [...] }` shape every other list endpoint uses.
- **Rate limit is aggressive.** Allow ~3s between bulk operations.

## API Compatibility

| Component | Version |
|-----------|---------|
| Plane API | v1 (tested with Plane v1.3.0) |
| Node.js | >=20 |
| TypeScript | Any (exports `.d.ts` declarations) |

### Changelog

### 0.6.0

- Comprehensive JSDoc/TSDoc on all public exports
- README rewritten in English with badges, API compatibility table
- TypeScript library usage added to llms.txt

### 0.5.2

- Workspace is now optional — resolve via `--workspace` flag or `PLANE_WORKSPACE` env var

[Full changelog →](./CHANGELOG.md)

## License

MIT
