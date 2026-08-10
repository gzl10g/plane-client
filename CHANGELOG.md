# Changelog

## 0.10.0

Verified against Plane 1.4.1.

- feat: list flags now accept readable identifiers, like the positional arguments already did — `relations create --issues PROJ-43,PROJ-44`, `modules|cycles add-work-items --work-items PROJ-42,PROJ-43`. Previously a `PROJ-N` there was rejected by the API with an opaque `400 Please provide valid detail`.
- feat: those same flags are variadic, so `--issues a b` no longer keeps only the first entry and silently drops the rest. Both comma- and space-separated forms work.
- feat: `--description-html-file <path>` on `work-items create`, `work-items update` and `intake create`, for descriptions too large to pass inline (~100 KB of HTML hits the argv limit and dies with `E2BIG` before reaching Plane). Passing both the inline flag and the file errors instead of silently picking one.
- fix: a work item identifier that belongs to another project is now rejected with an explicit error naming both projects. The identifier lookup is workspace-level while the write endpoints are project-scoped, so a wrong `-p` (or a stale `planec use`) previously answered 200, wrote nothing, and exited 0.
- fix: commands returning a list of objects without a table layout printed `[object Object]` — a success that reads as a failure, most visibly on `relations create`. They now print JSON.
- fix: the "no project specified" message named a `PLANEC_PROJECT` env var that was never read; the variable is `PLANE_PROJECT`.
- test: CLI handler tests no longer read the developer's real `~/.planec/config.json`, which made the "missing project" cases pass in CI and fail locally.

## 0.9.0

- feat: `work-items create --module <uuid>` assigns the new work item to a module in a single command (previously required a separate `modules add-work-items` call).
- feat: `work-items update` and related commands (`get-by-id`, `activities`, `comments`, `links`, `relations`, and `modules`/`cycles remove-work-item`) now accept a readable identifier (`PROJ-42`) in addition to the internal UUID — the id is resolved automatically.
- feat: `modules delete <id>` and `cycles delete <id>` remove a module/cycle. Prompts for confirmation unless `--yes` is passed.
- fix: `remove-work-item` no longer reports success unless the API confirmed the removal; a missing project now errors clearly instead of silently operating on the wrong context.
- fix: permission errors print a hint distinguishing 401 (not authenticated — log in) from 403 (authenticated but no permission — key may be read-only or the resource belongs to another user).
- refactor: project resolution is unified and validates the UUID across all commands; an invalid project id now fails clearly instead of silently returning an empty list.

## 0.8.0

- fix: `--json` output is no longer truncated when piped to another process (e.g. `| jq`, `| python`). `runHandler` now sets `process.exitCode` instead of calling `process.exit()`, so Node drains stdout before exiting. Affected all list/get commands with large payloads (dense `description_html`).
- fix: `work-items get` and `get-by-id` now expand `state` and `modules`, so `state_detail` is populated (previously `name`/`group` came back `null`) and `module_ids` are included. `work-items list --expand` is now actually forwarded — it was silently ignored before.
- fix: `intake accept` and `intake decline` no longer return 404. The intake record id shown by `intake list` is now resolved to its underlying work-item id before the PATCH (the endpoint is keyed by work-item id). Accepts either id.
- feat: list commands (`work-items`, `modules`, `cycles`, `states`, `labels`, `intake`) print the resolved context (`workspace`, `project`) to **stderr** when a listing comes back empty, so silent empties caused by wrong-context are diagnosable (stdout stays clean for pipes).

## 0.7.0

- fix!: update `RelationsMap` to match Plane v1.3.1 response shape — values are now `RelationTarget[]` (`{ project_id, issue_id }`) instead of `string[]` (BREAKING)
- feat: export new `RelationTarget` type

## 0.6.2

- docs: add --help and --version CLI documentation to README
- fix(ci): use node:22-alpine for pnpm@latest compatibility
- feat: add comprehensive JSDoc/TSDoc to all public exports (PlaneClient, PlaneApiError, all resources, all types)
- docs: rewrite README in English with badges, changelog section, API compatibility table, English-only CHANGELOG
- docs: add TypeScript library usage section to llms.txt (golden path, Page<T> format, PagesResource status)
- docs: clarify PagesResource as "not yet mounted" in README

## 0.5.2

- feat: workspace is now optional — resolve via `--workspace <slug>` global flag or `PLANE_WORKSPACE` env var (same priority pattern as project)
- docs: update README, llms.txt and CLI help with workspace context resolution order

## 0.5.1

- fix: correct CLI flag examples in README (`--token`, `--start-date`, `planec use`)
- docs: restructure README with "Using with AI agents" section matching semaphore-client style
- docs: clarify zero-deps applies to library only (CLI requires `commander`)

## 0.5.0

- feat: add `planec` CLI binary with full API coverage (work-items, cycles, modules, states, labels, intake)
- feat: persistent config in `~/.planec/config.json`
- feat: `--json` flag for machine-readable output (pipe to jq)
- feat: `llms.txt` reference for AI agents

## 0.4.0

### Breaking

- `workItems.list()` no longer accepts `stateGroup`, `priority`, `assignee`, `label` — Plane API v1 silently ignores these query filters. New signature: `orderBy`, `fields`, `expand`, `externalId`, `externalSource`.
- `workItems.get(identifier)` drops the `projectId` argument — the identifier already carries the project prefix (`PRUEBA-207`). Now hits the real `/work-items/{ident}/` endpoint and fixes a bug where it silently returned `null` when the match fell outside page 1.
- `workItems.search()` signature changed: `{ query, limit?, workspaceSearch?, projectId? }`. Uses workspace-level `/work-items/search/` and returns `WorkItemSearchResult[]` (not `Page<WorkItem>`).
- `cycles.workItems()` and `modules.workItems()` return `Page<WorkItem>` instead of `WorkItem[]`.

### Features

- `workItems.getById(projectId, uuid)` — direct UUID lookup.
- `workItems.comments.update()` and `workItems.comments.delete()`.
- `workItems.activities.list(projectId, workItemId, options?)` — paginated activity log.
- `cycles.workItemsAll()` and `modules.workItemsAll()` — `AsyncIterable<WorkItem>` for full iteration.

## 0.3.1

- feat: add `estimate_point`, `type`, and `module` fields to WorkItem, CreateWorkItemInput and UpdateWorkItemInput

## 0.3.0

- feat: soporte completo relations API (Plane v1.3.0)
- feat: ESLint 10 + typescript-eslint flat config

## 0.2.2

- fix: mocks unitarios reflejan formato real API + tests addWorkItems

## 0.2.1

- fix: addWorkItems body field `work_items` → `issues` en modules y cycles
- fix: build output iba a `dist/src/` en vez de `dist/`

## 0.2.0

- fix: corregir endpoints API y alinear con convención #1076
- feat: tests de integración contra Plane real

## 0.1.1

- ci: dual publish a Verdaccio y npmjs
- fix: test script usa `dist/tests/` en vez de glob

## 0.1.0

- feat: core — PlaneClient con retry/hooks, PlaneApiError
- feat: resources — WorkItems, Modules, Cycles, States, Labels, Intake
- ci: pipeline tag-triggered con typecheck, test y publish
