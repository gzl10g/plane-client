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

// Cycles
const cycles = await client.cycles.list('project-uuid')
await client.cycles.create('project-uuid', { name: 'Sprint 1', start_date: '2026-04-01' })

// Modules, states, labels, intake
const states = await client.states.list('project-uuid')
const modules = await client.modules.list('project-uuid')
await client.intake.create('project-uuid', { name: 'Bug report' })
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

Workspace and project can be omitted from config and passed per-command instead:

```bash
# Via flag (workspace is a global flag before the subcommand)
planec --workspace my-slug work-items list -p <project-uuid>

# Via environment variables
PLANE_WORKSPACE=my-slug PLANE_PROJECT=<uuid> planec work-items list
```

### Usage

```bash
# Work items
planec work-items list
planec work-items get PROJ-42
planec work-items search "query" --workspace-search
planec work-items create --name "Fix bug" --priority high
planec work-items update <uuid> --state <stateUuid>

# Comments, links, relations
planec work-items comments list <workItemId>
planec work-items comments create <workItemId> --comment-html "<p>text</p>"
planec work-items links create <workItemId> --url https://...
planec work-items relations create <workItemId> --type blocking --issues <uuid>

# Cycles
planec cycles list
planec cycles create --name "Sprint 1" --start-date 2026-01-01 --end-date 2026-01-14
planec cycles add-work-items <cycleId> --work-items uuid1,uuid2
planec cycles transfer <fromId> --to <toId>

# Modules, states, labels, intake
planec modules list
planec states list
planec labels list
planec intake list
planec intake accept <id>

# JSON output (for piping with jq)
planec --json work-items list | jq '.items[].name'

# Override workspace and project per command
planec --workspace my-slug work-items list -p <uuid>
# or via env vars
PLANE_WORKSPACE=my-slug PLANE_PROJECT=<uuid> planec work-items list
```

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
| `states` | list |
| `labels` | list, create |
| `modules` | list, get, create, update, workItems, workItemsAll, addWorkItems, removeWorkItem |
| `cycles` | list, get, create, update, archive, workItems, workItemsAll, addWorkItems, removeWorkItem, transfer |
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
- **Pages API not available in v1.** `PagesResource` exists but is not mounted on `PlaneClient`.
- **Views API not available in v1.** No views endpoint in Plane v1.
- **Sub-issues not available in v1.** The `parent` field on WorkItem works (read/write), but `/work-items/{id}/sub-issues/` is not mounted.
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
