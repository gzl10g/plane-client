# @gzl10/plane-client

<!-- badges -->
<img src="https://img.shields.io/npm/v/@gzl10/plane-client" alt="npm version">
<img src="https://img.shields.io/npm/dm/@gzl10/plane-client" alt="npm downloads">
<img src="https://img.shields.io/npm/l/@gzl10/plane-client" alt="license">

Unofficial typed HTTP client for [Plane API](https://plane.so). Zero runtime dependencies for library usage (CLI requires `commander`). Tested with Plane **v1.4.2**.

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

// Members. `resolve()` turns a name or email into the user UUID `assignees` needs
const assignee = await client.members.resolve('ivy')          // or 'ivy@example.com', or a UUID
await client.workItems.update('project-uuid', 'work-item-uuid', { assignees: [assignee] })
const members = await client.members.list()                    // Page<WorkspaceMember>, with role + is_active

// Project membership. Keep the returned `id`: it is the membership id, and no listing returns it
const membership = await client.projectMembers.add('project-uuid', assignee, 'member')
await client.projectMembers.updateRole('project-uuid', membership.id, 'admin')
await client.projectMembers.deactivate('project-uuid', membership.id)   // one-way, see gotchas

// Invitations — the only way v1 adds a new member to a workspace (it sends no email)
await client.invitations.create({ email: 'new@example.com', role: 'member' })

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

**Credentials resolve env-first**, the same precedence workspace and project already had:

| Setting | Env var (wins) | Fallback |
|---------|----------------|----------|
| Base URL | `PLANE_BASE_URL` | `baseUrl` in `~/.planec/config.json` |
| API key | `PLANE_API_KEY` | `apiKey` in the config file |
| Workspace | `PLANE_WORKSPACE` | `workspace` in the config file, `planec workspace use` |
| Project | `PLANE_PROJECT` | `project` in the config file, `planec use` |

The config file is read from `os.homedir()`, so several agents sharing one system user share one
identity and every work item they touch is attributed to the same person; exporting `PLANE_API_KEY`
per process is what tells them apart. An empty or whitespace-only env var counts as *unset* and falls
back to the file, so `export PLANE_API_KEY="$UNSET_VAR"` cannot silently disable a working config.

`planec config show` prints the values actually in use and marks the overridden ones
(`https://…  (from PLANE_BASE_URL)`), and `planec login` warns when `PLANE_API_KEY` shadows the token
it just saved.

```bash
planec config set baseUrl https://plane.example.com
echo "$PLANE_TOKEN" | planec login --token-stdin   # keeps the token out of ps and shell history
planec workspace use YOUR_WORKSPACE_SLUG   # or use --workspace / PLANE_WORKSPACE
planec use PROJECT_UUID                    # or use -p / PLANE_PROJECT
```

Pass the token on stdin. `planec login --token <value>` still works and warns, but an argument is
readable in `ps` while the command runs, ends up in the shell history, and is echoed by any harness
that logs the command line it ran. `planec config set apiKey --stdin` does the same for the config
key, and in a script `PLANE_API_KEY` in the environment needs no `login` at all.

Config is stored in `~/.planec/config.json` (token-protected, chmod 600).

### Help & Version

```bash
planec --help         # Show global help and available commands
planec --version      # Show installed version
```

### Reports across workspaces

```bash
planec workspace add gzl10          # save the workspaces to sweep, once
planec workspace add 10labs
planec report work-items                              # everything still open
planec report work-items --status done --since 2026-08-01
planec report work-items --intake --format md         # add what is waiting untriaged
planec report work-items --workspaces gzl10 --project PCL --json | jq '.counts'
```

`report` is the one command group that is not project-scoped. The workspace list has to come from
you: the v1 API has no endpoint that lists workspaces, so "every project I can see" is not something
the client can discover — "every project in the workspaces I name" is. Pass `--workspaces`
(plural — `--workspace` is the global single-slug flag) or save them with `planec workspace add`.

Rows are grouped by `state.group`, never by the state's name, because each project renames its
states. `--intake` adds the untriaged queue as an extra block rather than filtering anything: pending
intake issues never appear in `/work-items/` to begin with.

A workspace that answers 403 is skipped, warned about on stderr, and the report comes back marked
`partial`. If *every* workspace is refused the command fails instead — all of them at once is the
signature of the wrong credential, not of your permissions, and an empty report that looks legitimate
is the worst possible answer.

### The report's JSON is camelCase

Every other `--json` in this CLI hands back Plane's payload untouched, so it is snake_case. The report
is not a Plane payload: it is an object this client assembles — the identifier rebuilt from the
project prefix, the state resolved against the project's states, the counts aggregated — so it uses
`identifier`, `stateGroup`, `createdAt`. Same shape from `buildWorkItemReport()` in the library.

### Validation the API does not do

Plane accepts a surprising amount of nonsense with a `200` and quietly drops it, so the CLI checks
these before spending a request: `--order-by` (an unknown value returns an unsorted list that looks
sorted — and there is no bare `name`), `--per-page` and `--limit` (a negative value used to make the
server answer **500**; `0` disabled pagination altogether), `--color` (a colour name was stored
verbatim and only showed up when the board rendered it), the closed enums (`--status`, `--group`,
`--priority`, relation `--type`), and a report date window that ends before it starts.

`states create` goes one step further and **requires `--group`** even though the API treats it as
optional: a state created without one is filed under `backlog` in silence, so a review state ends up
counted as backlog by every filter and report.

### Rate limiting

Plane throttles **per API key** — `API_KEY_RATE_LIMIT`, default `60/minute` — and reports the state
of your quota on every response. The client reads those headers and waits for the window to roll over
when the quota is nearly spent, instead of spending it and retrying blind; on a `429` it honours
`Retry-After` when the server sends one. An instance that emits no such headers behaves as it did
before.

```ts
const client = new PlaneClient({
  baseUrl, apiKey, workspace,
  rateLimit: { minRemaining: 1, maxWaitMs: 60_000 },   // defaults; enabled: false turns pacing off
  onThrottle: ({ waitMs, reason, remaining }) =>
    console.error(`waiting ${waitMs}ms (${reason}, ${remaining} left)`),
});
```

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Failure, or you declined a confirmation prompt |
| `2` | Bad usage: an unknown flag, a missing argument, contradictory options |
| `3` | The named resource does not exist |
| `4` | The credential is missing, was rejected, or is not allowed to do this |

Declining a prompt exits `1`, so `planec projects delete X && next-step` does not run `next-step`
after an abort. A work item that does not exist exits `3` and reports on stderr, leaving stdout
empty — `planec work-items get PROJ-999 --json | jq` fails instead of parsing a sentence. The
credential code is `4` whether Plane answered 401 or 403, because both mean the same thing to a
script: retrying will not help until the credential changes.

Every command takes `--json`, the ones whose only output is "it worked" included: those print
`{"ok": true, ...}` instead of a sentence.

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
planec work-items list --all                    # walk every page instead of the first
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

# Members and project membership
planec members list                                        # workspace members: role, active, user UUID
planec projects members list -p PCL
planec projects members add -p PCL --member ivy --role member     # accepts name, email or UUID
planec projects members set-role <membershipId> --role admin      # id comes from `add` (see notes)
planec projects members deactivate <membershipId>                 # irreversible via API, asks first
planec invitations list
planec invitations create new@example.com --role member    # writes the invite; sends NO email
planec invitations delete <invitationId> --yes

# Assign work by name instead of UUID
planec work-items create --name "Fix bug" --assignee ivy
planec work-items update PROJ-42 --assignee ivy,gonzalo    # replaces the assignee set
planec work-items update PROJ-42 --assignee ""             # clears every assignee

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
- **`--assignee` takes names, emails or UUIDs** on `work-items create`/`update` and warns on stderr when an assignee is not an active member of the project — Plane accepts such a request with **200 and an empty `assignees`**, so without the warning the write looks like it worked. The older `--assignees <uuids>` flag still takes raw UUIDs unchecked.
- **`projects members set-role` / `deactivate` take a membership id, not a user id.** API v1 only ever reveals it in the response of `add` (no listing carries it), so `add` prints it with a note. `deactivate` is Plane's `DELETE`: it deactivates rather than removes, cannot be undone through the API, and the member keeps showing in listings with `Active=NO`.
- **Destructive commands refuse to prompt when there is no terminal** (cron, CI, an agent): they fail immediately naming the flag to pass (`--yes`, or `--confirm <IDENTIFIER>` for `projects delete`) instead of waiting for an answer that cannot arrive. Before 0.18.0 they hung until Node killed them with exit 13.
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
| `members` | list, listAll, find, resolve, resolveMany |
| `projectMembers` | list, listAll, add, updateRole, deactivate |
| `invitations` | list, get, create, updateRole, delete |
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
- **Workspace roles are read-only in v1.** `/workspaces/{slug}/members/` is registered GET-only: a workspace role cannot be changed and a member cannot be removed through the API. New members come in via `invitations`.
- **The project membership id is not discoverable.** `projectMembers.updateRole()`/`deactivate()` address the row by its ProjectMember UUID, and no listing returns it — both member listings return the *user* id, and a GET with the user id answers 404. The only place it appears is the response of `projectMembers.add()`.
- **Deleting a project member deactivates it, and only one way.** Plane's `DELETE` sets `is_active = false` and answers 204, while the plain `/members/` endpoint keeps listing the member as if nothing happened. Re-adding the same user then answers `400 {"error":"The payload is not valid"}`, and `PATCH {"is_active": true}` answers 200 while changing nothing — reactivating requires the Plane UI. Use `projectMembers.list()` (backed by `/project-members-lite/`) to see the real `is_active`.
- **Assigning a non-member is accepted and dropped.** A work item written with an assignee who is not an active member of the project answers **200 with `assignees: []`**. Resolve with `members.resolve()` and check membership first.
- **Adding a project member without a role creates a guest.** The API defaults `role` to 5; `projectMembers.add()` defaults to member instead.
- **Invitations send no email and do not check membership.** v1's `create` only writes the invitation row (the UI is what notifies), and inviting an existing member answers 201.
- **The member listings disagree.** `/members/` returns a flat array that ignores `per_page` and carries no `is_active`; `/members-lite/` and `/project-members-lite/` are paginated and carry `role` + `is_active`. This client uses the `-lite` ones.
- **`attachments.list()` returns a plain array**, not the `{ results: [...] }` shape every other list endpoint uses.
- **Rate limit is aggressive.** Allow ~3s between bulk operations.

## API Compatibility

| Component | Version |
|-----------|---------|
| Plane API | v1 (verified against Plane 1.4.2; earlier resources against 1.4.1 and 1.3.0) |
| Node.js | >=20 |
| TypeScript | Any (exports `.d.ts` declarations) |

**Members and roles need Plane 1.4.1 or newer, and a workspace-admin token.** `client.members` and
`client.projectMembers` read the paginated `/members-lite/` and `/project-members-lite/` endpoints —
on an older instance those routes answer a plain 404. Plane also gates every member listing behind
workspace-admin, so a token with a lower role gets 403 on `members list`, `projects members …` and on
`--assignee` resolving a name (pass `--assignees <uuid>` instead).

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
