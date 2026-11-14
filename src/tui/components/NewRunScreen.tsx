import type { OpenTuiMainViewRefs } from "../opentui-solid-components";
import { Box, ScrollBox, Text } from "../opentui-solid-components";

export interface NewRunScreenProps {
  readonly refs: OpenTuiMainViewRefs;
}

export function NewRunScreen(props: NewRunScreenProps) {
  return (
    <Box
      ref={(node) => {
        props.refs.runTopRow = node;
      }}
      flexDirection="row"
      flexGrow={1}
      width="100%"
    >
      <ScrollBox
        ref={(node) => {
          props.refs.runWorkflowPane = node;
        }}
        id="run-workflow-scroll"
        width="50%"
        minWidth={24}
        height="100%"
        border
        title=" Workflow Detail "
        borderColor="#5b6670"
        scrollY
      >
        <Text
          ref={(node) => {
            props.refs.runWorkflowText = node;
          }}
          id="run-workflow-text"
          flexGrow={1}
          width="100%"
          content=""
        />
      </ScrollBox>
      <ScrollBox
        ref={(node) => {
          props.refs.runStatusPane = node;
        }}
        id="run-status-scroll"
        width="50%"
        minWidth={24}
        height="100%"
        border
        title=" Execution Status "
        borderColor="#5b6670"
        scrollY
      >
        <Text
          ref={(node) => {
            props.refs.runStatusText = node;
          }}
          id="run-status-text"
          flexGrow={1}
          width="100%"
          content=""
        />
      </ScrollBox>
    </Box>
  );
}
