#!/usr/bin/env python3
"""Summarize source/target migration surfaces for parity review."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


TS_EXPORT_RE = re.compile(
    r"^\s*(?:export\s+(?:async\s+)?(?:function|class|interface|type|const|enum)|export\s+\{)"
)
SWIFT_PUBLIC_RE = re.compile(
    r"^\s*public\s+(?:struct|class|actor|enum|protocol|func|var|let|init|static\s+func|static\s+let|static\s+var)"
)
SWIFT_TEST_RE = re.compile(r"\bfunc\s+test[A-Za-z0-9_]*\s*\(")


def rel(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def walk(root: Path, suffixes: tuple[str, ...]) -> list[Path]:
    if not root.exists():
        return []
    ignored = {".git", "node_modules", ".build", "dist", "tmp"}
    result: list[Path] = []
    for path in root.rglob("*"):
        if any(part in ignored for part in path.parts):
            continue
        if path.is_file() and path.suffix in suffixes:
            result.append(path)
    return sorted(result)


def matching_lines(files: list[Path], pattern: re.Pattern[str], root: Path) -> list[str]:
    lines: list[str] = []
    for file_path in files:
        try:
            for index, line in enumerate(file_path.read_text(errors="ignore").splitlines(), start=1):
                if pattern.search(line):
                    lines.append(f"{rel(file_path, root)}:{index}: {line.strip()}")
        except OSError:
            continue
    return lines


def package_summary(root: Path) -> dict[str, object]:
    package_json = root / "package.json"
    if not package_json.exists():
        return {}
    try:
        data = json.loads(package_json.read_text())
    except json.JSONDecodeError:
        return {"packageJson": "invalid"}
    return {
        "name": data.get("name"),
        "bin": data.get("bin"),
        "exports": data.get("exports"),
        "scripts": sorted((data.get("scripts") or {}).keys()),
    }


def active_plan_statuses(target: Path) -> list[str]:
    active = target / "impl-plans" / "active"
    if not active.exists():
        return []
    statuses: list[str] = []
    for path in sorted(active.glob("*.md")):
        text = path.read_text(errors="ignore")
        status = "unknown"
        for line in text.splitlines():
            if line.startswith("**Status**:"):
                status = line.split(":", 1)[1].strip()
                break
        statuses.append(f"{rel(path, target)}: {status}")
    return statuses


def write_markdown(args: argparse.Namespace) -> str:
    source = Path(args.source).resolve()
    target = Path(args.target).resolve()
    source_ts = walk(source / "src", (".ts", ".tsx"))
    target_swift = walk(target / "Sources", (".swift",)) + walk(target / "Tests", (".swift",))
    source_tests = [p for p in source_ts if p.name.endswith((".test.ts", ".spec.ts"))]
    target_tests = [p for p in target_swift if "/Tests/" in str(p)]
    source_exports = matching_lines(source_ts, TS_EXPORT_RE, source)
    target_public = matching_lines(target_swift, SWIFT_PUBLIC_RE, target)
    target_test_funcs = matching_lines(target_tests, SWIFT_TEST_RE, target)

    sections = [
        "# Migration Surface Audit",
        "",
        f"- Source: `{source}`",
        f"- Target: `{target}`",
        f"- Source TS files: {len(source_ts)}",
        f"- Source test files: {len(source_tests)}",
        f"- Target Swift files: {len(target_swift)}",
        f"- Target Swift test files: {len(target_tests)}",
        f"- Source export lines: {len(source_exports)}",
        f"- Target public lines: {len(target_public)}",
        f"- Target test functions: {len(target_test_funcs)}",
        "",
        "## Source Package",
        "",
        "```json",
        json.dumps(package_summary(source), indent=2, sort_keys=True),
        "```",
        "",
        "## Active Plans",
        "",
    ]
    plan_status = active_plan_statuses(target)
    sections.extend([f"- {line}" for line in plan_status] or ["- none"])
    sections.extend(["", "## Source Tests", ""])
    sections.extend([f"- `{rel(path, source)}`" for path in source_tests] or ["- none"])
    sections.extend(["", "## Target Test Functions", ""])
    sections.extend([f"- `{line}`" for line in target_test_funcs] or ["- none"])
    sections.extend(["", "## Source Export Lines", ""])
    sections.extend([f"- `{line}`" for line in source_exports[:300]] or ["- none"])
    if len(source_exports) > 300:
        sections.append(f"- ... {len(source_exports) - 300} more")
    sections.extend(["", "## Target Public Lines", ""])
    sections.extend([f"- `{line}`" for line in target_public[:300]] or ["- none"])
    if len(target_public) > 300:
        sections.append(f"- ... {len(target_public) - 300} more")
    return "\n".join(sections) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--output")
    args = parser.parse_args()
    markdown = write_markdown(args)
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(markdown)
    else:
        print(markdown, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
