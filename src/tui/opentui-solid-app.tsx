import type { OpenTuiMainViewRefs } from "./opentui-solid-components";
import { Box, Text, Textarea } from "./opentui-solid-components";
import { NewRunScreen } from "./components/NewRunScreen";
import { PopupLayer } from "./components/PopupLayer";
import { WorkflowDefinitionScreen } from "./components/WorkflowDefinitionScreen";
import { WorkflowHistoryScreen } from "./components/WorkflowHistoryScreen";
import { WorkspaceScreen } from "./components/WorkspaceScreen";

export interface OpenTuiWorkflowAppViewProps {
  readonly refs: OpenTuiMainViewRefs;
}

export function OpenTuiWorkflowAppView(props: OpenTuiWorkflowAppViewProps) {
  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Box
        width="100%"
        border
        title=" Location "
        borderColor="#5b6670"
        padding={1}
        flexGrow={0}
      >
        <Text
          ref={(node) => {
            props.refs.breadcrumbText = node;
          }}
          id="breadcrumb-text"
          width="100%"
          content=""
        />
      </Box>
      <WorkspaceScreen refs={props.refs} />
      <WorkflowDefinitionScreen refs={props.refs} />
      <WorkflowHistoryScreen refs={props.refs} />
      <NewRunScreen refs={props.refs} />
      <Box
        ref={(node) => {
          props.refs.inputRow = node;
        }}
        flexDirection="row"
        flexGrow={20}
        width="100%"
      >
        <Box
          ref={(node) => {
            props.refs.inputShell = node;
          }}
          id="input-shell"
          border
          title=" Input "
          borderColor="#5b6670"
          focusedBorderColor="#4fd1ff"
          flexGrow={1}
          height="100%"
          focusable
        >
          <Textarea
            ref={(node) => {
              props.refs.inputTextarea = node;
            }}
            id="input-editor"
            flexGrow={1}
            width="100%"
            wrapMode="char"
          />
        </Box>
      </Box>
      <Box
        ref={(node) => {
          props.refs.footerBox = node;
        }}
        width="100%"
        border
        title=" Shortcuts "
        borderColor="#5b6670"
        padding={1}
        flexGrow={0}
      >
        <Text
          ref={(node) => {
            props.refs.footerText = node;
          }}
          id="footer-text"
          width="100%"
          content=""
        />
      </Box>
      <PopupLayer refs={props.refs} />
    </Box>
  );
}
