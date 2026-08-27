#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { runHandler, EXIT_OK, EXIT_USAGE } from "./cli/shared.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string };

const program = new Command();

program
  .name("planec")
  .description("Plane API CLI — manage work items, cycles, modules from the command line")
  .version(pkg.version)
  .option("--json", "Output as JSON")
  .option("--workspace <slug>", "Workspace slug (overrides config and PLANE_WORKSPACE env var)")
  .addHelpText(
    "after",
    `
Setup:
  planec config set baseUrl https://plane.example.com
  planec login --token YOUR_API_KEY
  planec workspace use YOUR_WORKSPACE_SLUG   # optional — or use --workspace / PLANE_WORKSPACE
  planec use PROJECT_UUID                    # optional — or use -p / PLANE_PROJECT

Quick start:
  planec projects list                     # discover project identifiers + UUIDs
  planec work-items search "bug" --json    # find work items
  planec work-items get PROJ-42 --json     # get by identifier
  planec work-items create --name "Fix bug" --priority high
  planec members list                      # resolve people: name/email -> user UUID
  planec work-items update PROJ-42 --assignee ivy   # assign by name, no UUID needed

Workspace context (priority order):
  --workspace <slug>         global flag
  PLANE_WORKSPACE=<slug>     environment variable
  planec workspace use       saved in config

Project context (priority order) — accepts a UUID or an identifier (PCL):
  -p, --project <ref>    flag on any command
  PLANE_PROJECT=<ref>    environment variable
  planec use <uuid>      saved in config

All read commands accept --json for machine-readable output (pipe to jq).
See llms.txt for a full command reference optimised for AI agents.`,
  );

program.hook("preAction", () => {
  const ws = (program.opts() as { workspace?: string }).workspace;
  // The flag used to be forwarded by writing PLANE_WORKSPACE, which made every
  // later reader — `config show` included — report it as coming from the
  // environment. That is the one command people run to work out why a request
  // went to the wrong place, so a false provenance there is expensive. It
  // travels in its own variable now, and `config show` names the flag.
  if (ws) process.env.PLANEC_WORKSPACE_FLAG = ws;
});

// ── config ──
const configCmd = program.command("config").description("Manage configuration");

configCmd
  .command("set <key> [value]")
  .description("Set a configuration value (baseUrl, apiKey, workspace)")
  .option("--stdin", "Read the value from stdin instead of argv (use this for apiKey)")
  .option("--json", "Output as JSON")
  .action(async (key: string, value: string | undefined, opts: { stdin?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleConfigSet } = await import("./cli/config-command.js");
      const { readSecretFromStdin } = await import("./cli/shared.js");
      if (opts.stdin && value !== undefined) {
        throw new Error("Pass either a value or --stdin, not both.");
      }
      if (!opts.stdin && value === undefined) {
        throw new Error(`Missing value for ${key}. Pass it as an argument, or pipe it in with --stdin.`);
      }
      const resolved = opts.stdin ? await readSecretFromStdin("--stdin") : (value as string);
      await handleConfigSet(key, resolved, { json: opts.json ?? program.opts().json });
    });
  });

configCmd
  .command("show")
  .description("Show current configuration, and which layer each value came from")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleConfigShow } = await import("./cli/config-command.js");
      await handleConfigShow({ json: opts.json ?? program.opts().json });
    });
  });

program
  .command("login")
  .description("Authenticate with an API token")
  .option("--token-stdin", "Read the token from stdin (preferred: keeps it out of ps and shell history)")
  .option("--token <token>", "API token (DEPRECATED: visible in ps, shell history and harness logs — use --token-stdin)")
  .option("--json", "Output as JSON")
  .action(async (opts: { token?: string; tokenStdin?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleLoginToken } = await import("./cli/config-command.js");
      const { readSecretFromStdin } = await import("./cli/shared.js");
      if (opts.tokenStdin && opts.token !== undefined) {
        throw new Error("Use either --token-stdin or --token, not both.");
      }
      if (!opts.tokenStdin && opts.token === undefined) {
        throw new Error(
          'Missing token. Preferred: echo "$PLANE_TOKEN" | planec login --token-stdin',
        );
      }
      let token: string;
      if (opts.tokenStdin) {
        token = await readSecretFromStdin("--token-stdin");
      } else {
        token = opts.token as string;
        console.error(
          'Warning: --token puts the secret in argv, where ps, the shell history and harness logs can read it. Prefer: echo "$PLANE_TOKEN" | planec login --token-stdin',
        );
      }
      await handleLoginToken(token, { json: opts.json ?? program.opts().json });
    });
  });

const workspaceCmd = program.command("workspace").description("Manage workspace");

workspaceCmd
  .command("use <slug>")
  .description("Set the active workspace")
  .option("--json", "Output as JSON")
  .action(async (slug: string, opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleUseWorkspace } = await import("./cli/config-command.js");
      await handleUseWorkspace(slug, { json: opts.json ?? program.opts().json });
    });
  });

workspaceCmd
  .command("add <slug>")
  .description("Add a workspace to the list `report` sweeps (the v1 API cannot list them for you)")
  .option("--json", "Output as JSON")
  .action(async (slug: string, opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkspaceAdd } = await import("./cli/config-command.js");
      await handleWorkspaceAdd(slug, { json: opts.json ?? program.opts().json });
    });
  });

workspaceCmd
  .command("remove <slug>")
  .description("Remove a workspace from the report list")
  .option("--json", "Output as JSON")
  .action(async (slug: string, opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkspaceRemove } = await import("./cli/config-command.js");
      await handleWorkspaceRemove(slug, { json: opts.json ?? program.opts().json });
    });
  });

workspaceCmd
  .command("list")
  .description("Show the active workspace and the ones `report` sweeps")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkspaceList } = await import("./cli/config-command.js");
      await handleWorkspaceList({ json: opts.json ?? program.opts().json });
    });
  });

program
  .command("use <projectRef>")
  .description("Set the active project (UUID or identifier, e.g. PCL — stored as the UUID)")
  .option("--json", "Output as JSON")
  .action(async (projectRef: string, opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleUseProject } = await import("./cli/config-command.js");
      await handleUseProject(projectRef, { json: opts.json ?? program.opts().json });
    });
  });

// ── projects ──
const projectsCmd = program.command("projects").description("Manage projects");

projectsCmd
  .command("list")
  .description("List projects in the workspace (identifier, name and UUID)")
  .option("--per-page <n>", "Items per page while paginating (API caps it at 100)")
  .option("--json", "Output as JSON")
  .action(async (opts: { perPage?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleProjectsList } = await import("./cli/projects.js");
      const { parseCount } = await import("./cli/shared.js");
      // Validado aquí y en el handler: el handler es también API de la librería.
      parseCount(opts.perPage, "--per-page", 100);
      await handleProjectsList({ perPage: opts.perPage, json: opts.json ?? program.opts().json });
    });
  });

projectsCmd
  .command("get <ref>")
  .description("Get a project by UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (ref: string, opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleProjectsGet } = await import("./cli/projects.js");
      await handleProjectsGet(ref, { json: opts.json ?? program.opts().json });
    });
  });

projectsCmd
  .command("create")
  .description("Create a project (work items, modules, intake and views on; cycles and pages off)")
  .requiredOption("--name <name>", "Project name")
  .requiredOption("--identifier <prefix>", "Work item prefix (e.g. PCL) — uppercased")
  .option("--description <text>", "Project description")
  .option("--cycles", "Enable cycles (off by default)")
  .option("--pages", "Enable pages (off by default)")
  .option("--no-modules", "Disable modules (on by default)")
  .option("--no-intake", "Disable the intake queue (on by default)")
  .option("--no-views", "Disable saved views (on by default)")
  .option("--json", "Output as JSON")
  .action(async (opts: { name: string; identifier: string; description?: string; cycles?: boolean; pages?: boolean; modules?: boolean; intake?: boolean; views?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleProjectsCreate } = await import("./cli/projects.js");
      await handleProjectsCreate({ ...opts, json: opts.json ?? program.opts().json });
    });
  });

projectsCmd
  .command("update <ref>")
  .description("Update a project by UUID or identifier")
  .option("--name <name>", "Project name")
  .option("--identifier <prefix>", "New work item prefix — rewrites every PROJ-N reference, prompts unless --yes")
  .option("--description <text>", "Project description")
  .option("--cycles", "Enable cycles")
  .option("--no-cycles", "Disable cycles")
  .option("--modules", "Enable modules")
  .option("--no-modules", "Disable modules")
  .option("--intake", "Enable the intake queue")
  .option("--no-intake", "Disable the intake queue")
  .option("--views", "Enable saved views")
  .option("--no-views", "Disable saved views")
  .option("--pages", "Enable pages")
  .option("--no-pages", "Disable pages")
  .option("--yes", "Skip the identifier rename confirmation")
  .option("--json", "Output as JSON")
  .action(async (ref: string, opts: { name?: string; identifier?: string; description?: string; cycles?: boolean; modules?: boolean; intake?: boolean; views?: boolean; pages?: boolean; yes?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleProjectsUpdate } = await import("./cli/projects.js");
      await handleProjectsUpdate(ref, { ...opts, json: opts.json ?? program.opts().json });
    });
  });

projectsCmd
  .command("delete <ref>")
  .description("Delete a project — CASCADES to its work items, modules, cycles and intake")
  .option("--confirm <identifier>", "Non-interactive confirmation: must match the project identifier")
  .option("--dry-run", "Show what would be deleted and exit without deleting")
  .option("--json", "Output as JSON")
  .action(async (ref: string, opts: { confirm?: string; dryRun?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleProjectsDelete } = await import("./cli/projects.js");
      await handleProjectsDelete(ref, { confirm: opts.confirm, dryRun: opts.dryRun, json: opts.json ?? program.opts().json });
    });
  });

// ── work-items ──
const workItemsCmd = program.command("work-items").description("Manage work items");

workItemsCmd
  .command("list")
  .description("List work items in a project")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--per-page <n>", "Items per page")
  .option("--order-by <field>", "created_at|updated_at|priority|sort_order|state__name|state__group|labels__name|assignees__first_name (prefix with - to reverse). Validated: Plane ignores an unknown value in silence")
  .option("--expand <fields>", "Expand fields (comma-separated)")
  .option("--with-modules", "Attach module membership client-side (Plane API ignores expand=modules; costs 1 extra request per module)")
  .option("--all", "Fetch every page instead of the first one")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; perPage?: string; orderBy?: string; expand?: string; withModules?: boolean; all?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkItemsList } = await import("./cli/work-items.js");
      const { parseCount } = await import("./cli/shared.js");
      await handleWorkItemsList(
        {
          project: opts.project,
          perPage: parseCount(opts.perPage, "--per-page", 100),
          orderBy: opts.orderBy,
          expand: opts.expand,
          withModules: opts.withModules,
          all: opts.all,
          json: opts.json ?? program.opts().json,
        },
      );
    });
  });

workItemsCmd
  .command("get <identifier>")
  .description("Get a work item by identifier (e.g. PROJ-42)")
  .option("--with-modules", "Attach module membership client-side (Plane API ignores expand=modules; walks every module in the project)")
  .option("--with-comments", "Attach comment bodies to the output (a comment count hint is always printed to stderr if any exist)")
  .option("--json", "Output as JSON")
  .action(async (identifier: string, opts: { withModules?: boolean; withComments?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkItemsGet } = await import("./cli/work-items.js");
      await handleWorkItemsGet(identifier, { withModules: opts.withModules, withComments: opts.withComments, json: opts.json ?? program.opts().json });
    });
  });

workItemsCmd
  .command("get-by-id <uuid>")
  .description("Get a work item by UUID")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--with-modules", "Attach module membership client-side (Plane API ignores expand=modules; walks every module in the project)")
  .option("--with-comments", "Attach comment bodies to the output (a comment count hint is always printed to stderr if any exist)")
  .option("--json", "Output as JSON")
  .action(async (uuid: string, opts: { project?: string; withModules?: boolean; withComments?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkItemsGetById } = await import("./cli/work-items.js");
      await handleWorkItemsGetById(uuid, { project: opts.project, withModules: opts.withModules, withComments: opts.withComments, json: opts.json ?? program.opts().json });
    });
  });

workItemsCmd
  .command("search <query>")
  .description("Search work items")
  .option("--workspace-search", "Search across the entire workspace")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--limit <n>", "Maximum results to return")
  .option("--json", "Output as JSON")
  .action(async (query: string, opts: { workspaceSearch?: boolean; project?: string; limit?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkItemsSearch } = await import("./cli/work-items.js");
      const { parseCount } = await import("./cli/shared.js");
      await handleWorkItemsSearch(
        query,
        {
          workspaceSearch: opts.workspaceSearch,
          project: opts.project,
          limit: parseCount(opts.limit, "--limit"),
          json: opts.json ?? program.opts().json,
        },
      );
    });
  });

workItemsCmd
  .command("create")
  .description("Create a work item")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .requiredOption("--name <name>", "Work item name")
  .option("--priority <priority>", "Priority (urgent|high|medium|low|none)")
  .option("--state <uuid>", "State UUID")
  .option("--description-html <html>", "Description HTML")
  .option("--description-html-file <path>", "Read description HTML from a file (for payloads too large for argv)")
  .option("--labels <uuids>", "Label UUIDs (comma-separated)")
  .option("--assignees <uuids>", "Assignee UUIDs (comma-separated, unchecked — prefer --assignee)")
  .option("--assignee <refs...>", "Assignees by name, email or UUID (repeatable or comma-separated)")
  .option("--module <uuid>", "Module UUID to add the work item to")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; name: string; priority?: string; state?: string; descriptionHtml?: string; descriptionHtmlFile?: string; labels?: string; assignees?: string; assignee?: string[]; module?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkItemsCreate } = await import("./cli/work-items.js");
      await handleWorkItemsCreate({
        project: opts.project,
        name: opts.name,
        priority: opts.priority,
        state: opts.state,
        descriptionHtml: opts.descriptionHtml,
        descriptionHtmlFile: opts.descriptionHtmlFile,
        labels: opts.labels,
        assignees: opts.assignees,
        assignee: opts.assignee,
        module: opts.module,
        json: opts.json ?? program.opts().json,
      });
    });
  });

workItemsCmd
  .command("update <id>")
  .description("Update a work item")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--name <name>", "Work item name")
  .option("--priority <priority>", "Priority (urgent|high|medium|low|none)")
  .option("--state <uuid>", "State UUID")
  .option("--description-html <html>", "Description HTML")
  .option("--description-html-file <path>", "Read description HTML from a file (for payloads too large for argv)")
  .option("--assignee <refs...>", "Replace assignees, by name, email or UUID (repeatable or comma-separated)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; name?: string; priority?: string; state?: string; descriptionHtml?: string; descriptionHtmlFile?: string; assignee?: string[]; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkItemsUpdate } = await import("./cli/work-items.js");
      await handleWorkItemsUpdate(id, {
        project: opts.project,
        name: opts.name,
        priority: opts.priority,
        state: opts.state,
        descriptionHtml: opts.descriptionHtml,
        descriptionHtmlFile: opts.descriptionHtmlFile,
        assignee: opts.assignee,
        json: opts.json ?? program.opts().json,
      });
    });
  });

workItemsCmd
  .command("activities <id>")
  .description("List activities for a work item")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkItemsActivities } = await import("./cli/work-items.js");
      await handleWorkItemsActivities(id, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

// work-items comments
const commentsCmd = workItemsCmd.command("comments").description("Manage work item comments");

commentsCmd
  .command("list <workItemId>")
  .description("List comments on a work item")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (workItemId: string, opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleCommentsList } = await import("./cli/work-items.js");
      await handleCommentsList(workItemId, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

commentsCmd
  .command("create <workItemId>")
  .description("Create a comment on a work item")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .requiredOption("--comment-html <html>", "Comment HTML content")
  .option("--json", "Output as JSON")
  .action(async (workItemId: string, opts: { project?: string; commentHtml: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleCommentsCreate } = await import("./cli/work-items.js");
      await handleCommentsCreate(workItemId, opts.commentHtml, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

commentsCmd
  .command("update <workItemId> <commentId>")
  .description("Update a comment")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .requiredOption("--comment-html <html>", "Comment HTML content")
  .option("--json", "Output as JSON")
  .action(async (workItemId: string, commentId: string, opts: { project?: string; commentHtml: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleCommentsUpdate } = await import("./cli/work-items.js");
      await handleCommentsUpdate(workItemId, commentId, opts.commentHtml, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

commentsCmd
  .command("delete <workItemId> <commentId>")
  .description("Delete a comment")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--yes", "Skip the confirmation prompt")
  .option("--json", "Output as JSON")
  .action(async (workItemId: string, commentId: string, opts: { project?: string; yes?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleCommentsDelete } = await import("./cli/work-items.js");
      await handleCommentsDelete(workItemId, commentId, { project: opts.project, yes: opts.yes, json: opts.json ?? program.opts().json });
    });
  });

workItemsCmd
  .command("delete <id>")
  .description("Delete a work item permanently")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--yes", "Skip the confirmation prompt")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; yes?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkItemsDelete } = await import("./cli/work-items.js");
      await handleWorkItemsDelete(id, { project: opts.project, yes: opts.yes, json: opts.json ?? program.opts().json });
    });
  });

// work-items links
const linksCmd = workItemsCmd.command("links").description("Manage work item links");

linksCmd
  .command("list <workItemId>")
  .description("List the links on a work item")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (workItemId: string, opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleLinksList } = await import("./cli/work-items.js");
      await handleLinksList(workItemId, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

linksCmd
  .command("update <workItemId> <linkId>")
  .description("Change a link's URL or title")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--url <url>", "New URL")
  .option("--title <title>", "New title")
  .option("--json", "Output as JSON")
  .action(async (workItemId: string, linkId: string, opts: { project?: string; url?: string; title?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleLinksUpdate } = await import("./cli/work-items.js");
      await handleLinksUpdate(workItemId, linkId, { project: opts.project, url: opts.url, title: opts.title, json: opts.json ?? program.opts().json });
    });
  });

linksCmd
  .command("delete <workItemId> <linkId>")
  .description("Delete a link from a work item")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--yes", "Skip the confirmation prompt")
  .option("--json", "Output as JSON")
  .action(async (workItemId: string, linkId: string, opts: { project?: string; yes?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleLinksDelete } = await import("./cli/work-items.js");
      await handleLinksDelete(workItemId, linkId, { project: opts.project, yes: opts.yes, json: opts.json ?? program.opts().json });
    });
  });

linksCmd
  .command("create <workItemId>")
  .description("Create a link on a work item")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .requiredOption("--url <url>", "Link URL")
  .option("--title <title>", "Link title")
  .option("--json", "Output as JSON")
  .action(async (workItemId: string, opts: { project?: string; url: string; title?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleLinksCreate } = await import("./cli/work-items.js");
      await handleLinksCreate(workItemId, { project: opts.project, url: opts.url, title: opts.title, json: opts.json ?? program.opts().json });
    });
  });

// work-items relations
const relationsCmd = workItemsCmd.command("relations").description("Manage work item relations");

relationsCmd
  .command("list <workItemId>")
  .description("List relations for a work item")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (workItemId: string, opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleRelationsList } = await import("./cli/work-items.js");
      await handleRelationsList(workItemId, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

relationsCmd
  .command("create <workItemId>")
  .description("Create a relation between work items")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .requiredOption("--type <relationType>", "Relation type")
  .requiredOption("--issues <refs...>", "Related work items: UUIDs or PROJ-N identifiers (comma- or space-separated)")
  .option("--json", "Output as JSON")
  .action(async (workItemId: string, opts: { project?: string; type: string; issues: string[]; json?: boolean }) => {
    await runHandler(async () => {
      const { handleRelationsCreate } = await import("./cli/work-items.js");
      await handleRelationsCreate(workItemId, { project: opts.project, type: opts.type, issues: opts.issues, json: opts.json ?? program.opts().json });
    });
  });

// work-items attachments
const attachmentsCmd = workItemsCmd.command("attachments").description("Manage work item file attachments");

attachmentsCmd
  .command("list <workItemId>")
  .description("List attachments on a work item")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (workItemId: string, opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleAttachmentsList } = await import("./cli/attachments.js");
      await handleAttachmentsList(workItemId, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

attachmentsCmd
  .command("upload <workItemId>")
  .description("Upload a file as a work item attachment (credentials + S3 upload + confirm)")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .requiredOption("--file <path>", "Path to the local file to upload")
  .option("--type <mimeType>", "MIME type (default: inferred not attempted — pass explicitly if the instance requires it)")
  .option("--name <name>", "Filename to record (default: the local file's basename)")
  .option("--json", "Output as JSON")
  .action(async (workItemId: string, opts: { project?: string; file: string; type?: string; name?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleAttachmentsUpload } = await import("./cli/attachments.js");
      await handleAttachmentsUpload(workItemId, {
        project: opts.project,
        file: opts.file,
        type: opts.type,
        name: opts.name,
        json: opts.json ?? program.opts().json,
      });
    });
  });

attachmentsCmd
  .command("download-url <workItemId> <attachmentId>")
  .description("Get the presigned download URL for an attachment")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (workItemId: string, attachmentId: string, opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleAttachmentsDownloadUrl } = await import("./cli/attachments.js");
      await handleAttachmentsDownloadUrl(workItemId, attachmentId, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

attachmentsCmd
  .command("delete <workItemId> <attachmentId>")
  .description("Delete an attachment from a work item")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--yes", "Skip the confirmation prompt")
  .option("--json", "Output as JSON")
  .action(async (workItemId: string, attachmentId: string, opts: { project?: string; yes?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleAttachmentsDelete } = await import("./cli/attachments.js");
      await handleAttachmentsDelete(workItemId, attachmentId, { project: opts.project, yes: opts.yes, json: opts.json ?? program.opts().json });
    });
  });

// ── cycles ──
const cyclesCmd = program.command("cycles").description("Manage cycles");

cyclesCmd
  .command("list")
  .description("List cycles in a project")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleCyclesList } = await import("./cli/cycles.js");
      await handleCyclesList({ project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

cyclesCmd
  .command("get <id>")
  .description("Get a cycle by ID")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleCyclesGet } = await import("./cli/cycles.js");
      await handleCyclesGet(id, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

cyclesCmd
  .command("create")
  .description("Create a cycle")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .requiredOption("--name <name>", "Cycle name")
  .option("--description <text>", "Cycle description")
  .option("--start-date <date>", "Start date (YYYY-MM-DD)")
  .option("--end-date <date>", "End date (YYYY-MM-DD)")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; name: string; description?: string; startDate?: string; endDate?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleCyclesCreate } = await import("./cli/cycles.js");
      await handleCyclesCreate({
        project: opts.project,
        name: opts.name,
        description: opts.description,
        startDate: opts.startDate,
        endDate: opts.endDate,
        json: opts.json ?? program.opts().json,
      });
    });
  });

cyclesCmd
  .command("update <id>")
  .description("Update a cycle")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--name <name>", "Cycle name")
  .option("--description <text>", "Cycle description")
  .option("--start-date <date>", "Start date (YYYY-MM-DD)")
  .option("--end-date <date>", "End date (YYYY-MM-DD)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; name?: string; description?: string; startDate?: string; endDate?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleCyclesUpdate } = await import("./cli/cycles.js");
      await handleCyclesUpdate(id, {
        project: opts.project,
        name: opts.name,
        description: opts.description,
        startDate: opts.startDate,
        endDate: opts.endDate,
        json: opts.json ?? program.opts().json,
      });
    });
  });

cyclesCmd
  .command("archive <id>")
  .description("Archive a cycle")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleCyclesArchive } = await import("./cli/cycles.js");
      await handleCyclesArchive(id, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

cyclesCmd
  .command("transfer <fromId>")
  .description("Transfer work items from one cycle to another")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .requiredOption("--to <toId>", "Target cycle UUID")
  .option("--json", "Output as JSON")
  .action(async (fromId: string, opts: { project?: string; to: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleCyclesTransfer } = await import("./cli/cycles.js");
      await handleCyclesTransfer(fromId, opts.to, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

cyclesCmd
  .command("work-items <id>")
  .description("List work items in a cycle")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleCyclesWorkItems } = await import("./cli/cycles.js");
      await handleCyclesWorkItems(id, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

cyclesCmd
  .command("add-work-items <cycleId>")
  .description("Add work items to a cycle")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .requiredOption("--work-items <refs...>", "Work items: UUIDs or PROJ-N identifiers (comma- or space-separated)")
  .option("--json", "Output as JSON")
  .action(async (cycleId: string, opts: { project?: string; workItems: string[]; json?: boolean }) => {
    await runHandler(async () => {
      const { handleCyclesAddWorkItems } = await import("./cli/cycles.js");
      await handleCyclesAddWorkItems(cycleId, opts.workItems, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

cyclesCmd
  .command("remove-work-item <cycleId> <workItemId>")
  .description("Remove a work item from a cycle")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (cycleId: string, workItemId: string, opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleCyclesRemoveWorkItem } = await import("./cli/cycles.js");
      await handleCyclesRemoveWorkItem(cycleId, workItemId, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

cyclesCmd
  .command("delete <id>")
  .description("Delete a cycle")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--yes", "Skip the confirmation prompt")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; yes?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleCyclesDelete } = await import("./cli/cycles.js");
      await handleCyclesDelete(id, { project: opts.project, yes: opts.yes, json: opts.json ?? program.opts().json });
    });
  });

// ── modules ──
const modulesCmd = program.command("modules").description("Manage modules");

modulesCmd
  .command("list")
  .description("List modules in a project")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleModulesList } = await import("./cli/modules.js");
      await handleModulesList({ project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

modulesCmd
  .command("get <id>")
  .description("Get a module by ID")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleModulesGet } = await import("./cli/modules.js");
      await handleModulesGet(id, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

modulesCmd
  .command("create")
  .description("Create a module")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .requiredOption("--name <name>", "Module name")
  .option("--description <text>", "Module description")
  .option("--start-date <date>", "Start date (YYYY-MM-DD)")
  .option("--target-date <date>", "Target date (YYYY-MM-DD)")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; name: string; description?: string; startDate?: string; targetDate?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleModulesCreate } = await import("./cli/modules.js");
      await handleModulesCreate({
        project: opts.project,
        name: opts.name,
        description: opts.description,
        startDate: opts.startDate,
        targetDate: opts.targetDate,
        json: opts.json ?? program.opts().json,
      });
    });
  });

modulesCmd
  .command("update <id>")
  .description("Update a module")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--name <name>", "Module name")
  .option("--description <text>", "Module description")
  .option("--status <status>", "Module status")
  .option("--start-date <date>", "Start date (YYYY-MM-DD)")
  .option("--target-date <date>", "Target date (YYYY-MM-DD)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; name?: string; description?: string; status?: string; startDate?: string; targetDate?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleModulesUpdate } = await import("./cli/modules.js");
      await handleModulesUpdate(id, {
        project: opts.project,
        name: opts.name,
        description: opts.description,
        status: opts.status,
        startDate: opts.startDate,
        targetDate: opts.targetDate,
        json: opts.json ?? program.opts().json,
      });
    });
  });

modulesCmd
  .command("work-items <id>")
  .description("List work items in a module")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleModulesWorkItems } = await import("./cli/modules.js");
      await handleModulesWorkItems(id, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

modulesCmd
  .command("add-work-items <moduleId>")
  .description("Add work items to a module")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .requiredOption("--work-items <refs...>", "Work items: UUIDs or PROJ-N identifiers (comma- or space-separated)")
  .option("--json", "Output as JSON")
  .action(async (moduleId: string, opts: { project?: string; workItems: string[]; json?: boolean }) => {
    await runHandler(async () => {
      const { handleModulesAddWorkItems } = await import("./cli/modules.js");
      await handleModulesAddWorkItems(moduleId, opts.workItems, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

modulesCmd
  .command("remove-work-item <moduleId> <workItemId>")
  .description("Remove a work item from a module")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (moduleId: string, workItemId: string, opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleModulesRemoveWorkItem } = await import("./cli/modules.js");
      await handleModulesRemoveWorkItem(moduleId, workItemId, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

modulesCmd
  .command("delete <id>")
  .description("Delete a module")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--yes", "Skip the confirmation prompt")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; yes?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleModulesDelete } = await import("./cli/modules.js");
      await handleModulesDelete(id, { project: opts.project, yes: opts.yes, json: opts.json ?? program.opts().json });
    });
  });

// ── states ──
const statesCmd = program.command("states").description("Manage states");

statesCmd
  .command("list")
  .description("List states in a project")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleStatesList } = await import("./cli/states.js");
      await handleStatesList({ project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

statesCmd
  .command("get <id>")
  .description("Get a state by UUID")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleStatesGet } = await import("./cli/states.js");
      await handleStatesGet(id, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

statesCmd
  .command("create")
  .description("Create a state. --group is required: Plane files a state without one under backlog, silently")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .requiredOption("--name <name>", "State name")
  .requiredOption("--group <group>", "backlog|unstarted|started|completed|cancelled — decides how counts and filters treat it")
  .option("--color <hex>", "Colour (hex, e.g. #ff0000). Defaults to a neutral grey")
  .option("--description <text>", "State description")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; name: string; group: string; color?: string; description?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleStatesCreate } = await import("./cli/states.js");
      await handleStatesCreate({ ...opts, json: opts.json ?? program.opts().json });
    });
  });

statesCmd
  .command("update <id>")
  .description("Update a state")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--name <name>", "State name")
  .option("--group <group>", "backlog|unstarted|started|completed|cancelled")
  .option("--color <hex>", "Colour (hex, e.g. #ff0000)")
  .option("--description <text>", "State description")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; name?: string; group?: string; color?: string; description?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleStatesUpdate } = await import("./cli/states.js");
      await handleStatesUpdate(id, { ...opts, json: opts.json ?? program.opts().json });
    });
  });

statesCmd
  .command("delete <id>")
  .description("Delete a state")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--yes", "Skip the confirmation prompt")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; yes?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleStatesDelete } = await import("./cli/states.js");
      await handleStatesDelete(id, { project: opts.project, yes: opts.yes, json: opts.json ?? program.opts().json });
    });
  });

// ── labels ──
const labelsCmd = program.command("labels").description("Manage labels");

labelsCmd
  .command("list")
  .description("List labels in a project")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleLabelsList } = await import("./cli/labels.js");
      await handleLabelsList({ project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

labelsCmd
  .command("create")
  .description("Create a label")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .requiredOption("--name <name>", "Label name")
  .option("--color <hex>", "Label color (hex, e.g. #ff0000)")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; name: string; color?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleLabelsCreate } = await import("./cli/labels.js");
      await handleLabelsCreate({ project: opts.project, name: opts.name, color: opts.color, json: opts.json ?? program.opts().json });
    });
  });

labelsCmd
  .command("get <id>")
  .description("Get a label by UUID")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleLabelsGet } = await import("./cli/labels.js");
      await handleLabelsGet(id, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

labelsCmd
  .command("update <id>")
  .description("Change a label's name or colour")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--name <name>", "Label name")
  .option("--color <hex>", "Label colour (hex, e.g. #ff0000)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; name?: string; color?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleLabelsUpdate } = await import("./cli/labels.js");
      await handleLabelsUpdate(id, { ...opts, json: opts.json ?? program.opts().json });
    });
  });

labelsCmd
  .command("delete <id>")
  .description("Delete a label")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleLabelsDelete } = await import("./cli/labels.js");
      await handleLabelsDelete(id, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

// ── intake ──
const intakeCmd = program.command("intake").description("Manage intake (triage) issues");

intakeCmd
  .command("list")
  .description("List intake issues in a project")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--all", "Fetch every page instead of the first one")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; all?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleIntakeList } = await import("./cli/intake.js");
      await handleIntakeList({ project: opts.project, all: opts.all, json: opts.json ?? program.opts().json });
    });
  });

intakeCmd
  .command("create")
  .description("Create an intake issue")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .requiredOption("--name <name>", "Issue name")
  .option("--priority <priority>", "Priority (urgent|high|medium|low|none)")
  .option("--description-html <html>", "Description HTML")
  .option("--description-html-file <path>", "Read description HTML from a file (for payloads too large for argv)")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; name: string; priority?: string; descriptionHtml?: string; descriptionHtmlFile?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleIntakeCreate } = await import("./cli/intake.js");
      await handleIntakeCreate({ project: opts.project, name: opts.name, priority: opts.priority, descriptionHtml: opts.descriptionHtml, descriptionHtmlFile: opts.descriptionHtmlFile, json: opts.json ?? program.opts().json });
    });
  });

intakeCmd
  .command("accept <id>")
  .description("Accept an intake issue")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleIntakeAccept } = await import("./cli/intake.js");
      await handleIntakeAccept(id, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

intakeCmd
  .command("decline <id>")
  .description("Decline an intake issue")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .option("--yes", "Skip the confirmation prompt")
  .action(async (id: string, opts: { project?: string; yes?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleIntakeDecline } = await import("./cli/intake.js");
      await handleIntakeDecline(id, { project: opts.project, yes: opts.yes, json: opts.json ?? program.opts().json });
    });
  });

// ── members ──
const membersCmd = program
  .command("members")
  .description("Read workspace members (Plane API v1 exposes no write access to workspace roles)");

membersCmd
  .command("list")
  .description("List workspace members with their role and whether they are active")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleMembersList } = await import("./cli/members.js");
      await handleMembersList({ json: opts.json ?? program.opts().json });
    });
  });

// ── projects members ──
const projectMembersCmd = projectsCmd
  .command("members")
  .description("Manage the membership of a project");

projectMembersCmd
  .command("list")
  .description("List project members with their project role and whether they are active")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleProjectMembersList } = await import("./cli/members.js");
      await handleProjectMembersList({ project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

projectMembersCmd
  .command("add")
  .description("Add workspace members to a project")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .requiredOption("--member <refs>", "Members by name, email or UUID (comma-separated)")
  .option("--role <role>", "Role: admin|member|guest (default: member — the API itself defaults to guest)")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; member: string; role?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleProjectMembersAdd } = await import("./cli/members.js");
      await handleProjectMembersAdd({ project: opts.project, member: opts.member, role: opts.role, json: opts.json ?? program.opts().json });
    });
  });

projectMembersCmd
  .command("set-role <membershipId>")
  .description("Change a project role. Takes the membership id returned by `add` — no listing exposes it (API v1 limitation)")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .requiredOption("--role <role>", "Role: admin|member|guest")
  .option("--json", "Output as JSON")
  .action(async (membershipId: string, opts: { project?: string; role: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleProjectMembersSetRole } = await import("./cli/members.js");
      await handleProjectMembersSetRole(membershipId, { project: opts.project, role: opts.role, json: opts.json ?? program.opts().json });
    });
  });

projectMembersCmd
  .command("deactivate <membershipId>")
  .description("Deactivate a membership (Plane's delete). Irreversible through the API; takes the membership id returned by `add`")
  .option("-p, --project <ref>", "Project UUID or identifier (e.g. PCL)")
  .option("--yes", "Skip the confirmation prompt")
  .option("--json", "Output as JSON")
  .action(async (membershipId: string, opts: { project?: string; yes?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleProjectMembersDeactivate } = await import("./cli/members.js");
      await handleProjectMembersDeactivate(membershipId, { project: opts.project, yes: opts.yes, json: opts.json ?? program.opts().json });
    });
  });

// ── invitations ──
const invitationsCmd = program
  .command("invitations")
  .description("Manage workspace invitations (the only way v1 adds a new member)");

invitationsCmd
  .command("list")
  .description("List workspace invitations, pending and accepted")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleInvitationsList } = await import("./cli/members.js");
      await handleInvitationsList({ json: opts.json ?? program.opts().json });
    });
  });

invitationsCmd
  .command("create <email>")
  .description("Invite an email to the workspace. API v1 writes the invitation without sending the email the UI sends")
  .option("--role <role>", "Role: admin|member|guest (default: member)")
  .option("--json", "Output as JSON")
  .action(async (email: string, opts: { role?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleInvitationsCreate } = await import("./cli/members.js");
      await handleInvitationsCreate(email, { role: opts.role, json: opts.json ?? program.opts().json });
    });
  });

invitationsCmd
  .command("set-role <invitationId>")
  .description("Change the role a pending invitation offers (the email cannot be changed)")
  .requiredOption("--role <role>", "Role: admin|member|guest")
  .option("--json", "Output as JSON")
  .action(async (invitationId: string, opts: { role: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleInvitationsSetRole } = await import("./cli/members.js");
      await handleInvitationsSetRole(invitationId, { role: opts.role, json: opts.json ?? program.opts().json });
    });
  });

invitationsCmd
  .command("delete <invitationId>")
  .description("Revoke a pending invitation (the API refuses once it has been accepted)")
  .option("--yes", "Skip the confirmation prompt")
  .option("--json", "Output as JSON")
  .action(async (invitationId: string, opts: { yes?: boolean; json?: boolean }) => {
    await runHandler(async () => {
      const { handleInvitationsDelete } = await import("./cli/members.js");
      await handleInvitationsDelete(invitationId, { yes: opts.yes, json: opts.json ?? program.opts().json });
    });
  });

// ── report ──
const reportCmd = program
  .command("report")
  .description("Cross-workspace reports. The only commands here that are not project-scoped");

reportCmd
  .command("work-items")
  .description("Pending and completed work across every project of the given workspaces")
  .option("--workspaces <slugs...>", "Workspaces to sweep (repeatable or comma-separated). Plural on purpose: the global --workspace takes a single slug. Default: the `workspace add` list, else the active workspace")
  .option("--status <status>", "open|done|all — open means backlog+unstarted+started (default: open)")
  .option("--group <groups>", "State groups, comma-separated: backlog,unstarted,started,completed,cancelled (overrides --status)")
  .option("--project <identifiers>", "Only these project identifiers, comma-separated (e.g. PCL,NXI)")
  .option("--assignee <refs...>", "Only work items assigned to these user UUIDs")
  .option("--since <date>", "From this date (completed_at for done, created_at otherwise)")
  .option("--until <date>", "Up to and including this date")
  .option("--intake", "Also list what is waiting untriaged in each intake queue")
  .option("--intake-only", "List only the intake queues")
  .option("--format <format>", "table|json|csv|md (default: table)")
  .option("--json", "Shorthand for --format json")
  .action(async (opts: {
    workspaces?: string[];
    status?: string;
    group?: string;
    project?: string;
    assignee?: string[];
    since?: string;
    until?: string;
    intake?: boolean;
    intakeOnly?: boolean;
    format?: string;
    json?: boolean;
  }) => {
    await runHandler(async () => {
      const { handleReportWorkItems } = await import("./cli/report.js");
      await handleReportWorkItems({ ...opts, json: opts.json ?? program.opts().json });
    });
  });

// Commander exits 1 for a usage error by default — an unknown flag, an unknown
// command, a missing argument — which is the same code as a real failure. With
// exitOverride it throws instead, so those land on 2 like every other misuse the
// CLI catches itself. `--help` and `--version` are not errors and keep exit 0.
program.exitOverride();
for (const command of program.commands) applyExitOverride(command);

function applyExitOverride(command: Command): void {
  command.exitOverride();
  for (const child of command.commands) applyExitOverride(child);
}

try {
  await program.parseAsync(process.argv);
} catch (err: unknown) {
  const code = (err as { code?: string }).code ?? "";
  // `commander.help` NO va en esta lista: commander lo usa tanto para
  // `planec help` (exitCode 0) como para el help de error de un grupo sin
  // subcomando o con uno desconocido (exitCode 1). Forzarlo a 0 hacía que
  // `planec work-items` saliera 0 tras imprimir la ayuda por stderr, así que
  // `planec work-items bogus && echo ok` decía ok. La rama else de abajo ya lo
  // distingue bien mirando el exitCode que trae el propio error.
  if (code === "commander.helpDisplayed" || code === "commander.version") {
    process.exitCode = EXIT_OK;
  } else if (!code.startsWith("commander.")) {
    // Solo los errores de commander vienen ya impresos. Cualquier otra cosa que
    // llegue hasta aquí (un throw en un hook, en un argParser, en un .action
    // fuera de runHandler) salía muda y encima etiquetada como error de uso.
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } else {
    // Commander already printed the message; only the code needs fixing.
    process.exitCode = (err as { exitCode?: number }).exitCode === 0 ? EXIT_OK : EXIT_USAGE;
  }
}
