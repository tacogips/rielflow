# Expected Results

The commands in `README.md` are deterministic when run with `--dry-run`.

Expected assertions:

- File-input run exits with code `0`.
- Inline JSON run exits with code `0`.
- JSON output reports `source.scope` as `temporary`.
- File-input JSON output reports `source.input` as `json-file`.
- Inline JSON output reports `source.input` as `inline-json`.
- Each temporary run writes:
  - `temporary-workflow-payload/input.json`
  - `temporary-workflow-payload/normalized.json`
  - `temporary-workflow-payload/metadata.json`
- `metadata.json` includes a content digest and schema version.
- No project or user workflow installation is required.
