import {
  type ColorInput,
  type KeyEvent,
  type OptimizedBuffer,
  parseColor,
  type RGBA,
  SelectRenderable,
  type SelectOption,
} from "@opentui/core";

export interface OpenTuiPaneWidthSpec {
  readonly minWidth: number;
  readonly width: `${number}%`;
}

export const OPEN_TUI_MAIN_PANE_LAYOUT = {
  details: { width: "30%", minWidth: 0 },
  nodes: { width: "22%", minWidth: 18 },
  sessions: { width: "28%", minWidth: 18 },
  workflows: { width: "20%", minWidth: 16 },
} as const satisfies Readonly<Record<string, OpenTuiPaneWidthSpec>>;

export interface OpenTuiFocusableTarget {
  focus(): void;
}

export interface OpenTuiSelectTheme {
  readonly descriptionColor: string;
  readonly itemSpacing: number;
  readonly selectedBackgroundColor: string;
  readonly selectedDescriptionColor: string;
  readonly selectedTextColor: string;
}

export const OPEN_TUI_SELECT_THEMES = {
  detailSummary: {
    descriptionColor: "#89a5ba",
    itemSpacing: 2,
    selectedBackgroundColor: "#1f3447",
    selectedDescriptionColor: "#d8e5f2",
    selectedTextColor: "#f7d774",
  },
  historyNodes: {
    descriptionColor: "#8eb49a",
    itemSpacing: 1,
    selectedBackgroundColor: "#243a2d",
    selectedDescriptionColor: "#dff0e4",
    selectedTextColor: "#e8f29a",
  },
  historySessions: {
    descriptionColor: "#89a5ba",
    itemSpacing: 1,
    selectedBackgroundColor: "#1f3447",
    selectedDescriptionColor: "#d8e5f2",
    selectedTextColor: "#f7d774",
  },
} as const satisfies Readonly<Record<string, OpenTuiSelectTheme>>;

export const OPEN_TUI_NODE_TYPE_COLORS = {
  agent: "#8eb49a",
  command: "#d8b06a",
  container: "#89a5ba",
  "user-action": "#c89db8",
  unknown: "#c7d3de",
} as const;

export const OPEN_TUI_NODE_KIND_COLORS = {
  input: "#78d381",
  output: "#f7d774",
  "root-manager": "#d697ff",
  "subworkflow-manager": "#7fc8ff",
  task: "#dff0e4",
  unknown: "#c7d3de",
} as const;

export const OPEN_TUI_STATUS_COLORS = {
  cancelled: "#c89db8",
  completed: "#78d381",
  failed: "#ff8a7a",
  pending: "#89a5ba",
  running: "#7fc8ff",
  skipped: "#c7d3de",
  succeeded: "#78d381",
  timed_out: "#f7d774",
  unknown: "#c7d3de",
} as const;

export const OPEN_TUI_WORKFLOW_SCOPE_COLORS = {
  branch: "#7fc8ff",
  default: "#89a5ba",
  group: "#d8b06a",
  loop: "#c89db8",
} as const;

export interface OpenTuiRichSelectOption extends SelectOption {
  readonly detailLineColors?: readonly (ColorInput | undefined)[];
  readonly detailLines?: readonly string[];
  readonly labelText?: string;
  readonly statusColor?: ColorInput;
  readonly statusLabel?: string;
  readonly textColor?: ColorInput;
}

export function resolveOpenTuiNodeTypeColor(
  nodeType: string | undefined,
): string {
  return (
    OPEN_TUI_NODE_TYPE_COLORS[
      (nodeType ?? "agent") as keyof typeof OPEN_TUI_NODE_TYPE_COLORS
    ] ?? OPEN_TUI_NODE_TYPE_COLORS.unknown
  );
}

export function resolveOpenTuiNodeKindColor(kind: string | undefined): string {
  return (
    OPEN_TUI_NODE_KIND_COLORS[
      (kind ?? "task") as keyof typeof OPEN_TUI_NODE_KIND_COLORS
    ] ?? OPEN_TUI_NODE_KIND_COLORS.unknown
  );
}

export function resolveOpenTuiStatusColor(status: string | undefined): string {
  return (
    OPEN_TUI_STATUS_COLORS[
      (status ?? "unknown") as keyof typeof OPEN_TUI_STATUS_COLORS
    ] ?? OPEN_TUI_STATUS_COLORS.unknown
  );
}

export function resolveOpenTuiWorkflowScopeColor(
  derivedColor: string | undefined,
): string {
  if (typeof derivedColor === "string") {
    if (derivedColor.startsWith("loop:")) {
      return OPEN_TUI_WORKFLOW_SCOPE_COLORS.loop;
    }
    if (derivedColor.startsWith("branch:")) {
      return OPEN_TUI_WORKFLOW_SCOPE_COLORS.branch;
    }
    if (derivedColor.startsWith("group:")) {
      return OPEN_TUI_WORKFLOW_SCOPE_COLORS.group;
    }
  }
  return OPEN_TUI_WORKFLOW_SCOPE_COLORS.default;
}

interface BlurredSelectIndicatorLayout {
  readonly fontHeight: number;
  readonly linesPerItem: number;
  readonly maxVisibleItems: number;
  readonly scrollOffset: number;
  readonly selectedIndex: number;
  readonly selectedOption: SelectOption;
  readonly showDescription: boolean;
}

interface FocusAwareSelectPrivateState {
  readonly _backgroundColor: RGBA;
  readonly _descriptionColor: RGBA;
  readonly _font: string | undefined;
  readonly _focusedBackgroundColor: RGBA;
  readonly _focusedTextColor: RGBA;
  readonly _itemSpacing: number;
  readonly _options: readonly SelectOption[];
  readonly _selectedIndex: number;
  readonly _selectedBackgroundColor: RGBA;
  readonly _selectedDescriptionColor: RGBA;
  readonly _selectedTextColor: RGBA;
  readonly _showDescription: boolean;
  readonly _textColor: RGBA;
  readonly fontHeight: number;
  readonly linesPerItem: number;
  readonly maxVisibleItems: number;
  readonly scrollOffset: number;
}

interface BlurredSelectRedrawTarget {
  readonly descriptionY: number | undefined;
  readonly name: string;
  readonly nameY: number;
}

export function resolveBlurredSelectRedrawTarget(
  input: BlurredSelectIndicatorLayout,
): BlurredSelectRedrawTarget | undefined {
  const visibleIndex = input.selectedIndex - input.scrollOffset;
  if (visibleIndex < 0 || visibleIndex >= input.maxVisibleItems) {
    return undefined;
  }
  const nameY = visibleIndex * input.linesPerItem;
  return {
    descriptionY: input.showDescription ? nameY + input.fontHeight : undefined,
    name: `  ${input.selectedOption.name}`,
    nameY,
  };
}

export class FocusAwareSelectRenderable extends SelectRenderable {
  protected override renderSelf(
    buffer: OptimizedBuffer,
    deltaTime: number,
  ): void {
    super.renderSelf(buffer, deltaTime);
    this.redrawRichOptions();
    this.hideSelectionArrowWhenBlurred();
  }

  private redrawRichOptions(): void {
    if (this.frameBuffer === null) {
      return;
    }
    const state = this as unknown as FocusAwareSelectPrivateState;
    if (state._font !== undefined) {
      return;
    }
    const visibleOptions = state._options.slice(
      state.scrollOffset,
      state.scrollOffset + state.maxVisibleItems,
    );
    visibleOptions.forEach((option, visibleIndex) => {
      if (!this.isRichSelectOption(option)) {
        return;
      }
      this.redrawSelectOption({
        hideSelection: !this.focused,
        option,
        state,
        visibleIndex,
      });
    });
  }

  private hideSelectionArrowWhenBlurred(): void {
    if (this.focused || this.frameBuffer === null) {
      return;
    }
    const state = this as unknown as FocusAwareSelectPrivateState;
    if (state._options.length === 0 || state._font !== undefined) {
      return;
    }
    const selectedOption = state._options[state._selectedIndex];
    if (selectedOption === undefined) {
      return;
    }
    if (this.isRichSelectOption(selectedOption)) {
      this.redrawSelectOption({
        hideSelection: true,
        option: selectedOption,
        state,
        visibleIndex: state._selectedIndex - state.scrollOffset,
      });
      return;
    }
    const redrawTarget = resolveBlurredSelectRedrawTarget({
      fontHeight: state.fontHeight,
      linesPerItem: state.linesPerItem,
      maxVisibleItems: state.maxVisibleItems,
      scrollOffset: state.scrollOffset,
      selectedIndex: state._selectedIndex,
      selectedOption,
      showDescription: state._showDescription,
    });
    if (redrawTarget === undefined || redrawTarget.nameY >= this.height) {
      return;
    }
    this.frameBuffer.fillRect(
      0,
      redrawTarget.nameY,
      this.width,
      Math.min(state.linesPerItem, this.height - redrawTarget.nameY),
      state._backgroundColor,
    );
    this.frameBuffer.drawText(
      redrawTarget.name,
      1,
      redrawTarget.nameY,
      state._textColor,
    );
    if (
      redrawTarget.descriptionY !== undefined &&
      redrawTarget.descriptionY < this.height
    ) {
      this.frameBuffer.drawText(
        selectedOption.description,
        3,
        redrawTarget.descriptionY,
        state._descriptionColor,
      );
    }
  }

  private isRichSelectOption(
    option: SelectOption,
  ): option is OpenTuiRichSelectOption {
    return (
      ("detailLines" in option &&
        Array.isArray((option as OpenTuiRichSelectOption).detailLines)) ||
      ("textColor" in option &&
        (option as OpenTuiRichSelectOption).textColor !== undefined)
    );
  }

  private redrawSelectOption(input: {
    readonly hideSelection: boolean;
    readonly option: OpenTuiRichSelectOption;
    readonly state: FocusAwareSelectPrivateState;
    readonly visibleIndex: number;
  }): void {
    if (
      this.frameBuffer === null ||
      input.visibleIndex < 0 ||
      input.visibleIndex >= input.state.maxVisibleItems
    ) {
      return;
    }
    const actualIndex = input.state.scrollOffset + input.visibleIndex;
    const itemY = input.visibleIndex * input.state.linesPerItem;
    if (itemY >= this.height) {
      return;
    }
    const baseBackground = this.focused
      ? input.state._focusedBackgroundColor
      : input.state._backgroundColor;
    const isSelected =
      !input.hideSelection && actualIndex === input.state._selectedIndex;
    const rowBackground = isSelected
      ? input.state._selectedBackgroundColor
      : baseBackground;
    this.frameBuffer.fillRect(
      0,
      itemY,
      this.width,
      Math.min(input.state.linesPerItem, this.height - itemY),
      rowBackground,
    );

    const baseTextColor = this.focused
      ? input.state._focusedTextColor
      : input.state._textColor;
    const nameColor = isSelected
      ? input.state._selectedTextColor
      : parseColor(input.option.textColor ?? baseTextColor);
    const indicator = isSelected ? "▶ " : "  ";
    const labelText = input.option.labelText ?? input.option.name;
    this.frameBuffer.drawText(indicator, 1, itemY, nameColor);
    this.frameBuffer.drawText(labelText, 3, itemY, nameColor);
    if (input.option.statusLabel !== undefined) {
      const statusColor = parseColor(
        input.option.statusColor ?? input.state._selectedTextColor,
      );
      this.frameBuffer.drawText(
        `[${input.option.statusLabel}]`,
        3 + labelText.length + 2,
        itemY,
        statusColor,
      );
    }

    const detailLines = input.option.detailLines ?? [input.option.description];
    const defaultDetailColor = isSelected
      ? input.state._selectedDescriptionColor
      : input.state._descriptionColor;
    detailLines
      .slice(0, Math.max(0, input.state.linesPerItem - 1))
      .forEach((line, index) => {
        const y = itemY + input.state.fontHeight * (index + 1);
        if (y >= this.height) {
          return;
        }
        this.frameBuffer?.drawText(
          line,
          3,
          y,
          parseColor(
            input.option.detailLineColors?.[index] ?? defaultDetailColor,
          ),
        );
      });
  }
}

export function popupBackgroundColor(): string {
  return "#0d141b";
}

export function focusOpenTuiTarget(target: OpenTuiFocusableTarget): void {
  target.focus();
}

export const selectJkBindings = [
  { name: "j", action: "move-down" as const },
  { name: "k", action: "move-up" as const },
] as const;

export type ShortcutKeyEvent = Pick<
  KeyEvent,
  "ctrl" | "meta" | "name" | "shift"
>;
