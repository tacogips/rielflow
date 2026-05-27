---
name: compose-yaml-edit
description: Use when creating, renaming, editing, reviewing, or validating Docker Compose or Podman Compose files such as compose.yaml, compose.*.yaml, docker-compose.yml, docker-compose.yaml, compose.yml, and service-specific Compose files. Applies to modern Compose filename conventions, .yaml/.yml extension standardization, service/network/volume definitions, port mappings, environment variables, secrets, healthchecks, and docker compose or podman-compose verification commands.
---

# Compose YAML Edit

## Workflow

1. Find all Compose files and references before editing:
   - Files: `rg --files | rg '(^|/)(docker-compose|compose).*\\.ya?ml$'`
   - References: search for the exact filename and nearby commands.
2. Prefer modern Compose names:
   - Default file: `compose.yaml`
   - Variant-specific file: `compose.<name>.yaml`, for example `compose.jaeger.yaml`.
   - Avoid new `docker-compose*.yml` names unless matching an existing external contract.
3. Standardize extensions within the affected area:
   - Prefer `.yaml` for Compose files.
   - Do not rename unrelated conventional files such as `Taskfile.yml` only to satisfy YAML extension consistency.
4. Edit with Compose semantics, not plain YAML text assumptions:
   - Keep top-level `services`, `networks`, `volumes`, `secrets`, and `configs` valid.
   - Use string form for ambiguous ports and environment values that may parse as numbers or booleans.
   - Avoid adding obsolete top-level `version`.
5. Preserve privacy and portability:
   - Do not commit credentials, tokens, private URLs, or machine-local absolute paths.
   - Prefer `.env` references or documented environment variables for local-only values.
   - Avoid host network and privileged containers unless explicitly required.
6. Validate after edits:
   - Docker Compose v2: `docker compose -f <file> config`
   - Podman Compose: `podman-compose -f <file> config` when the user specifically needs Podman compatibility.
   - If the runtime check is requested, run `up -d`, inspect `ps`/logs or service API, then run `down` unless the user asks to keep services running.

## Rename Checklist

When renaming a Compose file:

- Use `git mv` or equivalent rename-preserving workflow.
- Update README, design docs, implementation plans, scripts, tests, CI, and examples.
- Search for both old and new names after the edit.
- Validate the new filename with `docker compose -f <new-file> config`.
- Mention any intentionally unchanged `.yml` files, especially conventional filenames like `Taskfile.yml`.

## Service Editing Guidelines

- Use stable service names that match the domain role (`jaeger`, `postgres`, `redis`, `app`).
- Keep image tags explicit; avoid `latest` unless the project already uses it deliberately.
- Quote port mappings, for example `"16686:16686"`.
- Prefer named volumes for persistent data; avoid unreviewed host bind mounts.
- Add healthchecks only when the image has a reliable command available.
- Keep Compose files focused; split optional stacks into `compose.<name>.yaml` instead of overloading the default file.
