# Changelog

## 0.19.0

Verified live against Plane 1.4.2.

### Added

- **`planec report work-items` — pending and completed work across every project of several workspaces, in one command.** Until now that meant walking in project by project. `--status open|done|all`, `--group`, `--project`, `--assignee`, `--since`/`--until`, `--intake` (adds what is waiting untriaged), `--intake-only` and `--format table|json|csv|md`. Save the workspaces to sweep with `planec workspace add <slug>` — that list has to come from you, because the v1 API has no endpoint that lists workspaces. Measured at 10 requests for 741 work items.
- `planec workspace add|remove|list` manages that sweep list. The active workspace is still `planec workspace use`.
- **The client paces itself against the rate limit instead of discovering it by crashing into it.** Plane reports your quota on every response (`x-ratelimit-remaining`, `x-ratelimit-reset`) and throttles per API key, at `60/minute` by default — enough that one report-sized sweep can spend it. The client waits for the window to roll over when the quota is nearly gone, and honours `Retry-After` on a 429 rather than applying a backoff unrelated to the server's window. An instance that sends no such headers behaves exactly as before. Tune it with `rateLimit: { enabled, minRemaining, maxWaitMs }` and watch it with `onThrottle`.
- `planec login --token-stdin` reads the token from stdin, and `planec config set apiKey --stdin` does the same for the config key: `echo "$TOKEN" | planec login --token-stdin`. An argument is readable in `ps` while the command runs, lands in the shell history and is echoed by any harness that logs its command line — the same reasoning behind `docker login --password-stdin` and `gh auth login --with-token`.
- `--all` on `work-items list` and `intake list`, to fetch every page.
- **`planec work-items delete`** — the API has always supported it (204); the client did not, so you
  could cascade-delete an entire project but not remove one work item. Asks before deleting.
- **`planec work-items links list|update|delete`** — only `create` existed, which left a link you
  created through the CLI invisible and unremovable from it. `update` merges, so changing the title
  does not wipe the URL.
- **`planec states get|create|update|delete` and `planec labels get|update|delete`** — both resources
  were read-only-ish while the API served all four verbs. That is why test projects accumulate
  throwaway labels nothing can clear. `states create` requires `--group`: Plane files a state without
  one under `backlog` in silence, so a review state ends up counted as backlog everywhere.
- **Flags are validated before the request** wherever the API would ignore them or punish them:
  `--order-by` (an unknown value comes back unsorted but looks sorted, and there is no bare `name`),
  `--per-page`/`--limit` (`-5` made the server answer **500**; `0` disabled pagination and returned
  the whole project), `--color` as a hex colour, the closed enums, and a report window that ends
  before it starts.
- Library: `buildWorkItemReport(clients, options)` for the same report from code; `createRateLimitState()` for the quota several clients share; `stateId()`, `stateName()` and `isExpandedState()` for the `state` union below; `listPage()` and `listAll()` on `client.states`, `client.labels`, `client.cycles` and `client.modules`, plus `client.intake.listAll()`.

### Fixed

- **Declining a confirmation prompt exited 0.** `planec projects delete X && echo deleted` printed "deleted" without deleting anything, and the same held for `modules delete`, `cycles delete`, `projects update --identifier`, `projects members deactivate` and `invitations delete`. An abort exits `1` now.
- **`work-items get` on a work item that does not exist printed to stdout and exited 0.** With `--json` the output was not JSON either, so `| jq` blew up with nothing to catch and `planec work-items get PROJ-999 && next-step` ran `next-step`. It reports on stderr, leaves stdout empty and exits `3`. Same for `get-by-id`.
- **`--json` was accepted and silently ignored by around twenty commands.** `planec config show --json` printed prose; so did `login`, `use`, `workspace use`, `config set`, `projects delete`, `cycles archive|transfer|add-work-items|remove-work-item|delete`, `modules add-work-items|remove-work-item|delete`, `comments delete`, `attachments delete`, `intake accept|decline`, `projects members deactivate` and `invitations delete`. A flag that is taken and does nothing gives a script no error to notice. They all emit JSON now — `{"ok": true, …}` for the ones whose only result is that it worked — and `config show --json` reports where each value came from.
- **`work-items list` printed `[object Object]` in the State column**, and `work-items get` printed `state: [object Object]`. Every read asks for `expand=state`, which returns the whole state object, so both views stringified an object. The tables show the state name (`work-items list`, `cycles work-items`, `modules work-items`), and so does the single-item view; anything else nested is serialised rather than flattened to `[object Object]`, which also fixes `assignees`, `labels` and `modules`. `--json` still carries the raw objects.
- **Listings were cut short in silence.** `work-items list` and `intake list` returned the first page with no hint that more existed; `states list`, `labels list`, `cycles list` and `modules list` dropped the cursor entirely, which also narrowed `--with-modules` to whatever modules fitted on one page. The four small listings walk every page now, and the two big ones warn on stderr (`Showing the first N of M …`), with `--all` to fetch the rest.
- **`intake.listAll()` would have looped for ever**, following the `next_cursor` that Plane returns on the last page too. It was the one listing still carrying the bug fixed everywhere else in 0.18.0.
- **`planec intake accept` said "Intake accepted" over a queue that never moved.** The cause was the id, below: it patched the wrong record. `accept` and `decline` now also verify the status that comes back against the one they asked for, and fail rather than report a success they cannot back up — cheap insurance against a write being dropped server-side.
- **`intake accept|decline` could also target the wrong record entirely.** Resolving the work item id looked at one page of the queue — asking for `per_page`, which is exactly what switches pagination on — so on a queue past 100 items the rest were invisible and the request went to the intake record id instead, which answers 404. It walks the whole queue now, at the same one-request cost in the common case.
- **Tables were measured in code points rather than terminal columns**, so they broke in both directions: a name in Japanese draws twice as wide as it counts and overflowed its column without ever tripping the truncation, while a ZWJ emoji counts as seven code points and draws as two, leaving its row short. Clipping also cut through grapheme clusters and left a dangling joiner. Widths are measured in columns now and clipped on whole graphemes, and a newline in a name no longer splits the row in two.
- **`report --intake-only` accepted `--status` and `--group` and ignored them**, returning the same rows either way — the silent-filter behaviour this client exists to catch Plane doing. It refuses them and says why: an item awaiting triage has no workflow state. `--format csv --json` is likewise refused rather than quietly resolving in favour of one.
- Flags are validated before the project is resolved. `--per-page` already was and `--order-by` was not, so the same typo failed differently depending on which flag you got wrong, and spent a project listing to blame the project.
- **`cycles transfer` had never worked.** It posted to `/transfer/`, a route that answers `404 Page not found`; the real one is `/transfer-issues/`.
- **The State column showed a raw UUID in `cycles work-items` and `modules work-items`.** Those endpoints return `state` as a bare id rather than the expanded object, so the fix that covered `work-items list` never reached them.
- **The ID column could not be pasted back into the CLI.** It printed `693`, and `work-items get 693` rejects that — it wants `PRUEBA-693`. Every work-item table now prints the full identifier, `search` included.
- **`comments list` was unreadable**: an id and an ISO date cut off at the character that tells two comments apart, with no author and no text. It shows the date, the author and the comment body now. `--with-comments` also does something in the human view, where it had been a no-op that only worked under `--json`.
- **`config show` reported the wrong source for the workspace.** With `--workspace X` it claimed `(from PLANE_WORKSPACE)` while that variable was unset, because the flag was forwarded by writing it. It names the flag now — this being the first command anyone runs to work out why a request went somewhere unexpected.
- **`cycles get` and `modules get` threw on a missing resource** instead of returning `null` like every other `get()`, so the CLI printed the API's raw 404 body. And the not-found exit code now covers every command, sub-resources included.
- **An empty `update` still issued the PATCH**, and Plane answers 200 while moving `updated_at`/`updated_by` — rewriting the audit trail of a work item, cycle or module nobody changed. All three refuse locally now.
- **`attachments upload` failed unless you passed `--type`.** Without it Plane answered `400 Invalid file type`, so the obvious form of the command never worked; the MIME type is inferred from the extension, and an unknown extension asks rather than guessing.
- **`projects delete` could show a blast radius of zero over real content.** With the intake queue disabled the listing comes back empty rather than failing, so the inventory reported `intake: 0` for a queue holding items. It says the count cannot be read instead — the inventory is the only thing holding up that confirmation.
- A work item reference is normalised before use: `prueba-805`, or a value pasted with stray spaces, now works where the API answered 403 for both.
- **Dates were shown a day off, in both directions.** A cycle created with `--end-date 2027-03-15` read as 2027-03-16 in Madrid, and its start slipped to the previous day in Los Angeles; module dates drifted the other way west of Greenwich. The two resources name the field the same and store different things — a module keeps `2027-03-01`, a cycle keeps a timestamp anchored to that day — so one formatter for both was exactly the mistake. Verified across six time zones, from Kiritimati to Midway. Comment and activity timestamps stay in local time, because those really are moments rather than days.
- **Comment listings were not paginated**, the only listing left out of the 0.18.0 fix. Beyond a short list, the count `work-items get` prints (`N comment(s) on PROJ-42`) could be smaller than the truth — a number asserted on an incomplete read.
- **Assignments that Plane accepted and discarded now say so.** The API answers `200` with `assignees: []` for someone who is not an active member, and the check that warned about it ran only for `--assignee`, never for `--assignees`, and stood down entirely when it could not read the membership. The response is now compared against what was asked for.
- **`work-items create --module` lost the work item's id** when the module association failed: the item existed in Plane, the error did not mention it, and the id was never printed — so the natural move was to run the command again and end up with a duplicate. It prints the created item and tells you not to re-run.
- **Deleting now asks, everywhere it should.** `work-items delete`, `comments delete`, `links delete`, `attachments delete` and `intake decline` joined `modules`, `cycles`, `states` and `projects` in confirming first; all take `--yes`. `labels delete` deliberately does not: a label holds nothing, and throwaway labels piling up with no way to clear them was the problem.
- **The credential hint was backwards.** Plane answers **403** for an invalid API key, not 401, and the CLI always sends the configured key — so the unreachable 401 branch held the "your key is wrong" advice while every bad-credential case read the permissions hint and went looking in the wrong place.
- **A work item added to a second cycle is removed from the first**, silently, because Plane allows only one. The command says so. Relating a work item to itself is refused outright: the API accepts it, and v1 offers no way to delete a relation afterwards.
- **`intake accept`, `decline` and the attachment commands accept either intake id.** The queue prints the record id, but the write endpoints only take the issue id and answer 404 for the other — so the only id you could see was the one that did not work. All three resolve either.

### Notes on the API

- **Concurrent writes to one work item lose data, and nothing in the API can prevent it.** Two
  `update` calls on the same work item both return `200` — each confirming its own field — and one
  change is silently discarded; It is reproducible but not deterministic: most of a handful of paired runs lost a field, some came through clean. Plane offers no
  `version`, `ETag` or `Last-Modified` to guard with. Serialise writes per work item, and re-read if
  the value matters: a write's own response echoes what you asked for whether or not it survived.

### Changed / Breaking

- **Exit codes carry meaning now.** `0` success, `1` failure or a declined prompt, `2` bad usage (unknown flag, missing argument, contradictory options), `3` resource not found, `4` credential rejected or not allowed — 401 and 403 alike, because to a script they mean the same thing: retrying will not help until the credential changes. If you relied on an abort or a missing work item exiting 0, that is the break.
- **`planec login --token <value>` is deprecated.** It still works, and now warns on stderr. Move to `--token-stdin`, or to `PLANE_API_KEY` in the environment, which needs no `login` at all.
- **TypeScript: `WorkItem.state` is `string | State`.** It was declared `string`, which is what let the `[object Object]` bug type-check: the field is the full object whenever the request expands it, and every read this CLI does expands it. Migration is one call — `stateId(item.state)` for the id, `stateName(item.state)` for the name, both newly exported.
- `states.list()`, `labels.list()`, `cycles.list()` and `modules.list()` may issue more than one request, because they return everything rather than one page. They still return `T[]`.
- **Values that used to be accepted in silence now fail with exit `2`.** `--per-page 0` returned the whole project — a deliberate way to fetch everything before `--all` existed — and `--per-page abc` and `--order-by name` were taken and ignored. They are rejected before the request now, as is `report --intake-only` combined with `--status`/`--group`.
- **Three commands that deleted without asking now require a terminal or `--yes`.** `comments delete`, `attachments delete` and `intake decline` confirm like every other destructive command, so a script that called them unattended now stops with `Refusing to prompt`. Pass `--yes`.

## 0.18.0

Verified live against Plane 1.4.1, writes included (members added, roles changed, memberships deactivated, invitations created and revoked on a real instance).

### Added

- You can assign work by name instead of by UUID: `planec work-items create|update --assignee ivy` (a display name, an email or a UUID). It warns on stderr when the person is not an active member of the project, because Plane accepts that request with **200 and an empty `assignees`** — the write looks like it worked and nothing was assigned. `--assignee ""` clears every assignee.
- `planec members list` shows who is in the workspace, with their role and whether they are still active.
- `planec projects members list|add|set-role|deactivate` manages who belongs to a project. `add` defaults to the **member** role — the API itself defaults to guest, which is rarely what you meant.
- `planec invitations list|create|set-role|delete` brings new people into a workspace. Note the v1 API writes the invitation but **does not send the email** the Plane UI sends, and does not check whether the address is already a member.
- Library: `client.members` (`list`, `listAll`, `find`, `resolve`, `resolveMany`), `client.projectMembers` (`list`, `listAll`, `add`, `updateRole`, `deactivate`) and `client.invitations` (`list`, `get`, `create`, `updateRole`, `delete`), plus the `Role` constants and `parseRole`/`roleName`. `members.resolve("ivy")` is the piece the API gives you no shortcut for: turning a name into the user id that `assignees` needs.

### Fixed

- `listAll()` never finished. On work items, cycles and modules it kept asking for more pages for ever, burning through the rate limit until the API answered 429 — the API returns a `next_cursor` **on the last page too**, and the iterator followed it. This also affected `--with-modules`, which walks every module in the project. If a script of yours ever seemed to hang against a large project, this was why.
- Destructive commands hung instead of failing when there was no terminal. `planec modules delete`, `cycles delete`, `projects delete`, `projects members deactivate` and `invitations delete` waited for an answer that could never arrive from a cron job or an agent, and were eventually killed with exit 13. They now fail immediately and name the flag to pass — see *Changed* below, because this also ends one way of scripting them.

### Changed

- **`echo y | planec modules delete …` no longer works.** Piping the answer into a confirmation prompt used to confirm it; now any invocation without a real terminal is refused with `Refusing to prompt: stdin is not a terminal`. Auto-confirming a deletion from a pipe is not something this CLI should keep doing quietly. Replace it with `--yes`, or with `--confirm <IDENTIFIER>` for `projects delete` (which never takes a bare `--yes`). Affects `modules delete`, `cycles delete`, `projects delete`, `projects update --identifier`, `projects members deactivate` and `invitations delete`.
- The member commands (`members list`, `projects members …`, and `--assignee` resolving a name) need a token with the **admin role in the workspace**: Plane gates the member listings behind workspace-admin. With a lower role they answer 403; `--assignee` now says so and points at `--assignees <uuid>` instead of surfacing a bare permission error.

## 0.17.0

### Added

- `PLANE_BASE_URL` and `PLANE_API_KEY` are honoured, with the environment winning over `~/.planec/config.json` — the same precedence `PLANE_WORKSPACE` and `PLANE_PROJECT` already had. Until now credentials came *only* from the config file, resolved through `os.homedir()`: on a machine where several agents share one system user, that means one identity for all of them and every work item attributed to the same person, with no way to override it per process. The config file stays as the fallback, so nothing changes for a single-user setup.

### Fixed

- An empty or whitespace-only environment variable no longer counts as an override. Every layer was read with `??`, which falls back only on `undefined`, so `export PLANE_API_KEY="$UNSET_VAR"`, `docker run -e PLANE_API_KEY` with no value, or a `.env` line ending in `=` produced an empty string that beat a perfectly valid config file and took the CLI down with "apiKey not configured" on a setup that worked the day before. Applies to all four settings.
- `planec config show` printed the config file alone, so with an override in play it confidently reported values no request was using — on the first command anyone runs to work out why a request went to the wrong instance. It now shows the effective values and marks the source (`https://…  (from PLANE_BASE_URL)`).
- `planec login --token` warns on stderr when `PLANE_API_KEY` shadows the token it just saved. Being told "Token saved successfully" while the environment keeps overriding it is the exact trap of a multi-agent machine.
- The two "not configured" errors now name the environment variable alongside the command.

### Internal

- Test isolation of the environment covered only two of the four variables, so one case still failed in precisely the shell its comment claimed to guard against. It now covers all four, suite-wide.

## 0.16.0

### Added

- `-p/--project` accepts the human-readable identifier (`-p PCL`), not just a UUID, on every command. Until now only `projects get|update|delete` did, so the prefix you can read off `projects list` had to be translated by hand. `PLANE_PROJECT` and `planec use PCL` take one too — `use` resolves it and stores the UUID, so the saved config never pays the lookup twice. A UUID resolves with no request at all; an identifier costs a project listing.

### Fixed

- `work-items search` was not resolving its project at all. It read the flag directly, so `-p PCL` sent `project_id=PCL` to the API, and `PLANE_PROJECT` was ignored outright, silently widening the search to the whole workspace. It resolves like every other command now, while keeping the project genuinely optional for a workspace-wide search: a project that *was* set has to resolve, so a bad `-p` fails instead of quietly searching everything.
- The identifier guard rejected valid prefixes. Checked against the API: `10TEST` (leading digit) and `A_B` (underscore) are accepted by Plane, `A-B` is not (`Project identifier cannot contain special characters`). A UUID with its dashes stripped now says so instead of being hunted for as a project.
- `intake list` printed an empty Name and a raw `-2` status, which reads as a failed call. The list endpoint carries the work item title inside `issue_detail`, not at the root — the table flattens it and labels the status (`pending (-2)`, `declined (-1)`, `snoozed (0)`, `accepted (1)`, `duplicate (2)`), keeping the numeric code alongside so a new or relabelled code shows up instead of being mistranslated. `--json` still returns the raw API objects.

### Internal

- Two ESLint errors that shipped in 0.13.0 and had been left untouched since.
- The identifier lookup and its shape check live once in `cli/shared.ts`, shared by `-p`, `planec use` and the `projects` subcommands. The old UUID-only pair is gone: it had no callers left, kept a third copy of the UUID regex alive, and its error message pointed users the wrong way.

## 0.15.0

Verified live against Plane 1.4.1 (project CRUD created, updated and deleted on a real instance).

### Added

- Full project CRUD: `planec projects get|create|update|delete`, all accepting a UUID **or** the human-readable identifier (`PCL`). Library: `projects.get()` (null on 404), `create()`, `update()`, `delete()`, plus `CreateProjectInput`/`UpdateProjectInput`.
- `projects create` defaults to work items, modules, intake and views enabled, with cycles and pages disabled. Override with `--cycles`, `--pages`, `--no-modules`, `--no-intake`, `--no-views`.
- `projects delete` will not take a bare `--yes`. It prints what the deletion cascades to (work items, modules, cycles, intake), then requires the project identifier to be typed back — or passed as `--confirm <identifier>` for non-interactive use. `--dry-run` reports the blast radius and exits. A count that fails (a disabled feature answers an error, not an empty list) degrades to `?` rather than blocking the command.
- `projects update --identifier` prompts before renaming the prefix, unless `--yes`. It rewrites every `PROJ-42` reference already pasted into comments, MRs and docs — not a cosmetic field.

### Fixed

- Creating a project with the intake queue enabled left the queue unprovisioned: the flag was stored, but the first intake request answered **500**. `create()` now sends the feature toggles as a follow-up PATCH instead of in the POST body, which is the difference between the toggles being cosmetic and working. Costs one extra request.

### Notes on the API

- `network` (project visibility) is accepted and **silently discarded** by the v1 API on both create and update, so it is not part of the input types; `projects create` says so on stderr. Change it in the Plane UI.
- Project names are unique per workspace (`409 {"name":"The project name is already taken"}`).
- `DELETE` cascades through a project's contents with no warning and no refusal.

## 0.14.0

Verified live against Plane 1.4.1.

### Added

- `planec projects list [--per-page <n>] [--json]` — the CLI had no way to discover a project UUID, so every other command required knowing it in advance. Table output is identifier / name / uuid; `--json` prints the raw project objects.
- Library: `client.projects` with `list()` returning `Page<Project>` and `listAll()` iterating every page, plus the exported `Project` type. Workspace-level, so it takes no project id: this is the resource that *resolves* one.

### Fixed

- Pagination stops on `next_page_results`, not on `next_cursor` being present. The endpoint returns a cursor even on the last page, which would leave `listAll()` looping on it for ever. `projects list` walks every page rather than silently returning the API's first 20.

### Notes on the API

- ⚠️ **This entry originally claimed the auth header is case-sensitive on the wire. That was wrong**, and it is corrected here rather than left to mislead: verified against 1.4.2 on 2026-08-27, `X-API-Key`, `X-Api-Key` and `x-api-key` all answer 200. The 403 that prompted the claim had another cause. The client still sends `X-API-Key`, which remains the canonical spelling.

## 0.13.0

### Added

- File attachments on work items: `planec work-items attachments list|upload|download-url|delete`. `upload` drives the full presigned-URL flow in one call — request the S3 credentials, POST the file to storage, confirm the upload. Also works on intake work items, which are regular issues underneath: resolve to the underlying `issue` id first, then use the same commands. Library: `workItems.attachments`.

### Fixed

- `RequestOptions` gains `redirect?: "follow" | "manual"`. The attachment detail endpoint 302-redirects to a presigned download URL instead of returning JSON metadata, and there was no way to capture the `Location` header without following it into a binary response.

### Notes on the API

- This was verified against Plane's public source, **not** against a live instance — no integration credentials were available at the time. The source is what revealed that the detail GET is a redirect and that `list` returns a plain array rather than the usual paginated shape.

## 0.12.0

Verified against Plane 1.4.1.

### Added

- `work-items get`/`get-by-id` always check the work item's comments and print a stderr hint (`N comment(s) on <id> — …`) when any exist, plus `--with-comments` to attach the bodies to the output. Comments are a separate resource the item response never surfaces — not even a count — so context, corrections, or a "this no longer applies because…" living only in a comment used to go unread. Unlike `--with-modules` this costs one extra request, not N+1, so the check is on by default and only the bodies are opt-in. It degrades gracefully: a failure warns on stderr and still prints the work item.

## 0.11.0

Verified against Plane 1.4.1.

### Added

- `--with-modules` on `work-items list`/`get`/`get-by-id`, and `modules.membershipMap(projectId)` / `attachModules(items, membership)` in the library. It is a client-side workaround for a v1 limitation: `expand=modules` on work-item endpoints is accepted but the key is never populated, whatever modules the work item actually belongs to — an empty or missing field does **not** mean "no module". The workaround walks every module in the project and cross-references membership (1 + N requests), so it is opt-in rather than the default.

### Fixed

- The 0.8.0 entry and the README claimed `work-items get`/`get-by-id` returned `module_ids` once `expand=state,modules` was requested. Re-verified against live Plane 1.4.1: that was never true — the API silently drops `modules` from the payload. `expand=state` is the part that works. Docs corrected; `--with-modules` above is the real fix.

## 0.10.0

Verified against Plane 1.4.1.

### Added

- List flags accept readable identifiers, like the positional arguments already did: `relations create --issues PROJ-43,PROJ-44`, `modules|cycles add-work-items --work-items PROJ-42,PROJ-43`. A `PROJ-N` there used to be rejected by the API with an opaque `400 Please provide valid detail`.
- Those same flags are variadic, so `--issues a b` no longer keeps only the first entry and drops the rest. Comma- and space-separated forms both work.
- `--description-html-file <path>` on `work-items create`, `work-items update` and `intake create`, for descriptions too large to pass inline — around 100 KB of HTML hits the argv limit and dies with `E2BIG` before reaching Plane. Passing both the inline flag and the file errors instead of silently picking one.

### Fixed

- A work item identifier belonging to another project is rejected with an explicit error naming both projects. The identifier lookup is workspace-level while the write endpoints are project-scoped, so a wrong `-p` (or a stale `planec use`) used to answer 200, write nothing, and exit 0.
- Commands returning a list of objects with no table layout printed `[object Object]` — a success that reads as a failure, most visibly on `relations create`. They print JSON now.
- The "no project specified" message named a `PLANEC_PROJECT` variable that was never read. It is `PLANE_PROJECT`.

### Internal

- CLI handler tests no longer read the developer's real `~/.planec/config.json`, which made the "missing project" cases pass in CI and fail locally.

## 0.9.0

### Added

- `work-items create --module <uuid>` assigns the new work item to a module in one command, instead of a separate `modules add-work-items` call afterwards.
- `work-items update` and friends (`get-by-id`, `activities`, `comments`, `links`, `relations`, and `modules`/`cycles remove-work-item`) accept a readable identifier (`PROJ-42`) as well as the internal UUID; it is resolved for you.
- `modules delete <id>` and `cycles delete <id>`. Both prompt for confirmation unless `--yes` is passed.

### Fixed

- `remove-work-item` reported success without the API having confirmed the removal, and a missing project operated on the wrong context in silence. Both now fail clearly.
- Permission errors print a hint that tells 401 apart from 403: not authenticated (log in) versus authenticated without permission (a read-only key, or a resource belonging to someone else).
- An invalid project id fails clearly instead of returning an empty list, now that project resolution is unified and validated across commands.

## 0.8.0

### Added

- List commands (`work-items`, `modules`, `cycles`, `states`, `labels`, `intake`) print the resolved context (`workspace`, `project`) to **stderr** when a listing comes back empty, so an empty result caused by the wrong context is diagnosable. stdout stays clean for pipes.

### Fixed

- `--json` output was truncated when piped to another process (`| jq`, `| python`). The CLI called `process.exit()`, which drops whatever stdout had not flushed; it sets the exit code instead and lets Node drain. Affected every list/get command with a large payload.
- `intake accept` and `intake decline` answered 404. The intake record id shown by `intake list` is now resolved to its underlying work-item id before the PATCH, because that endpoint is keyed by work-item id. Either id works.
- `work-items list --expand` was silently ignored — the flag was accepted and never forwarded.

## 0.7.0

### Changed / Breaking

- `RelationsMap` matches the Plane v1.3.1 response shape: values are `RelationTarget[]` (`{ project_id, issue_id }`) instead of `string[]`. If you read relation values as ids, read `.issue_id` now.

### Added

- The `RelationTarget` type is exported.

## 0.6.2

### Added

- JSDoc/TSDoc across every public export — the client, the error class, all resources and all types — so editors show what each one does.

### Docs

- The README is in English, with badges, an API compatibility table and a changelog section; `llms.txt` gains a TypeScript library section (the golden path, the `Page<T>` shape, and the status of pages).
- `--help` and `--version` are documented.
- Pages are described as "not yet mounted", which is what they are.

### Internal

- CI moved to `node:22-alpine` for pnpm compatibility.

## 0.5.2

### Added

- The workspace is optional: resolve it with the `--workspace <slug>` global flag or `PLANE_WORKSPACE`, the same precedence the project already followed.

## 0.5.1

### Docs

- Corrected CLI flag examples in the README (`--token`, `--start-date`, `planec use`), added a "Using with AI agents" section, and clarified that zero dependencies applies to the library — the CLI depends on `commander`.

## 0.5.0

### Added

- The `planec` CLI, covering work items, cycles, modules, states, labels and intake.
- Persistent configuration in `~/.planec/config.json`.
- `--json` on read commands, for piping to `jq`.
- `llms.txt`, a command reference written for AI agents.

## 0.4.0

### Changed / Breaking

- `workItems.list()` no longer accepts `stateGroup`, `priority`, `assignee` or `label`: the v1 API **silently ignores** those query filters, so accepting them was promising something that never happened. The signature is now `orderBy`, `fields`, `expand`, `externalId`, `externalSource`. Filter client-side.
- `workItems.get(identifier)` drops its `projectId` argument — the identifier already carries the project prefix (`PRUEBA-207`). It hits the real `/work-items/{ident}/` endpoint, which also fixes it returning `null` whenever the match fell outside page 1.
- `workItems.search()` takes `{ query, limit?, workspaceSearch?, projectId? }` and returns `WorkItemSearchResult[]`, not `Page<WorkItem>`, using the workspace-level search endpoint.
- `cycles.workItems()` and `modules.workItems()` return `Page<WorkItem>` instead of `WorkItem[]`.

### Added

- `workItems.getById(projectId, uuid)` for a direct UUID lookup.
- `workItems.comments.update()` and `workItems.comments.delete()`.
- `workItems.activities.list(projectId, workItemId, options?)` — the paginated activity log.
- `cycles.workItemsAll()` and `modules.workItemsAll()`, async iterables over every page.

## 0.3.1

### Added

- `estimate_point`, `type` and `module` on `WorkItem`, `CreateWorkItemInput` and `UpdateWorkItemInput`.

## 0.3.0

### Added

- Full support for the relations API (Plane v1.3.0).

### Internal

- ESLint 10 with the flat typescript-eslint config.

## 0.2.2

### Internal

- Unit test mocks reflect the real paginated API shape (`{ results: [] }`, not `[]`). A wrong mock hides the bug it was meant to catch.

## 0.2.1

### Fixed

- `addWorkItems` sent the wrong body field on modules and cycles (`work_items` instead of `issues`), so the call did nothing.
- The build wrote to `dist/src/` instead of `dist/`, which broke the published package's entry point.

## 0.2.0

### Fixed

- Corrected the API endpoints and aligned the client with the shared API-client convention.

### Internal

- Integration tests against a real Plane instance.

## 0.1.1

### Internal

- Dual publish to Verdaccio and npmjs.
- The test script runs `dist/tests/` instead of a glob.

## 0.1.0

The first release.

### Added

- `PlaneClient` with retry and hooks, and `PlaneApiError`.
- Resources: work items, modules, cycles, states, labels and intake.
