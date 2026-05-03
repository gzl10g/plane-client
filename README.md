# @gzl10/plane-client

Cliente HTTP tipado **no oficial** para la API de [Plane](https://plane.so). Zero runtime dependencies. Testeado con Plane **v1.3.0**.

## Installation

```bash
pnpm add @gzl10/plane-client
```

## CLI

`planec` is a command-line tool for managing Plane work items, cycles, modules, and more. Persistent config, JSON output for scripting.

### Setup

```bash
planec config set baseUrl https://plane.example.com
planec login --apiKey pk_...
planec workspace use my-workspace
planec project use PROJECT-KEY
```

### Quick Start

```bash
# List work items in a project
planec work-items list

# Get a specific work item
planec work-items get PREFIX-42

# Create a cycle
planec cycles create --name "Sprint 5" --startDate 2026-05-01 --endDate 2026-05-15

# Output as JSON for machine consumption
planec cycles list --json | jq '.items | length'
```

See `llms.txt` for a complete command reference optimized for AI agents.

## Usage

```typescript
import { PlaneClient } from '@gzl10/plane-client'

const client = new PlaneClient({
  baseUrl: 'https://plane.example.com',
  apiKey: 'pk_...',
  workspace: 'my-workspace',
})

// Work items
const page = await client.workItems.list('project-uuid', { priority: 'high' })
const item = await client.workItems.get('project-uuid', 'PREFIX-42')
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
| `modules` | list, get, update, workItems, addWorkItems |
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

