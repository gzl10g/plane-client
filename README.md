# @gzl10/plane-client

Cliente HTTP tipado **no oficial** para la API de [Plane](https://plane.so). Zero runtime dependencies para uso como librería (el CLI requiere `commander`). Testeado con Plane **v1.3.0**.

## Installation

```bash
pnpm add @gzl10/plane-client
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

## CLI

The package includes a CLI tool `planec` for interacting with Plane from the command line.

### Installation

```bash
npm install -g @gzl10/plane-client
```

### Configuration

```bash
planec config set baseUrl https://plane.example.com
planec login --token YOUR_API_KEY
planec workspace use YOUR_WORKSPACE_SLUG
planec use PROJECT_UUID          # set active project
```

Config is stored in `~/.planec/config.json` (token-protected, chmod 600).

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

# Override project per command
planec work-items list --project <uuid>
# or via env var
PLANE_PROJECT=<uuid> planec work-items list
```

## Usage

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

## Resources

| Resource | Methods |
|----------|---------|
| `workItems` | list, get, search, create, update, listAll |
| `workItems.comments` | list, create |
| `workItems.links` | create |
| `workItems.relations` | list, create |
| `states` | list |
| `labels` | list, create |
| `modules` | list, get, create, update, workItems, addWorkItems, removeWorkItem |
| `cycles` | list, get, create, update, archive, workItems, addWorkItems, removeWorkItem, transfer |
| `intake` | list, create, accept, decline |

## Config

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
  onRequest?: (req) => void,   // Debug hook
  onResponse?: (res) => void,  // Observability hook
})
```

## Errors

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
  }
}
```

`get()` returns `null` on 404 instead of throwing.

## Funding

<a href="https://www.buymeacoffee.com/gzl10g" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 52px !important;width: 190px !important;" ></a>

