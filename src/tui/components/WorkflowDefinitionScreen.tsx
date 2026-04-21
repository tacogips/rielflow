import type { OpenTuiMainViewRefs } from "../opentui-solid-components";
import { Box, FocusSelect, ScrollBox, Text } from "../opentui-solid-components";
import { OPEN_TUI_SELECT_THEMES } from "../opentui-view-shared";

export interface WorkflowDefinitionScreenProps {
  readonly refs: OpenTuiMainViewRefs;
}

export function WorkflowDefinitionScreen(props: WorkflowDefinitionScreenProps) {
  return (
    <Box
      ref={(node) => {
        props.refs.definitionScreen = node;
      }}
      flexDirection="column"
      flexGrow={1}
      width="100%"
    >
      <ScrollBox
        ref={(node) => {
          props.refs.workflowDefinitionPane = node;
        }}
        id="workflow-definition-scroll"
        width="100%"
        minWidth={20}
        flexGrow={10}
        border
        title=" Workflow Definition "
        borderColor="#5b6670"
        scrollY
        focusable
      >
        <Text
          ref={(node) => {
            props.refs.workflowDefinitionText = node;
          }}
          id="workflow-definition-text"
          width="100%"
          content=""
        />
      </ScrollBox>
      <Box
        ref={(node) => {
          props.refs.workflowDefinitionNodePane = node;
        }}
        width="100%"
        minWidth={20}
        flexGrow={20}
        border
        title=" Nodes "
        borderColor="#5b6670"
        focusedBorderColor="#4fd1ff"
        flexDirection="column"
      >
        <FocusSelect
          ref={(node) => {
            props.refs.workflowDefinitionNodeSelect = node;
          }}
          id="workflow-definition-node-select"
          showDescription
          flexGrow={1}
          width="100%"
          height="100%"
          itemSpacing={OPEN_TUI_SELECT_THEMES.historyNodes.itemSpacing}
          selectedBackgroundColor={
            OPEN_TUI_SELECT_THEMES.historyNodes.selectedBackgroundColor
          }
          selectedTextColor={
            OPEN_TUI_SELECT_THEMES.historyNodes.selectedTextColor
          }
          descriptionColor={
            OPEN_TUI_SELECT_THEMES.historyNodes.descriptionColor
          }
          selectedDescriptionColor={
            OPEN_TUI_SELECT_THEMES.historyNodes.selectedDescriptionColor
          }
        />
      </Box>
    </Box>
  );
}
