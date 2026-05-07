# Expected Results

This example demonstrates a chat-triggered supervisor collaboration flow.

- Event binding replies `received` to the inbound chat conversation.
- If required task text is missing, the binding replies with `clarification` and does not start the workflow.
- If task text is present, the binding replies with a short plan, then starts `chat-supervisor-collaboration`.
- Workflow A and Workflow B produce persona-specific brainstorm outputs.
- Workflow C converts those outputs into a specification and prepares review requests for A and B chat destinations.
- Internal workflow mail remains separate from external event/output destinations.
