import type {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  TextareaRenderable,
} from "@opentui/core";
import {
  BoxRenderable as BoxRenderableClass,
  ScrollBoxRenderable as ScrollBoxRenderableClass,
  TextRenderable as TextRenderableClass,
  TextareaRenderable as TextareaRenderableClass,
} from "@opentui/core";
import {
  Dynamic,
  extend,
  type BoxProps,
  type ExtendedComponentProps,
  type ScrollBoxProps,
  type TextareaProps,
  type TextProps,
} from "@opentui/solid";
import { FocusAwareSelectRenderable } from "./opentui-view-shared";

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    focus_select: typeof FocusAwareSelectRenderable;
    ot_box: typeof BoxRenderableClass;
    ot_scrollbox: typeof ScrollBoxRenderableClass;
    ot_text: typeof TextRenderableClass;
    ot_textarea: typeof TextareaRenderableClass;
  }
}

extend({
  focus_select: FocusAwareSelectRenderable,
  ot_box: BoxRenderableClass,
  ot_scrollbox: ScrollBoxRenderableClass,
  ot_text: TextRenderableClass,
  ot_textarea: TextareaRenderableClass,
});

type FocusSelectProps = ExtendedComponentProps<
  typeof FocusAwareSelectRenderable
>;

export function Box(props: BoxProps) {
  return <Dynamic component="ot_box" {...props} />;
}

export function FocusSelect(props: FocusSelectProps) {
  return <Dynamic component="focus_select" {...props} />;
}

export function ScrollBox(props: ScrollBoxProps) {
  return <Dynamic component="ot_scrollbox" {...props} />;
}

export function Text(props: TextProps) {
  return <Dynamic component="ot_text" {...props} />;
}

export function Textarea(props: TextareaProps) {
  return <Dynamic component="ot_textarea" {...props} />;
}

export interface OpenTuiMainViewRefs {
  agentSessionPopup?: ScrollBoxRenderable;
  agentSessionPopupText?: TextRenderable;
  breadcrumbText?: TextRenderable;
  confirmPopup?: BoxRenderable;
  confirmText?: TextRenderable;
  definitionScreen?: BoxRenderable;
  detailScroll?: ScrollBoxRenderable;
  detailSummaryHeader?: TextRenderable;
  detailSummarySelect?: FocusAwareSelectRenderable;
  detailText?: TextRenderable;
  filterPopup?: BoxRenderable;
  filterTextarea?: TextareaRenderable;
  helpPopup?: BoxRenderable;
  helpText?: TextRenderable;
  historyHeaderBox?: BoxRenderable;
  historyHeaderText?: TextRenderable;
  historyScreen?: BoxRenderable;
  inputRow?: BoxRenderable;
  inputShell?: BoxRenderable;
  inputTextarea?: TextareaRenderable;
  nodeDefinitionPopup?: ScrollBoxRenderable;
  nodeDefinitionPopupText?: TextRenderable;
  nodePane?: BoxRenderable;
  nodeSelect?: FocusAwareSelectRenderable;
  runStatusPane?: ScrollBoxRenderable;
  runStatusText?: TextRenderable;
  runTopRow?: BoxRenderable;
  runWorkflowPane?: ScrollBoxRenderable;
  runWorkflowText?: TextRenderable;
  selectorPreviewScroll?: ScrollBoxRenderable;
  selectorPreviewText?: TextRenderable;
  selectorRow?: BoxRenderable;
  sessionPane?: BoxRenderable;
  sessionSelect?: FocusAwareSelectRenderable;
  workflowPane?: BoxRenderable;
  workflowDefinitionNodePane?: BoxRenderable;
  workflowDefinitionNodeSelect?: FocusAwareSelectRenderable;
  workflowDefinitionPane?: ScrollBoxRenderable;
  workflowDefinitionText?: TextRenderable;
  workflowSelect?: FocusAwareSelectRenderable;
}
