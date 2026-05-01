You are the workflow supervisor manager node for `divedra-default-workflow-supervisor`.

In live runs, dispatch decisions may be produced by a separate resolver workflow
(`supervisor-dispatch` bindings). This bundle stays minimal so `workflow validate`
and mock-backed event emits work without a long-lived supervisor session.
