import type { OpenTuiMainViewRefs } from "../opentui-solid-components";
import { Box, FocusSelect, ScrollBox, Text } from "../opentui-solid-components";
import { OPEN_TUI_SELECT_THEMES } from "../opentui-view-shared";

export interface NodeDetailPaneProps {
  readonly refs: OpenTuiMainViewRefs;
}

export function NodeDetailPane(props: NodeDetailPaneProps) {
  return (
    <ScrollBox
      ref={(node) => {
        props.refs.detailScroll = node;
      }}
      id="detail-scroll"
      width="100%"
      minWidth={0}
      flexGrow={30}
      border
      title=" node detail "
      borderColor="#5b6670"
      scrollY
      focusable
    >
      <Box
        id="detail-scroll-column"
        flexDirection="column"
        flexGrow={1}
        width="100%"
      >
        <Text
          ref={(node) => {
            props.refs.detailSummaryHeader = node;
          }}
          id="detail-summary-header"
          width="100%"
          content=""
        />
        <FocusSelect
          ref={(node) => {
            props.refs.detailSummarySelect = node;
          }}
          id="detail-summary-select"
          showDescription
          flexGrow={1}
          width="100%"
          height="100%"
          itemSpacing={OPEN_TUI_SELECT_THEMES.detailSummary.itemSpacing}
          selectedBackgroundColor={
            OPEN_TUI_SELECT_THEMES.detailSummary.selectedBackgroundColor
          }
          selectedTextColor={
            OPEN_TUI_SELECT_THEMES.detailSummary.selectedTextColor
          }
          descriptionColor={
            OPEN_TUI_SELECT_THEMES.detailSummary.descriptionColor
          }
          selectedDescriptionColor={
            OPEN_TUI_SELECT_THEMES.detailSummary.selectedDescriptionColor
          }
        />
        <Text
          ref={(node) => {
            props.refs.detailText = node;
          }}
          id="detail-text"
          flexGrow={1}
          width="100%"
          content=""
        />
      </Box>
    </ScrollBox>
  );
}
