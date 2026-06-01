# Rielflow

Rielflow is a local workflow runner for cooperative multi-agent work. It lets
you install reusable workflows, run them with LLM agent backends, inspect each
execution, and connect workflows to events such as chat messages, webhooks,
cron jobs, file changes, and manual commands.

Use Rielflow when one prompt is not enough: planning, delegation, review,
retry, waiting for user input, calling tools, and handing work between agents
can all be described as a reusable workflow.

## What You Can Do

- Run reusable workflow bundles from a project catalog, user catalog, example
  directory, package registry, or GitHub workflow URL.
- Use agent backends such as `codex-agent`, `claude-code-agent`,
  `cursor-cli-agent`, `official/openai-sdk`, and `official/anthropic-sdk`.
- Combine agent steps with command, container, sleep, user-action,
  workflow-call, and add-on-backed steps.
- Discover workflow purpose and callable inputs before running anything.
- Run deterministic mock scenarios for demos, tests, and documentation.
- Inspect workflow status, progress, logs, step runs, artifacts, and exported
  session data.
- Resume, continue, or rerun workflow executions.
- Run supervised workflows with retry, stall handling, and auto-improve policy
  controls.
- Serve a local HTTP and GraphQL control plane for browser overview, remote
  execution, and typed manager actions.
- Connect event sources such as webhooks, cron, file changes, S3-style object
  events, sequential lists, Discord Gateway, Telegram Gateway, Matrix, and
  generic Chat SDK adapters.
- Use built-in chat add-ons for persona routing and chat replies.
- Install workflow packages and optional agent skills from Git-backed package
  registries.
- Install hook snippets for Claude Code, Codex, and Gemini.

## Install

Homebrew is the recommended install path for normal use:

```bash
brew tap tacogips/tap
brew install rielflow
rielflow --help
```

The installed binary is `rielflow`.
Built-in add-ons are bundled into the installed command; they do not require a
separate add-on package install.

### Optional LLM Agent Setup

After installing `rielflow`, you can install standard registry skill packages
so an LLM agent can operate rielflow more easily. These commands install from
the default public registry:

```text
https://github.com/tacogips/rielflow-packages
```

For agent-assisted package use, install the package-management skill package.
It teaches agents how to search and install rielflow packages from registries:

```bash
rielflow package install rielflow-package-manager-skill \
  --registry https://github.com/tacogips/rielflow-packages \
  --user-scope \
  --pre-install-check
```

For workflow authors, install the workflow-creator skill package. It helps an
agent create, modify, validate, and run rielflow workflows for any repeatable
or tedious process, such as collecting and analyzing posts, checking a Google
Sheet on a schedule, or notifying a chat channel:

```bash
rielflow package install rielflow-workflow-creator-skill \
  --registry https://github.com/tacogips/rielflow-packages \
  --user-scope \
  --pre-install-check
```

Developers working on rielflow itself may also install the larger
design-and-implement workflow package for their agent. Choose one based on the
agent you use, not both.

Codex:

```bash
rielflow package install codex-design-and-implement-review-loop \
  --registry https://github.com/tacogips/rielflow-packages \
  --user-scope \
  --pre-install-check
```

Claude Code:

```bash
rielflow package install claude-code-design-and-implement-review-loop \
  --registry https://github.com/tacogips/rielflow-packages \
  --user-scope \
  --pre-install-check
```

Agent backends need their own credentials and local tools. For example,
OpenAI-backed nodes use `OPENAI_API_KEY`, Anthropic-backed nodes use
`ANTHROPIC_API_KEY`, and local CLI-backed nodes depend on the corresponding
Codex, Claude Code, or Cursor CLI setup.

Optional Nix install:

```bash
nix run github:tacogips/rielflow -- workflow list
nix profile install github:tacogips/rielflow
```

## Quick Start

List installed or discoverable workflows:

```bash
rielflow workflow list
```

List workflows from a local examples directory:

```bash
rielflow workflow list --workflow-definition-dir ./examples
```

See what a workflow does and what input it expects:

```bash
rielflow workflow usage worker-only-single-step \
  --workflow-definition-dir ./examples
```

Validate a workflow:

```bash
rielflow workflow validate worker-only-single-step \
  --workflow-definition-dir ./examples
```

Run a deterministic example without real agent calls:

```bash
rielflow workflow run worker-only-single-step \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/worker-only-single-step/mock-scenario.json \
  --output json
```

Run a workflow with variables:

```bash
rielflow workflow run design-and-implement-review-loop \
  --workflow-definition-dir ./examples \
  --variables '{"workflowInput":{"request":"Update the README for end users"}}' \
  --output json
```

Use a variables file when the input is larger:

```bash
cat > variables.json <<'JSON'
{
  "workflowInput": {
    "request": "Review the current change, implement the fix, run verification, and report the result."
  }
}
JSON

rielflow workflow run design-and-implement-review-loop \
  --workflow-definition-dir ./examples \
  --variables @./variables.json \
  --output json
```

Inspect a session after a run:

```bash
rielflow session status <workflow-execution-id>
rielflow session progress <workflow-execution-id>
rielflow session logs <workflow-execution-id>
rielflow session export <workflow-execution-id> --file ./rielflow-session.json
```

Start the local server:

```bash
rielflow serve --workflow-definition-dir ./examples
```

Default local URLs:

- Browser overview: `http://127.0.0.1:43173/`
- GraphQL endpoint: `http://127.0.0.1:43173/graphql`

Run a GraphQL query from the CLI:

```bash
rielflow graphql '
  query {
    workflowCatalogOverview {
      workflows {
        name
        description
      }
    }
  }
'
```

## Workflow Locations

Rielflow finds workflows from these places:

- Project catalog: `./.rielflow/workflows/<workflow-name>/workflow.json`
- User catalog: `~/.rielflow/workflows/<workflow-name>/workflow.json`
- Explicit directory: `--workflow-definition-dir ./examples`
- Server manifest: `--workflow-manifest ./workflow-manifest.json`
- Package registry: `workflow run <package> --from-registry`
- GitHub workflow URL: `workflow checkout <url>` or
  `workflow run <url> --from-registry`

Use `--workflow-definition-dir ./examples` for examples and tests. Use the
project or user catalog for workflows you want to keep.

## Package Management

Rielflow has a workflow package manager. Packages are Git-backed workflow
bundles that can also include agent skills. The built-in default registry is:

```text
https://github.com/tacogips/rielflow-packages
```

Use `rielflow package ...` for persistent package lifecycle operations. Direct
workflow checkout remains limited to public GitHub workflow directory URLs via
`rielflow workflow checkout <url>`; package ids are installed with
`rielflow package install <package>`.

Search packages:

```bash
rielflow package search review --refresh
```

Install a package into the current project:

```bash
rielflow package install worker-only-single-step
```

Install a package into the user catalog:

```bash
rielflow package install worker-only-single-step --user-scope
```

Package install validates the staged workflow before it mutates project or user
scope. Validation uses the same scoped workflow visibility the installed
workflow will have: package-local sibling workflows remain visible, the staged
workflow shadows any installed workflow with the same id, project-scope installs
can resolve already installed project and user callees, and user-scope installs
must resolve callees from user-visible roots. Missing `toWorkflowId` callees
still fail before install and report the searched workflow roots.

List installed packages:

```bash
rielflow package list
rielflow package list --scope user --output json
```

Check status and update:

```bash
rielflow package status worker-only-single-step
rielflow package update worker-only-single-step
```

Package updates apply changed package contents, including package-installed
skills, without an extra confirmation prompt. If the selected package has been
removed from the registry, `package update` asks before removing the local
checkout; answer `N` to keep it installed, or pass `--yes` for noninteractive
removal.

Remove a package:

```bash
rielflow package remove worker-only-single-step
rielflow package remove --install-id <install-id>
```

Run a registry workflow without installing it:

```bash
rielflow workflow run worker-only-single-step \
  --from-registry \
  --registry default \
  --output json
```

Install directly from a public GitHub workflow directory:

```bash
rielflow workflow checkout \
  https://github.com/<owner>/<repo>/tree/<ref>/.rielflow/workflows/<workflow-name>
```

Register another package registry:

```bash
rielflow package registry add personal \
  --registry-url https://github.com/<owner>/<repo> \
  --local-path /path/to/local/clone
```

Publish a workflow package:

```bash
rielflow package publish .rielflow/workflows/demo \
  --package-name demo-workflow \
  --registry default \
  --branch main
```

## Examples

Useful starting points in `examples/`:

- `worker-only-single-step`: smallest runnable workflow.
- `design-and-implement-review-loop`: multi-step software design,
  implementation, review, documentation, and commit-message workflow.
- `design-and-implement-review-loop-feature-plan`: planning-focused variant.
- `recent-change-quality-loop`: review recent work and produce a handoff.
- `first-four-arithmetic-pipeline`: multi-stage pipeline with workflow calls and
  command/container-style work.
- `node-combinations-showcase`: reference for command, container, foreach, and
  manager/worker combinations.
- `workflow-call-simple`: compact cross-workflow invocation example.
- `scheduled-sleep`: sleep and scheduled continuation example.
- `supervised-mock-retry`: deterministic supervised retry example.
- `discord-agent-trio-chat`, `telegram-agent-trio-chat`,
  `matrix-agent-trio-chat`: provider-specific persona chat examples.
- `telegram-agent-trio-time-signal`: scheduled Telegram time-signal reply for
  the Telegram trio chat.
- `x-follower-ai-business-digest`: hourly X follower-post digest that fetches
  through Dockerized x-gateway, filters AI/business posts, persists a cursor,
  and posts useful summaries to Telegram.
- `chat-reply-webhook`, `discord-codex-chat`,
  `chat-event-attachment-judgement`: event and chat reply examples.
- `chat-supervisor-collaboration`: chat-triggered multi-workflow collaboration.

Run any example with the same pattern:

```bash
rielflow workflow usage <workflow-name> --workflow-definition-dir ./examples
rielflow workflow validate <workflow-name> --workflow-definition-dir ./examples
rielflow workflow run <workflow-name> \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/<workflow-name>/mock-scenario.json \
  --output json
```

Some examples do not have a standalone `mock-scenario.json` or require event
fixtures. See `examples/README.md` for the full example index.

## LLM Agent Prompts

Paste these prompts into Codex, Claude Code, Gemini, Cursor, or another coding
agent when you want the agent to use Rielflow without extra explanation.

### Choose And Run A Workflow

```text
Use rielflow for this task.

Goal:
<describe the user goal here>

Instructions:
1. First discover available workflows:
   rielflow workflow usage --output json
2. If the project uses local examples or a custom workflow directory, include:
   --workflow-definition-dir ./examples
   or the appropriate workflow root.
3. Choose the workflow whose description and callable input best match the goal.
4. Inspect and validate the selected workflow:
   rielflow workflow usage <workflow-name> --output json
   rielflow workflow validate <workflow-name>
5. Create a variables JSON object that matches the workflow usage output.
6. Run the workflow:
   rielflow workflow run <workflow-name> --variables @./variables.json --output json
7. Capture the workflowExecutionId or sessionId from the output.
8. Inspect the result:
   rielflow session status <workflow-execution-id>
   rielflow session progress <workflow-execution-id>
   rielflow session logs <workflow-execution-id>
9. If the workflow fails or stalls, inspect logs and step runs before deciding
   whether to rerun, continue, or ask the user for input.
10. Report the workflow chosen, command run, final status, important outputs,
    and any follow-up needed.
```

### Use Rielflow For Coding Work

```text
Use rielflow to run a structured coding workflow.

Coding request:
<paste the engineering task>

Preferred workflow:
design-and-implement-review-loop

Create variables.json with:
{
  "workflowInput": {
    "request": "<paste the engineering task>",
    "constraints": [
      "Do not revert unrelated user changes.",
      "Keep changes focused.",
      "Run relevant verification commands.",
      "Report files changed and verification results."
    ]
  }
}

Run:
rielflow workflow run design-and-implement-review-loop \
  --variables @./variables.json \
  --output json

If the workflow is in a local examples directory, add:
--workflow-definition-dir ./examples

After the run, inspect:
rielflow session status <workflow-execution-id>
rielflow session progress <workflow-execution-id>
rielflow session logs <workflow-execution-id>

If the workflow returns a commit message, do not commit unless the user asked
for a commit.
```

### Run A Local Example Workflow

```text
Use the rielflow examples in this repository.

Task:
<describe the task>

Commands to start:
rielflow workflow list --workflow-definition-dir ./examples
rielflow workflow usage --workflow-definition-dir ./examples --output json

Then:
1. Pick the best example workflow for the task.
2. Validate it with --workflow-definition-dir ./examples.
3. Build variables in a JSON file when needed.
4. Run it:
   rielflow workflow run <workflow-name> \
     --workflow-definition-dir ./examples \
     --variables @./variables.json \
     --output json
5. If a bundled mock scenario is appropriate, use:
   --mock-scenario ./examples/<workflow-name>/mock-scenario.json
6. Inspect the session with session status, progress, logs, and export.
7. Summarize the final workflow output for the user.
```

### Install Or Run A Workflow Package

```text
Use rielflow package management.

Task:
<describe the workflow capability needed>

Steps:
1. Search packages:
   rielflow package search "<keyword>" --refresh
2. If a temporary run is safe for the task, run the package without installing:
   rielflow workflow run <package-id> --from-registry --output json
3. If installation is needed, install to project scope:
   rielflow package install <package-id> --pre-install-check
4. List installed packages:
   rielflow package list
5. Run the installed workflow:
   rielflow workflow usage <workflow-name>
   rielflow workflow run <workflow-name> --variables @./variables.json --output json
6. Report which package was used, where it was installed, and the final run
   status.
```

### Operate An Existing Session

```text
Use rielflow to inspect and operate this existing workflow session.

Workflow execution id:
<workflow-execution-id>

Steps:
1. Read current state:
   rielflow session status <workflow-execution-id>
   rielflow session progress <workflow-execution-id>
   rielflow session step-runs <workflow-execution-id>
2. If the user asks what happened, inspect logs:
   rielflow session logs <workflow-execution-id>
3. If the session is paused and can continue with its stored state, resume:
   rielflow session resume <workflow-execution-id>
4. If a specific failed step should be retried from variables only, rerun:
   rielflow session rerun <workflow-execution-id> <step-id>
5. If execution should continue after a concrete prior step run, use:
   rielflow session continue <workflow-execution-id> \
     --start-step <step-id> \
     --after-step-run <step-run-id>
6. Export the session when a durable handoff is useful:
   rielflow session export <workflow-execution-id> --file ./rielflow-session.json
```

### Use The Local Server And GraphQL

```text
Use rielflow through its local server.

Start the server if it is not already running:
rielflow serve --workflow-definition-dir ./examples

Use the browser overview at:
http://127.0.0.1:43173/

Use GraphQL at:
http://127.0.0.1:43173/graphql

For CLI GraphQL calls, use:
rielflow graphql '<GraphQL document>' \
  --endpoint http://127.0.0.1:43173/graphql \
  --variables @./variables.json

Prefer typed GraphQL manager actions when operating an active rielflow-managed
session instead of encoding control actions only in prose.
```

## Hooks

Print a hook snippet for an agent runtime:

```bash
rielflow hook snippet --vendor codex
rielflow hook snippet --vendor claude-code
rielflow hook snippet --vendor gemini
```

Run the hook handler:

```bash
rielflow hook --vendor codex
```

## Optional: Development From Source

Normal users should use the Homebrew-installed `rielflow` binary. Source-tree
commands are only for contributors working inside this repository.

Install dependencies:

```bash
bun install
```

Run the CLI from source when developing the CLI itself:

```bash
bun run packages/rielflow/src/bin.ts --help
```

Run repository checks:

```bash
bun run build
bun run typecheck
bun run lint:biome
bun run test
```

The Nix development shell also provides repository tooling such as `gitleaks`
and pre-commit hook setup:

```bash
nix develop
task install-git-hooks
```

## Package Architecture

This repository is a Bun workspace. The root package is private and coordinates
runtime packages under `packages/*`.

- `rielflow`: CLI binary and public compatibility facade.
- `rielflow-core`: core workflow runtime, validation, catalog, sessions, and
  library contracts.
- `rielflow-addons`: built-in node add-ons and native add-on helpers.
- `rielflow-adapters`: agent backend adapters.
- `rielflow-events`: external event contracts and runtime ports.
- `rielflow-graphql`: GraphQL contracts and DTOs.
- `rielflow-server`: HTTP server transport contracts.
- `rielflow-hook`: agent hook parsing and recording support.

## More References

- `examples/README.md`: detailed example index.
- `examples/event-sources/README.md`: local event-source demos.
- `examples/auto-improve/README.md`: supervised retry and auto-improve demos.
- `packaging/homebrew/README.md`: release archive and Homebrew formula workflow.
- `design-docs/`: architecture and feature design notes.
- `impl-plans/`: implementation plans and progress records.
