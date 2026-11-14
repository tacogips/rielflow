import type { LoadedWorkflow } from "../../workflow/load";
import type {
  NodeExecutionRecord,
  WorkflowSessionState,
} from "../../workflow/session";
import type {
  RuntimeNodeExecutionSummary,
  RuntimeNodeLogEntry,
  RuntimeSessionSummary,
} from "../../workflow/runtime-db";
import type {
  ArgumentBinding,
  CliAgentBackend,
  NodePayload,
} from "../../workflow/types";

export interface RuntimeSessionView {
  readonly session: WorkflowSessionState;
  readonly nodeExecutions: readonly RuntimeNodeExecutionSummary[];
  readonly nodeLogs: readonly RuntimeNodeLogEntry[];
}

export type TuiWorkflowInputMode = "json" | "text";

export interface TuiWorkflowInputDetection {
  readonly mode: TuiWorkflowInputMode;
  readonly reason: string;
}

export interface TuiWorkflowInputSyntax {
  readonly column?: number;
  readonly line?: number;
  readonly status: "not-applicable" | "valid" | "valid-empty" | "invalid";
  readonly summary: string;
}

export type FocusPane =
  | "definition"
  | "detail"
  | "input"
  | "nodes"
  | "sessions"
  | "workflows";

export type DetailMode =
  | "inbox"
  | "manager"
  | "outbox"
  | "session-logs"
  | "summary"
  | "viewer";

export type DetailReturnPane = "nodes" | "sessions";

export type ScreenMode = "definition" | "history" | "run" | "workspace";

export type HistoryPaneNavigationMode = "list" | "scroll" | "typing";

export type HistoryViewMode = "subworkflow" | "workflow";

export interface OpenTuiNavigationState {
  readonly detailMode: DetailMode;
  readonly detailReturnPane: DetailReturnPane;
  readonly editingInput: boolean;
  readonly focusPane: FocusPane;
  readonly historyViewMode: HistoryViewMode;
  readonly screenMode: ScreenMode;
}

export interface OpenTuiShortcutEntry {
  readonly compactLabel?: string;
  readonly helpLabel: string;
}

export interface OpenTuiShortcutSection {
  readonly entries: readonly OpenTuiShortcutEntry[];
}

export type OpenTuiDirectionalAction =
  | {
      readonly kind: "close-subworkflow";
    }
  | {
      readonly kind: "focus";
      readonly focusPane: FocusPane;
      readonly nextDetailMode?: DetailMode;
      readonly status: string;
    }
  | {
      readonly kind: "none";
    }
  | {
      readonly kind: "open-definition";
    }
  | {
      readonly kind: "open-history";
    }
  | {
      readonly kind: "open-workspace";
    }
  | {
      readonly kind: "open-subworkflow";
    };

export type OpenTuiHistoryAdvanceAction =
  | {
      readonly focusAfterSessionLoad: "detail";
      readonly kind: "load-session-selection";
    }
  | {
      readonly kind: "load-node-selection";
    }
  | {
      readonly kind: "none";
    }
  | {
      readonly kind: "open-detail-summary-selection";
    }
  | {
      readonly kind: "start-input-editing";
    };

export type OpenTuiHistoryRevertAction =
  | {
      readonly kind: "finish-input-editing";
      readonly status: string;
    }
  | {
      readonly kind: "focus";
      readonly focusPane: FocusPane;
      readonly nextDetailMode: DetailMode;
      readonly status: string;
    }
  | {
      readonly kind: "none";
    };

export type OpenTuiPopupKind =
  | "agent-session"
  | "delete-history-confirm"
  | "filter"
  | "help"
  | "node-definition"
  | "none"
  | "run-confirm";

export type OpenTuiPopupConfirmAction =
  | {
      readonly kind: "apply-filter";
    }
  | {
      readonly kind: "confirm-delete-history";
    }
  | {
      readonly kind: "confirm-run";
    }
  | {
      readonly kind: "none";
    };

export type OpenTuiPopupRevertAction =
  | {
      readonly kind: "cancel-filter";
    }
  | {
      readonly kind: "close-agent-session";
    }
  | {
      readonly kind: "close-node-definition";
    }
  | {
      readonly kind: "close-help";
    }
  | {
      readonly kind: "close-confirm-popup";
    }
  | {
      readonly kind: "none";
    };

export type OpenTuiPopupScrollDelta = -1 | 0 | 1;

export interface OpenTuiCopyTarget {
  readonly label: string;
  readonly value: string;
}

export interface OpenTuiCopyTargetInput {
  readonly focusPane: FocusPane;
  readonly loadedWorkflowId?: string;
  readonly screenMode: ScreenMode;
  readonly selectedNodeExecutionId?: string;
  readonly selectedSessionId?: string;
  readonly selectedSubworkflowId?: string;
  readonly selectedWorkflowName?: string;
  readonly selectedWorkflowNodeId?: string;
}

export interface OpenTuiPaneChrome {
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly title: string;
}

export interface OpenTuiPaneChromeState {
  readonly detail: OpenTuiPaneChrome;
  readonly historyHeader: OpenTuiPaneChrome;
  readonly input: OpenTuiPaneChrome;
  readonly node: OpenTuiPaneChrome;
  readonly runStatus: OpenTuiPaneChrome;
  readonly runWorkflow: OpenTuiPaneChrome;
  readonly selectorPreview: OpenTuiPaneChrome;
  readonly session: OpenTuiPaneChrome;
  readonly workflow: OpenTuiPaneChrome;
  readonly workspaceHistory: OpenTuiPaneChrome;
  readonly workflowDefinition: OpenTuiPaneChrome;
  readonly workflowDefinitionNodes: OpenTuiPaneChrome;
}

export interface HistoryPaneLabels {
  readonly header: string;
  readonly left: string;
  readonly right: string;
}

export interface DetailJsonViewerSelection {
  readonly body: string;
  readonly kind: "json-viewer";
  readonly title: string;
}

export interface DetailAgentSessionSelection {
  readonly available: boolean;
  readonly backend?: CliAgentBackend;
  readonly kind: "agent-session";
  readonly sessionId?: string;
  readonly title: string;
}

export interface NodeDetailArtifactBundle {
  readonly artifactInput: string | null;
  readonly artifactOutput: string | null;
  readonly artifactMeta: string | null;
  readonly mailboxMeta: string | null;
  readonly mailboxInput: string | null;
  readonly mailboxOutput: string | null;
}

export interface ShortcutKeyLike {
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly name: string;
  readonly shift: boolean;
}

export const OPEN_TUI_EMPTY_SELECT_VALUE = "__opentui_empty__";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDetailJsonViewerSelection(
  value: unknown,
): value is DetailJsonViewerSelection {
  return (
    isRecord(value) &&
    value["kind"] === "json-viewer" &&
    typeof value["title"] === "string" &&
    typeof value["body"] === "string"
  );
}

export function isDetailAgentSessionSelection(
  value: unknown,
): value is DetailAgentSessionSelection {
  return (
    isRecord(value) &&
    value["kind"] === "agent-session" &&
    typeof value["title"] === "string" &&
    typeof value["available"] === "boolean" &&
    (value["backend"] === undefined ||
      value["backend"] === "codex-agent" ||
      value["backend"] === "claude-code-agent") &&
    (value["sessionId"] === undefined || typeof value["sessionId"] === "string")
  );
}

export type {
  ArgumentBinding,
  CliAgentBackend,
  LoadedWorkflow,
  NodeExecutionRecord,
  NodePayload,
  RuntimeNodeLogEntry,
  RuntimeSessionSummary,
};
