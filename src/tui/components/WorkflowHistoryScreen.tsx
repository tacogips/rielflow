import type { OpenTuiMainViewRefs } from "../opentui-solid-components";
import { Box, FocusSelect, Text } from "../opentui-solid-components";
import { OPEN_TUI_SELECT_THEMES } from "../opentui-view-shared";
import { NodeDetailPane } from "./NodeDetailPane";

export interface WorkflowHistoryScreenProps {
  readonly refs: OpenTuiMainViewRefs;
}

export function WorkflowHistoryScreen(props: WorkflowHistoryScreenProps) {
  return (
    <Box
      ref={(node) => {
        props.refs.historyScreen = node;
      }}
      flexDirection="column"
      flexGrow={1}
      width="100%"
    >
      <Box
        ref={(node) => {
          props.refs.historyHeaderBox = node;
        }}
        width="100%"
        border
        title=" Workflow "
        borderColor="#5b6670"
        padding={1}
        flexGrow={4}
      >
        <Text
          ref={(node) => {
            props.refs.historyHeaderText = node;
          }}
          id="history-header-text"
          flexGrow={1}
          width="100%"
          content=""
        />
      </Box>
      <Box flexDirection="row" flexGrow={18} width="100%">
        <Box
          ref={(node) => {
            props.refs.sessionPane = node;
          }}
          width="56%"
          minWidth={18}
          height="100%"
          border
          title=" Workflow Runs "
          borderColor="#5b6670"
          focusedBorderColor="#4fd1ff"
          flexDirection="column"
        >
          <FocusSelect
            ref={(node) => {
              props.refs.sessionSelect = node;
            }}
            id="sess-select"
            showDescription
            flexGrow={1}
            width="100%"
            height="100%"
            itemSpacing={OPEN_TUI_SELECT_THEMES.historySessions.itemSpacing}
            selectedBackgroundColor={
              OPEN_TUI_SELECT_THEMES.historySessions.selectedBackgroundColor
            }
            selectedTextColor={
              OPEN_TUI_SELECT_THEMES.historySessions.selectedTextColor
            }
            descriptionColor={
              OPEN_TUI_SELECT_THEMES.historySessions.descriptionColor
            }
            selectedDescriptionColor={
              OPEN_TUI_SELECT_THEMES.historySessions.selectedDescriptionColor
            }
          />
        </Box>
        <Box
          ref={(node) => {
            props.refs.nodePane = node;
          }}
          width="44%"
          minWidth={18}
          height="100%"
          border
          title=" Nodes "
          borderColor="#5b6670"
          focusedBorderColor="#4fd1ff"
          flexDirection="column"
        >
          <FocusSelect
            ref={(node) => {
              props.refs.nodeSelect = node;
            }}
            id="node-select"
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
      <NodeDetailPane refs={props.refs} />
    </Box>
  );
}
