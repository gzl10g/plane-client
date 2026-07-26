#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { runHandler } from "./cli/shared.js";

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
  planec work-items search "bug" --json    # find work items
  planec work-items get PROJ-42 --json     # get by identifier
  planec work-items create --name "Fix bug" --priority high

Workspace context (priority order):
  --workspace <slug>         global flag
  PLANE_WORKSPACE=<slug>     environment variable
  planec workspace use       saved in config

Project context (priority order):
  -p, --project <uuid>   flag on any command
  PLANE_PROJECT=<uuid>   environment variable
  planec use <uuid>      saved in config

All read commands accept --json for machine-readable output (pipe to jq).
See llms.txt for a full command reference optimised for AI agents.`,
  );

program.hook("preAction", () => {
  const ws = (program.opts() as { workspace?: string }).workspace;
  if (ws) process.env.PLANE_WORKSPACE = ws;
});

// ── config ──
const configCmd = program.command("config").description("Manage configuration");

configCmd
  .command("set <key> <value>")
  .description("Set a configuration value (baseUrl, apiKey, workspace)")
  .action(async (key: string, value: string) => {
    await runHandler(async () => {
      const { handleConfigSet } = await import("./cli/config-command.js");
      await handleConfigSet(key, value);
    });
  });

configCmd
  .command("show")
  .description("Show current configuration")
  .action(async () => {
    await runHandler(async () => {
      const { handleConfigShow } = await import("./cli/config-command.js");
      await handleConfigShow();
    });
  });

program
  .command("login")
  .description("Authenticate with an API token")
  .requiredOption("--token <token>", "API token")
  .action(async (opts: { token: string }) => {
    await runHandler(async () => {
      const { handleLoginToken } = await import("./cli/config-command.js");
      await handleLoginToken(opts.token);
    });
  });

const workspaceCmd = program.command("workspace").description("Manage workspace");

workspaceCmd
  .command("use <slug>")
  .description("Set the active workspace")
  .action(async (slug: string) => {
    await runHandler(async () => {
      const { handleUseWorkspace } = await import("./cli/config-command.js");
      await handleUseWorkspace(slug);
    });
  });

program
  .command("use <projectUuid>")
  .description("Set the active project")
  .action(async (projectUuid: string) => {
    await runHandler(async () => {
      const { handleUseProject } = await import("./cli/config-command.js");
      await handleUseProject(projectUuid);
    });
  });

// ── work-items ──
const workItemsCmd = program.command("work-items").description("Manage work items");

workItemsCmd
  .command("list")
  .description("List work items in a project")
  .option("-p, --project <uuid>", "Project UUID")
  .option("--per-page <n>", "Items per page")
  .option("--order-by <field>", "Order by field")
  .option("--expand <fields>", "Expand fields (comma-separated)")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; perPage?: string; orderBy?: string; expand?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkItemsList } = await import("./cli/work-items.js");
      await handleWorkItemsList(
        {
          project: opts.project,
          perPage: opts.perPage !== undefined ? parseInt(opts.perPage, 10) : undefined,
          orderBy: opts.orderBy,
          expand: opts.expand,
          json: opts.json ?? program.opts().json,
        },
      );
    });
  });

workItemsCmd
  .command("get <identifier>")
  .description("Get a work item by identifier (e.g. PROJ-42)")
  .option("--json", "Output as JSON")
  .action(async (identifier: string, opts: { json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkItemsGet } = await import("./cli/work-items.js");
      await handleWorkItemsGet(identifier, { json: opts.json ?? program.opts().json });
    });
  });

workItemsCmd
  .command("get-by-id <uuid>")
  .description("Get a work item by UUID")
  .option("-p, --project <uuid>", "Project UUID")
  .option("--json", "Output as JSON")
  .action(async (uuid: string, opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkItemsGetById } = await import("./cli/work-items.js");
      await handleWorkItemsGetById(uuid, { project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

workItemsCmd
  .command("search <query>")
  .description("Search work items")
  .option("--workspace-search", "Search across the entire workspace")
  .option("-p, --project <uuid>", "Project UUID")
  .option("--limit <n>", "Maximum results to return")
  .option("--json", "Output as JSON")
  .action(async (query: string, opts: { workspaceSearch?: boolean; project?: string; limit?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkItemsSearch } = await import("./cli/work-items.js");
      await handleWorkItemsSearch(
        query,
        {
          workspaceSearch: opts.workspaceSearch,
          project: opts.project,
          limit: opts.limit !== undefined ? parseInt(opts.limit, 10) : undefined,
          json: opts.json ?? program.opts().json,
        },
      );
    });
  });

workItemsCmd
  .command("create")
  .description("Create a work item")
  .option("-p, --project <uuid>", "Project UUID")
  .requiredOption("--name <name>", "Work item name")
  .option("--priority <priority>", "Priority (urgent|high|medium|low|none)")
  .option("--state <uuid>", "State UUID")
  .option("--description-html <html>", "Description HTML")
  .option("--labels <uuids>", "Label UUIDs (comma-separated)")
  .option("--assignees <uuids>", "Assignee UUIDs (comma-separated)")
  .option("--module <uuid>", "Module UUID to add the work item to")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; name: string; priority?: string; state?: string; descriptionHtml?: string; labels?: string; assignees?: string; module?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkItemsCreate } = await import("./cli/work-items.js");
      await handleWorkItemsCreate({
        project: opts.project,
        name: opts.name,
        priority: opts.priority,
        state: opts.state,
        descriptionHtml: opts.descriptionHtml,
        labels: opts.labels,
        assignees: opts.assignees,
        module: opts.module,
        json: opts.json ?? program.opts().json,
      });
    });
  });

workItemsCmd
  .command("update <id>")
  .description("Update a work item")
  .option("-p, --project <uuid>", "Project UUID")
  .option("--name <name>", "Work item name")
  .option("--priority <priority>", "Priority (urgent|high|medium|low|none)")
  .option("--state <uuid>", "State UUID")
  .option("--description-html <html>", "Description HTML")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { project?: string; name?: string; priority?: string; state?: string; descriptionHtml?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleWorkItemsUpdate } = await import("./cli/work-items.js");
      await handleWorkItemsUpdate(id, {
        project: opts.project,
        name: opts.name,
        priority: opts.priority,
        state: opts.state,
        descriptionHtml: opts.descriptionHtml,
        json: opts.json ?? program.opts().json,
      });
    });
  });

workItemsCmd
  .command("activities <id>")
  .description("List activities for a work item")
  .option("-p, --project <uuid>", "Project UUID")
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
  .option("-p, --project <uuid>", "Project UUID")
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
  .option("-p, --project <uuid>", "Project UUID")
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
  .option("-p, --project <uuid>", "Project UUID")
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
  .option("-p, --project <uuid>", "Project UUID")
  .action(async (workItemId: string, commentId: string, opts: { project?: string }) => {
    await runHandler(async () => {
      const { handleCommentsDelete } = await import("./cli/work-items.js");
      await handleCommentsDelete(workItemId, commentId, { project: opts.project });
    });
  });

// work-items links
const linksCmd = workItemsCmd.command("links").description("Manage work item links");

linksCmd
  .command("create <workItemId>")
  .description("Create a link on a work item")
  .option("-p, --project <uuid>", "Project UUID")
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
  .option("-p, --project <uuid>", "Project UUID")
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
  .option("-p, --project <uuid>", "Project UUID")
  .requiredOption("--type <relationType>", "Relation type")
  .requiredOption("--issues <uuids>", "Related issue UUIDs (comma-separated)")
  .option("--json", "Output as JSON")
  .action(async (workItemId: string, opts: { project?: string; type: string; issues: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleRelationsCreate } = await import("./cli/work-items.js");
      await handleRelationsCreate(workItemId, { project: opts.project, type: opts.type, issues: opts.issues, json: opts.json ?? program.opts().json });
    });
  });

// ── cycles ──
const cyclesCmd = program.command("cycles").description("Manage cycles");

cyclesCmd
  .command("list")
  .description("List cycles in a project")
  .option("-p, --project <uuid>", "Project UUID")
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
  .option("-p, --project <uuid>", "Project UUID")
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
  .option("-p, --project <uuid>", "Project UUID")
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
  .option("-p, --project <uuid>", "Project UUID")
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
  .option("-p, --project <uuid>", "Project UUID")
  .action(async (id: string, opts: { project?: string }) => {
    await runHandler(async () => {
      const { handleCyclesArchive } = await import("./cli/cycles.js");
      await handleCyclesArchive(id, { project: opts.project });
    });
  });

cyclesCmd
  .command("transfer <fromId>")
  .description("Transfer work items from one cycle to another")
  .option("-p, --project <uuid>", "Project UUID")
  .requiredOption("--to <toId>", "Target cycle UUID")
  .action(async (fromId: string, opts: { project?: string; to: string }) => {
    await runHandler(async () => {
      const { handleCyclesTransfer } = await import("./cli/cycles.js");
      await handleCyclesTransfer(fromId, opts.to, { project: opts.project });
    });
  });

cyclesCmd
  .command("work-items <id>")
  .description("List work items in a cycle")
  .option("-p, --project <uuid>", "Project UUID")
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
  .option("-p, --project <uuid>", "Project UUID")
  .requiredOption("--work-items <uuids>", "Work item UUIDs (comma-separated)")
  .action(async (cycleId: string, opts: { project?: string; workItems: string }) => {
    await runHandler(async () => {
      const { handleCyclesAddWorkItems } = await import("./cli/cycles.js");
      await handleCyclesAddWorkItems(cycleId, opts.workItems, { project: opts.project });
    });
  });

cyclesCmd
  .command("remove-work-item <cycleId> <workItemId>")
  .description("Remove a work item from a cycle")
  .option("-p, --project <uuid>", "Project UUID")
  .action(async (cycleId: string, workItemId: string, opts: { project?: string }) => {
    await runHandler(async () => {
      const { handleCyclesRemoveWorkItem } = await import("./cli/cycles.js");
      await handleCyclesRemoveWorkItem(cycleId, workItemId, { project: opts.project });
    });
  });

cyclesCmd
  .command("delete <id>")
  .description("Delete a cycle")
  .option("-p, --project <uuid>", "Project UUID")
  .option("--yes", "Skip the confirmation prompt")
  .action(async (id: string, opts: { project?: string; yes?: boolean }) => {
    await runHandler(async () => {
      const { handleCyclesDelete } = await import("./cli/cycles.js");
      await handleCyclesDelete(id, { project: opts.project, yes: opts.yes });
    });
  });

// ── modules ──
const modulesCmd = program.command("modules").description("Manage modules");

modulesCmd
  .command("list")
  .description("List modules in a project")
  .option("-p, --project <uuid>", "Project UUID")
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
  .option("-p, --project <uuid>", "Project UUID")
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
  .option("-p, --project <uuid>", "Project UUID")
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
  .option("-p, --project <uuid>", "Project UUID")
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
  .option("-p, --project <uuid>", "Project UUID")
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
  .option("-p, --project <uuid>", "Project UUID")
  .requiredOption("--work-items <uuids>", "Work item UUIDs (comma-separated)")
  .action(async (moduleId: string, opts: { project?: string; workItems: string }) => {
    await runHandler(async () => {
      const { handleModulesAddWorkItems } = await import("./cli/modules.js");
      await handleModulesAddWorkItems(moduleId, opts.workItems, { project: opts.project });
    });
  });

modulesCmd
  .command("remove-work-item <moduleId> <workItemId>")
  .description("Remove a work item from a module")
  .option("-p, --project <uuid>", "Project UUID")
  .action(async (moduleId: string, workItemId: string, opts: { project?: string }) => {
    await runHandler(async () => {
      const { handleModulesRemoveWorkItem } = await import("./cli/modules.js");
      await handleModulesRemoveWorkItem(moduleId, workItemId, { project: opts.project });
    });
  });

modulesCmd
  .command("delete <id>")
  .description("Delete a module")
  .option("-p, --project <uuid>", "Project UUID")
  .option("--yes", "Skip the confirmation prompt")
  .action(async (id: string, opts: { project?: string; yes?: boolean }) => {
    await runHandler(async () => {
      const { handleModulesDelete } = await import("./cli/modules.js");
      await handleModulesDelete(id, { project: opts.project, yes: opts.yes });
    });
  });

// ── states ──
const statesCmd = program.command("states").description("Manage states");

statesCmd
  .command("list")
  .description("List states in a project")
  .option("-p, --project <uuid>", "Project UUID")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleStatesList } = await import("./cli/states.js");
      await handleStatesList({ project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

// ── labels ──
const labelsCmd = program.command("labels").description("Manage labels");

labelsCmd
  .command("list")
  .description("List labels in a project")
  .option("-p, --project <uuid>", "Project UUID")
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
  .option("-p, --project <uuid>", "Project UUID")
  .requiredOption("--name <name>", "Label name")
  .option("--color <hex>", "Label color (hex, e.g. #ff0000)")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; name: string; color?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleLabelsCreate } = await import("./cli/labels.js");
      await handleLabelsCreate({ project: opts.project, name: opts.name, color: opts.color, json: opts.json ?? program.opts().json });
    });
  });

// ── intake ──
const intakeCmd = program.command("intake").description("Manage intake (triage) issues");

intakeCmd
  .command("list")
  .description("List intake issues in a project")
  .option("-p, --project <uuid>", "Project UUID")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleIntakeList } = await import("./cli/intake.js");
      await handleIntakeList({ project: opts.project, json: opts.json ?? program.opts().json });
    });
  });

intakeCmd
  .command("create")
  .description("Create an intake issue")
  .option("-p, --project <uuid>", "Project UUID")
  .requiredOption("--name <name>", "Issue name")
  .option("--priority <priority>", "Priority (urgent|high|medium|low|none)")
  .option("--description-html <html>", "Description HTML")
  .option("--json", "Output as JSON")
  .action(async (opts: { project?: string; name: string; priority?: string; descriptionHtml?: string; json?: boolean }) => {
    await runHandler(async () => {
      const { handleIntakeCreate } = await import("./cli/intake.js");
      await handleIntakeCreate({ project: opts.project, name: opts.name, priority: opts.priority, descriptionHtml: opts.descriptionHtml, json: opts.json ?? program.opts().json });
    });
  });

intakeCmd
  .command("accept <id>")
  .description("Accept an intake issue")
  .option("-p, --project <uuid>", "Project UUID")
  .action(async (id: string, opts: { project?: string }) => {
    await runHandler(async () => {
      const { handleIntakeAccept } = await import("./cli/intake.js");
      await handleIntakeAccept(id, { project: opts.project });
    });
  });

intakeCmd
  .command("decline <id>")
  .description("Decline an intake issue")
  .option("-p, --project <uuid>", "Project UUID")
  .action(async (id: string, opts: { project?: string }) => {
    await runHandler(async () => {
      const { handleIntakeDecline } = await import("./cli/intake.js");
      await handleIntakeDecline(id, { project: opts.project });
    });
  });

await program.parseAsync(process.argv);
