After each full affirmative-then-negative round, review the latest lane outputs in `inbox` and return only the business JSON object expected by this node.

Return:
`{"continue_debate":<bool>,"completedRounds":<number>,"decision":<string>}`

Round counting:

- If there is no previous `debate-judge` output, set `completedRounds` to 1.
- Otherwise read the latest previous `debate-judge.payload.completedRounds` from resolved workflow message context and set `completedRounds` to that value plus 1.
- Set `continue_debate` to false once `completedRounds` is 3 or greater.
- Before round 3, set `continue_debate` to true only when another exchange would add substance; otherwise set it to false.

Do not return an adapter envelope with `payload` or `when`; the workflow runtime will publish your business JSON as payload.
