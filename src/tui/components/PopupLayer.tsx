import type { OpenTuiMainViewRefs } from "../opentui-solid-components";
import { Box, ScrollBox, Text, Textarea } from "../opentui-solid-components";
import { popupBackgroundColor } from "../opentui-view-shared";

export interface PopupLayerProps {
  readonly refs: OpenTuiMainViewRefs;
}

export function PopupLayer(props: PopupLayerProps) {
  return (
    <>
      <Box
        ref={(node) => {
          props.refs.filterPopup = node;
        }}
        id="workflow-filter-popup"
        border
        title=" Filter Workflows "
        backgroundColor={popupBackgroundColor()}
        width="60%"
        minWidth={24}
        height={7}
        position="absolute"
        top="25%"
        left="20%"
        zIndex={20}
        flexDirection="column"
        padding={1}
        visible={false}
      >
        <Text
          id="workflow-filter-hint"
          content="Type a substring and press enter/ctrl-m to apply. Esc cancels."
        />
        <Textarea
          ref={(node) => {
            props.refs.filterTextarea = node;
          }}
          id="workflow-filter-input"
          flexGrow={1}
          width="100%"
          wrapMode="char"
        />
      </Box>
      <Box
        ref={(node) => {
          props.refs.helpPopup = node;
        }}
        id="help-popup"
        border
        title=" Help "
        backgroundColor={popupBackgroundColor()}
        width="70%"
        minWidth={32}
        height="60%"
        position="absolute"
        top="20%"
        left="15%"
        zIndex={20}
        padding={1}
        visible={false}
        flexDirection="column"
        focusable
      >
        <Text
          ref={(node) => {
            props.refs.helpText = node;
          }}
          id="help-text"
          flexGrow={1}
          width="100%"
          content=""
        />
      </Box>
      <Box
        ref={(node) => {
          props.refs.confirmPopup = node;
        }}
        id="run-confirm-popup"
        border
        title=" Confirm Run "
        backgroundColor={popupBackgroundColor()}
        width="70%"
        minWidth={32}
        height="55%"
        position="absolute"
        top="22%"
        left="15%"
        zIndex={22}
        padding={1}
        visible={false}
        flexDirection="column"
        focusable
      >
        <Text
          ref={(node) => {
            props.refs.confirmText = node;
          }}
          id="run-confirm-text"
          flexGrow={1}
          width="100%"
          content=""
        />
      </Box>
      <ScrollBox
        ref={(node) => {
          props.refs.agentSessionPopup = node;
        }}
        id="agent-session-popup"
        border
        title=" AI Agent Session "
        backgroundColor={popupBackgroundColor()}
        width="80%"
        minWidth={40}
        height="72%"
        position="absolute"
        top="14%"
        left="10%"
        zIndex={24}
        padding={1}
        visible={false}
        scrollY
        focusable
      >
        <Text
          ref={(node) => {
            props.refs.agentSessionPopupText = node;
          }}
          id="agent-session-popup-text"
          flexGrow={1}
          width="100%"
          content=""
        />
      </ScrollBox>
      <ScrollBox
        ref={(node) => {
          props.refs.nodeDefinitionPopup = node;
        }}
        id="node-definition-popup"
        border
        title=" Node Definition "
        backgroundColor={popupBackgroundColor()}
        width="80%"
        minWidth={40}
        height="72%"
        position="absolute"
        top="14%"
        left="10%"
        zIndex={23}
        padding={1}
        visible={false}
        scrollY
        focusable
      >
        <Text
          ref={(node) => {
            props.refs.nodeDefinitionPopupText = node;
          }}
          id="node-definition-popup-text"
          flexGrow={1}
          width="100%"
          content=""
        />
      </ScrollBox>
    </>
  );
}
