import { Show, type JSX } from "solid-js";

import type { UiConfigResponse } from "../../../../src/shared/ui-contract";
import { Badge, Button, StatCard } from "./ui";

export interface AppShellProps {
  readonly config: UiConfigResponse | null;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly errorMessage: string;
  readonly infoMessage: string;
  readonly workflowCount: number;
  readonly sessionCount: number;
  readonly selectedWorkflowName: string;
  readonly onReload: () => void | Promise<void>;
  readonly sidebar: JSX.Element;
  readonly editor: JSX.Element;
  readonly execution: JSX.Element;
}

export default function AppShell(props: AppShellProps): JSX.Element {
  const reloadDisabled = (): boolean => props.loading || props.busy;
  const lede =
    "A workflow workbench with structured editing, execution telemetry, and tighter operator-facing controls.";

  return (
    <div class="page shell-page">
      <header class="hero hero-surface">
        <div class="hero-copy">
          <p class="eyebrow">Workflow Control Room</p>
          <h1>divedra Workflow Editor</h1>
          <p class="lede">{lede}</p>
          <div class="hero-badges">
            <Show when={props.loading}>
              <Badge variant="outline">Loading workspace</Badge>
            </Show>
            <Show when={!props.loading && props.workflowCount === 0}>
              <Badge variant="secondary">Create your first workflow</Badge>
            </Show>
            <Show
              when={
                !props.loading &&
                props.workflowCount > 0 &&
                props.selectedWorkflowName.length === 0
              }
            >
              <Badge variant="outline">Select a workflow to begin</Badge>
            </Show>
            <Show when={props.selectedWorkflowName.length > 0}>
              <Badge variant="outline">{props.selectedWorkflowName}</Badge>
            </Show>
          </div>
          <Show when={!props.loading && props.workflowCount === 0}>
            <p class="hero-hint">
              Create a workflow from the sidebar to unlock editing, validation,
              and execution.
            </p>
          </Show>
          <Show
            when={
              !props.loading &&
              props.workflowCount > 0 &&
              props.selectedWorkflowName.length === 0
            }
          >
            <p class="hero-hint">
              Select a workflow to inspect its graph, validation state, and
              execution history.
            </p>
          </Show>
        </div>
        <div class="hero-rail">
          <div class="hero-stats">
            <StatCard
              label="Workflows"
              value={String(props.workflowCount)}
              detail="Available definitions"
            />
            <StatCard
              label="Sessions"
              value={String(props.sessionCount)}
              detail="Loaded in sidebar"
            />
            <StatCard
              label="Mode"
              value={props.config?.readOnly ? "Read only" : "Editable"}
              detail={
                props.config?.fixedWorkflowName
                  ? `Fixed to ${props.config.fixedWorkflowName}`
                  : "Workflow selection unlocked"
              }
            />
          </div>
          <Button
            variant="outline"
            type="button"
            onClick={() => void props.onReload()}
            disabled={reloadDisabled()}
          >
            Reload
          </Button>
        </div>
      </header>

      <Show when={props.config}>
        {(config) => (
          <section class="modes panel-strip">
            <Show when={config().fixedWorkflowName?.length}>
              {(workflowName) => (
                <Badge>Fixed workflow: {workflowName()}</Badge>
              )}
            </Show>
            <Show when={config().readOnly}>
              <Badge variant="destructive">Read-only</Badge>
            </Show>
            <Show when={config().noExec}>
              <Badge variant="destructive">Execution disabled</Badge>
            </Show>
            <Badge variant="outline">Frontend mode: {config().frontend}</Badge>
          </section>
        )}
      </Show>

      <Show when={props.errorMessage.length > 0}>
        <p class="message error">{props.errorMessage}</p>
      </Show>

      <Show when={props.infoMessage.length > 0}>
        <p class="message info">{props.infoMessage}</p>
      </Show>

      <main class="layout">
        {props.sidebar}
        {props.editor}
        {props.execution}
      </main>
    </div>
  );
}
