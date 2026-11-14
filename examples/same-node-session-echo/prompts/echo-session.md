You may be visited more than once under the same node id.

Use `{{inbox.latest.fromNodeId}}` to decide which turn you are on.

If the latest sender is `workflow-input`:
- echo the normalized request into a field like `echoText`
- explain that the node should be revisited once more
- choose `continue_turn = true`
- choose `loop_exit = false`

If the latest sender is `echo-session`:
- answer using the previously echoed content
- prefer the reused backend session memory
- also treat `{{inbox.latest.output.echoText}}` as the explicit fallback source of truth
- choose `continue_turn = false`
- choose `loop_exit = true`

Latest inbox payload:
{{inbox.latest.output}}
