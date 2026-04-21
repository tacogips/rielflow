import type { OpenTuiMainViewRefs } from "../opentui-solid-components";
import { Box, FocusSelect, ScrollBox, Text } from "../opentui-solid-components";

export interface WorkspaceScreenProps {
  readonly refs: OpenTuiMainViewRefs;
}

export function WorkspaceScreen(props: WorkspaceScreenProps) {
  return (
    <Box
      ref={(node) => {
        props.refs.selectorRow = node;
      }}
      flexDirection="row"
      flexGrow={1}
      width="100%"
    >
      <Box
        ref={(node) => {
          props.refs.workflowPane = node;
        }}
        width="40%"
        minWidth={20}
        height="100%"
        border
        title=" Workflows "
        borderColor="#5b6670"
        focusedBorderColor="#4fd1ff"
        flexDirection="column"
      >
        <FocusSelect
          ref={(node) => {
            props.refs.workflowSelect = node;
          }}
          id="wf-select"
          showDescription={false}
          flexGrow={1}
          width="100%"
          height="100%"
        />
      </Box>
      <Box width="60%" minWidth={20} height="100%" flexDirection="column">
        <ScrollBox
          ref={(node) => {
            props.refs.selectorPreviewScroll = node;
          }}
          id="selector-preview-scroll"
          width="100%"
          minWidth={20}
          flexGrow={18}
          border
          title=" Workflow Preview "
          borderColor="#5b6670"
          scrollY
        >
          <Text
            ref={(node) => {
              props.refs.selectorPreviewText = node;
            }}
            id="selector-preview-text"
            flexGrow={1}
            width="100%"
            content=""
          />
        </ScrollBox>
        <ScrollBox
          ref={(node) => {
            props.refs.workspaceHistoryScroll = node;
          }}
          id="workspace-history-scroll"
          width="100%"
          minWidth={20}
          flexGrow={10}
          border
          title=" Latest Run Result "
          borderColor="#5b6670"
          scrollY
        >
          <Text
            ref={(node) => {
              props.refs.workspaceHistoryText = node;
            }}
            id="workspace-history-text"
            flexGrow={1}
            width="100%"
            content=""
          />
        </ScrollBox>
      </Box>
    </Box>
  );
}
