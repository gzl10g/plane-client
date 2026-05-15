# Changelog

## 0.6.1

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
