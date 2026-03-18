import type { CliIo } from "../cli";

interface BlessedNode {
  key: (keys: string | readonly string[], handler: () => void) => void;
}

interface BlessedScreen extends BlessedNode {
  append: (node: BlessedNode) => void;
  destroy: () => void;
  render: () => void;
}

interface BlessedList extends BlessedNode {
  setItems: (items: readonly string[]) => void;
  focus: () => void;
  select: (index: number) => void;
  up: (step: number) => void;
  down: (step: number) => void;
  getItemIndex: (item: unknown) => number;
  selected?: unknown;
}

interface BlessedFactory {
  screen: (options: Record<string, unknown>) => BlessedScreen;
  box: (options: Record<string, unknown>) => BlessedNode;
  list: (options: Record<string, unknown>) => BlessedList;
}

export interface NeoBlessedWorkflowSelection {
  readonly type: "selected" | "quit";
  readonly workflowName?: string;
}

async function loadBlessedFactory(): Promise<BlessedFactory> {
  const dynamicImport = new Function(
    "moduleName",
    "return import(moduleName);",
  ) as (moduleName: string) => Promise<unknown>;
  const module = (await dynamicImport("neo-blessed")) as BlessedFactory;
  return module;
}

export function resolveSelectedWorkflowName(
  selectedIndex: number,
  workflowNames: readonly string[],
): string | undefined {
  if (selectedIndex < 0 || selectedIndex >= workflowNames.length) {
    return undefined;
  }
  return workflowNames[selectedIndex];
}

export async function renderNeoBlessedWorkflowSelector(options: {
  workflowNames: readonly string[];
  refreshWorkflowNames: () => Promise<readonly string[]>;
  io: CliIo;
}): Promise<NeoBlessedWorkflowSelection> {
  const blessed = await loadBlessedFactory();
  const screen = blessed.screen({
    smartCSR: true,
    title: "divedra tui",
  });

  const left = blessed.box({
    parent: screen,
    label: " Workflows ",
    border: "line",
    width: "30%",
    height: "70%",
    left: 0,
    top: 0,
  });

  blessed.box({
    parent: screen,
    label: " Timeline ",
    border: "line",
    width: "40%",
    height: "70%",
    left: "30%",
    top: 0,
    content: "Execution timeline will appear after run starts.",
  });

  blessed.box({
    parent: screen,
    label: " Details ",
    border: "line",
    width: "30%",
    height: "70%",
    left: "70%",
    top: 0,
    content: "Select workflow with j/k and press enter.",
  });

  blessed.box({
    parent: screen,
    label: " Logs / Keys ",
    border: "line",
    width: "100%",
    height: "30%",
    left: 0,
    top: "70%",
    content: "j/k: move  enter: select  r: refresh  q: quit",
  });

  const list = blessed.list({
    parent: left,
    keys: true,
    vi: true,
    mouse: true,
    width: "100%-2",
    height: "100%-2",
    top: 1,
    left: 1,
    border: "line",
    style: {
      selected: {
        bg: "blue",
      },
    },
    items: [],
  });

  const updateWorkflows = (names: readonly string[]): void => {
    list.setItems(names.length > 0 ? names : ["(no workflows found)"]);
    list.select(0);
    screen.render();
  };

  let workflowNames = [...options.workflowNames];
  updateWorkflows(workflowNames);
  list.focus();

  const complete = (
    result: NeoBlessedWorkflowSelection,
  ): NeoBlessedWorkflowSelection => {
    screen.destroy();
    return result;
  };

  return await new Promise<NeoBlessedWorkflowSelection>((resolve) => {
    screen.key(["q", "C-c"], () => {
      resolve(complete({ type: "quit" }));
    });

    screen.key(["j"], () => {
      list.down(1);
      screen.render();
    });

    screen.key(["k"], () => {
      list.up(1);
      screen.render();
    });

    screen.key(["r"], async () => {
      try {
        workflowNames = [...(await options.refreshWorkflowNames())];
        updateWorkflows(workflowNames);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        options.io.stderr(`tui refresh failed: ${message}`);
      }
    });

    screen.key(["enter"], () => {
      const selectedIndex = list.getItemIndex(list.selected ?? null);
      const selectedWorkflowName = resolveSelectedWorkflowName(
        selectedIndex,
        workflowNames,
      );
      if (selectedWorkflowName === undefined) {
        return;
      }
      resolve(
        complete({ type: "selected", workflowName: selectedWorkflowName }),
      );
    });

    screen.render();
  });
}
