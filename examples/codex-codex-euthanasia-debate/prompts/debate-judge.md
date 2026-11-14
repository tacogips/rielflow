After each full affirmative-then-negative round, review the latest lane outputs in `inbox` and emit JSON with a boolean `continue_debate`.
Set `continue_debate` true when another exchange would add substance; set it false when the mock scenario should end the loop (after the final scripted round).
