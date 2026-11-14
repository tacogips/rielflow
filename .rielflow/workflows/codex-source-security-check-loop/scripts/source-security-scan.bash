#!/usr/bin/env bash
set -euo pipefail

mailbox_dir="${RIEL_MAILBOX_DIR:?RIEL_MAILBOX_DIR is required}"
output_path="${mailbox_dir}/outbox/output.json"
mkdir -p "$(dirname "$output_path")"

raw_target="${1:-.}"
if [[ -z "$raw_target" || "$raw_target" == "{{workflowInput.targetPath}}" ]]; then
  raw_target="."
fi

if [[ "$raw_target" = /* ]]; then
  target_path="$raw_target"
else
  target_path="$(pwd)/$raw_target"
fi

max_findings="${SECURITY_MAX_FINDINGS:-50}"
if [[ -z "$max_findings" || "$max_findings" == "{{workflowInput.maxFindings}}" || ! "$max_findings" =~ ^[0-9]+$ ]]; then
  max_findings="50"
fi

run_network_audits="${SECURITY_RUN_NETWORK_AUDITS:-false}"
if [[ -z "$run_network_audits" || "$run_network_audits" == "{{workflowInput.runNetworkAudits}}" ]]; then
  run_network_audits="false"
fi

scan_mode="${SECURITY_SCAN_MODE:-all}"
if [[ -z "$scan_mode" ]]; then
  scan_mode="all"
fi

python_bin="$(command -v python3 || command -v python || true)"
if [[ -z "$python_bin" ]]; then
  printf '{"status":"error","error":"python3 is required for source-security-scan.bash"}\n' > "$output_path"
  exit 0
fi

"$python_bin" - "$output_path" "$target_path" "$max_findings" "$run_network_audits" "${SECURITY_INCLUDE_PATHS:-}" "${SECURITY_EXCLUDE_PATHS:-}" "$scan_mode" <<'PY'
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

output_path, target_path, max_findings_raw, run_network_audits_raw, include_paths_raw, exclude_paths_raw, scan_mode = sys.argv[1:]
root = Path(target_path).resolve()
max_findings = int(max_findings_raw)
run_network_audits = run_network_audits_raw.lower() == "true"
valid_modes = {"all", "secrets", "gitleaks", "static", "dependencies", "supply-chain-config"}
if scan_mode not in valid_modes:
    scan_mode = "all"

def should_run(*modes):
    return scan_mode == "all" or scan_mode in modes

def write(payload):
    Path(output_path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

if not root.is_dir():
    write({
        "status": "error",
        "targetPath": str(root),
        "error": f"targetPath is not a directory: {root}",
        "findings": [{
            "id": "scan-target-missing",
            "severity": "high",
            "category": "scanner",
            "path": str(root),
            "line": None,
            "message": "Security scan target path does not exist.",
            "evidence": ""
        }]
    })
    sys.exit(0)

tool_names = [
    "python3", "rg", "git", "semgrep", "gitleaks", "npm", "pnpm", "yarn",
    "bun", "pip-audit", "safety", "bundle", "cargo", "cargo-audit",
    "govulncheck", "go"
]
tools = [{"name": name, "available": shutil.which(name) is not None, "path": shutil.which(name)} for name in tool_names]
commands = []
findings = []
manifests = []

def parse_path_list(raw):
    if not raw or raw.startswith("{{workflowInput."):
        return []
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(item) for item in parsed if str(item).strip()]
        if isinstance(parsed, str):
            raw = parsed
    except Exception:
        pass
    return [part.strip() for part in re.split(r"[\n,]", raw) if part.strip()]

include_paths = parse_path_list(include_paths_raw)
exclude_paths = parse_path_list(exclude_paths_raw)

def safe_child(path_text):
    candidate = Path(path_text)
    if not candidate.is_absolute():
        candidate = root / candidate
    resolved = candidate.resolve()
    try:
        resolved.relative_to(root)
    except ValueError:
        return None
    return resolved

scan_roots = []
for item in include_paths:
    candidate = safe_child(item)
    if candidate and candidate.exists():
        scan_roots.append(candidate)
if not scan_roots:
    scan_roots = [root]

exclude_roots = []
for item in exclude_paths:
    candidate = safe_child(item)
    if candidate:
        exclude_roots.append(candidate)

skip_dirs = {".git", "node_modules", "dist", "build", "coverage", ".next", "vendor", ".venv", "__pycache__"}
manifest_names = {
    "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock",
    "requirements.txt", "pyproject.toml", "Pipfile.lock", "Gemfile.lock", "Cargo.lock",
    "go.mod", "go.sum", "Dockerfile", "docker-compose.yml", "compose.yaml"
}
lock_suffixes = (".lock", ".lockb")

def rel(path):
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)

def is_excluded(path):
    resolved = path.resolve()
    return any(resolved == excluded or excluded in resolved.parents for excluded in exclude_roots)

def iter_files():
    seen = set()
    for scan_root in scan_roots:
        if scan_root.is_file():
            if not is_excluded(scan_root):
                resolved = scan_root.resolve()
                if resolved not in seen:
                    seen.add(resolved)
                    yield scan_root
            continue
        if not scan_root.is_dir() or is_excluded(scan_root):
            continue
        for current, dirs, files in os.walk(scan_root):
            current_path = Path(current)
            if is_excluded(current_path):
                dirs[:] = []
                continue
            dirs[:] = [
                d for d in dirs
                if d not in skip_dirs and not is_excluded(current_path / d)
            ]
            for filename in files:
                path = current_path / filename
                if is_excluded(path):
                    continue
                resolved = path.resolve()
                if resolved in seen:
                    continue
                seen.add(resolved)
                yield path

for path in iter_files():
    if path.name in manifest_names:
        manifests.append({"path": rel(path)})

def add_finding(fid, severity, category, path, line, message, evidence=""):
    if len(findings) >= max_findings:
        return
    findings.append({
        "id": fid,
        "severity": severity,
        "category": category,
        "path": rel(path) if isinstance(path, Path) else str(path),
        "line": line,
        "message": message,
        "evidence": str(evidence)[:220]
    })

secret_patterns = [
    re.compile(r"-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"ASIA[0-9A-Z]{16}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9_]{36,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]{50,}"),
    re.compile(r"xox[baprs]-[A-Za-z0-9-]{20,}"),
    re.compile(r"sk-[A-Za-z0-9]{32,}"),
]
risky_patterns = [
    re.compile(r"\beval\s*\("),
    re.compile(r"child_process\.(exec|execSync)\s*\("),
    re.compile(r"shell=True"),
    re.compile(r"pickle\.loads?\s*\("),
    re.compile(r"yaml\.load\s*\("),
    re.compile(r"\bmd5\s*\("),
    re.compile(r"\bsha1\s*\("),
    re.compile(r"verify\s*:\s*false"),
    re.compile(r"rejectUnauthorized\s*:\s*false"),
]

secret_count = 0
risky_count = 0
if should_run("secrets", "static"):
    for path in iter_files():
        if path.name.endswith(lock_suffixes):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if "\x00" in text[:4096]:
            continue
        for number, line in enumerate(text.splitlines(), start=1):
            is_pattern_definition = "re.compile(" in line or "RegExp(" in line
            if should_run("secrets") and not is_pattern_definition and secret_count < max_findings and any(pattern.search(line) for pattern in secret_patterns):
                secret_count += 1
                add_finding(
                    f"secret-pattern-{secret_count}",
                    "high",
                    "secret",
                    path,
                    number,
                    "High-confidence secret pattern found in source.",
                    line.strip()
                )
            if should_run("static") and not is_pattern_definition and risky_count < max_findings and any(pattern.search(line) for pattern in risky_patterns):
                risky_count += 1
                add_finding(
                    f"risky-code-pattern-{risky_count}",
                    "medium",
                    "source-pattern",
                    path,
                    number,
                    "Potentially risky security-sensitive code pattern requires review.",
                    line.strip()
                )

package_count = 0
network_fetch_tools = "|".join(["curl", "wget"])
shell_interpreters = "|".join(["sh", "bash"])
network_to_shell_pattern = (
    "(" + network_fetch_tools + ")" + r"\s+.*"
    + r"\|\s*(" + shell_interpreters + ")"
)
if should_run("supply-chain-config"):
    for path in iter_files():
        if path.name != "package.json":
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        scripts = data.get("scripts") or {}
        risky_package_script_pattern = (
            network_to_shell_pattern
            +
            r"|chmod\s+\+x|sudo\s|rm\s+-rf\s+\$|postinstall|preinstall|node\s+-e|eval\s*\("
        )
        for name, script in scripts.items():
            haystack = f"{name} {script}"
            if re.search(risky_package_script_pattern, haystack, re.I):
                package_count += 1
                add_finding(
                    f"risky-package-script-{package_count}",
                    "medium",
                    "supply-chain",
                    path,
                    None,
                    f"Risky package script requires supply-chain review: {name}",
                    script
                )

config_count = 0
if should_run("supply-chain-config"):
    config_patterns = [
        ("docker-latest-tag", "medium", re.compile(r"\bFROM\s+\S+:latest\b", re.I), "Container base image uses mutable latest tag."),
        ("docker-privileged", "high", re.compile(r"\bprivileged\s*:\s*true\b", re.I), "Container or compose config enables privileged mode."),
        ("curl-pipe-shell", "medium", re.compile("(" + network_fetch_tools + ")" + r"\b.*\|\s*(" + shell_interpreters + r")\b", re.I), "Build or install command pipes network content to a shell."),
        ("broad-iam-wildcard", "medium", re.compile(r'"(Action|Resource)"\s*:\s*"\*"', re.I), "Infrastructure policy uses broad IAM wildcard permissions."),
        ("public-read-acl", "medium", re.compile(r"\b(public-read|allUsers|allAuthenticatedUsers)\b", re.I), "Configuration may expose storage or resources publicly."),
    ]
    config_extensions = {".yml", ".yaml", ".json", ".tf", ".Dockerfile"}
    config_names = {"Dockerfile", "docker-compose.yml", "compose.yaml", "compose.yml", "cloudformation.yaml", "cloudformation.yml"}
    for path in iter_files():
        if path.name not in config_names and path.suffix not in config_extensions and ".github/workflows" not in rel(path):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if "\x00" in text[:4096]:
            continue
        for number, line in enumerate(text.splitlines(), start=1):
            for prefix, severity, pattern, message in config_patterns:
                if config_count >= max_findings:
                    break
                if pattern.search(line):
                    config_count += 1
                    add_finding(
                        f"{prefix}-{config_count}",
                        severity,
                        "configuration",
                        path,
                        number,
                        message,
                        line.strip()
                    )
            if config_count >= max_findings:
                break

def run_command(name, argv, cwd=None):
    try:
        proc = subprocess.run(argv, cwd=cwd or root, text=True, capture_output=True, timeout=900)
        commands.append({
            "name": name,
            "command": " ".join(argv),
            "status": proc.returncode,
            "outputPreview": (proc.stdout + proc.stderr)[:12000],
            "outputTruncated": len(proc.stdout + proc.stderr) > 12000
        })
    except FileNotFoundError:
        commands.append({"name": name, "command": " ".join(argv), "status": "missing", "outputPreview": ""})
    except subprocess.TimeoutExpired as exc:
        combined = ((exc.stdout or "") + (exc.stderr or ""))
        commands.append({"name": name, "command": " ".join(argv), "status": "timeout", "outputPreview": combined[:12000]})

if should_run("secrets", "gitleaks") and shutil.which("gitleaks"):
    for index, scan_root in enumerate(scan_roots, start=1):
        if scan_root.is_dir() and not is_excluded(scan_root):
            report_path = Path(tempfile.mkdtemp(prefix="rielflow-gitleaks-")) / "report.json"
            run_command(
                f"gitleaks-{index}",
                [
                    "gitleaks",
                    "detect",
                    "--no-git",
                    "--redact",
                    "--source",
                    str(scan_root),
                    "--report-format",
                    "json",
                    "--report-path",
                    str(report_path),
                ],
            )
            if report_path.exists():
                try:
                    report = json.loads(report_path.read_text(encoding="utf-8"))
                except Exception:
                    report = []
                if isinstance(report, list):
                    for item in report[:max_findings]:
                        file_path = item.get("File") or item.get("file") or ""
                        line_number = item.get("StartLine") or item.get("Line") or item.get("line")
                        rule_id = item.get("RuleID") or item.get("Rule") or item.get("rule") or "gitleaks"
                        description = item.get("Description") or item.get("description") or "gitleaks detected a secret."
                        fingerprint = item.get("Fingerprint") or item.get("fingerprint") or ""
                        target = root / file_path if file_path and not Path(file_path).is_absolute() else Path(file_path or scan_root)
                        add_finding(
                            f"gitleaks-{len(findings) + 1}",
                            "high",
                            "secret",
                            target,
                            int(line_number) if isinstance(line_number, int) or str(line_number).isdigit() else None,
                            f"gitleaks finding {rule_id}: {description}",
                            fingerprint,
                        )
elif should_run("gitleaks"):
    commands.append({
        "name": "gitleaks",
        "command": "gitleaks detect --no-git --redact --source <scan-root>",
        "status": "missing",
        "outputPreview": "gitleaks executable was not found on PATH."
    })

if should_run("static") and shutil.which("semgrep"):
    semgrep_targets = [str(path) for path in scan_roots if path.exists() and not is_excluded(path)]
    if semgrep_targets:
        run_command("semgrep-auto", ["semgrep", "scan", "--config", "auto", "--error", "--json", *semgrep_targets])

if should_run("dependencies") and run_network_audits:
    if (root / "package-lock.json").exists() and shutil.which("npm"):
        run_command("npm-audit", ["npm", "audit", "--json", "--audit-level=moderate", "--prefix", str(root)])
    if (root / "pnpm-lock.yaml").exists() and shutil.which("pnpm"):
        run_command("pnpm-audit", ["pnpm", "audit", "--json", "--prod", "--dir", str(root)])
    if (root / "yarn.lock").exists() and shutil.which("yarn"):
        run_command("yarn-audit", ["yarn", "npm", "audit", "--json", "--cwd", str(root)])
    if ((root / "bun.lock").exists() or (root / "bun.lockb").exists()) and shutil.which("bun"):
        run_command("bun-audit", ["bun", "audit", "--json"])
    if ((root / "requirements.txt").exists() or (root / "pyproject.toml").exists()) and shutil.which("pip-audit"):
        run_command("pip-audit", ["pip-audit", "--format", "json", "--path", str(root)])
    if (root / "Gemfile.lock").exists() and shutil.which("bundle"):
        run_command("bundle-audit", ["bundle", "audit", "check", "--gemfile", str(root / "Gemfile")])
    if (root / "Cargo.lock").exists() and shutil.which("cargo") and shutil.which("cargo-audit"):
        run_command("cargo-audit", ["cargo", "audit", "--json"])
    if (root / "go.mod").exists() and shutil.which("govulncheck"):
        run_command("govulncheck", ["govulncheck", "-json", "./..."])
elif should_run("dependencies"):
    commands.append({
        "name": "dependency-audits",
        "command": "network dependency audits skipped; set workflowInput.runNetworkAudits to true",
        "status": "skipped",
        "outputPreview": ""
    })

if shutil.which("git"):
    inside = subprocess.run(["git", "-C", str(root), "rev-parse", "--is-inside-work-tree"], text=True, capture_output=True)
    if inside.returncode == 0:
        run_command("git-status", ["git", "-C", str(root), "status", "--short"], cwd=root)

severity_counts = {}
for finding in findings:
    severity_counts[finding["severity"]] = severity_counts.get(finding["severity"], 0) + 1

write({
    "status": "completed",
    "scanMode": scan_mode,
    "targetPath": str(root),
    "includePaths": include_paths,
    "excludePaths": exclude_paths,
    "scanRoots": [str(path) for path in scan_roots],
    "maxFindings": max_findings,
    "runNetworkAudits": run_network_audits,
    "tools": tools,
    "manifests": manifests,
    "commands": commands,
    "findings": findings,
    "severityCounts": severity_counts,
    "coverageGaps": [tool["name"] for tool in tools if not tool["available"]],
    "notes": [
        "Secret and risky-code pattern checks are deterministic local heuristics.",
        "Semgrep, gitleaks, and ecosystem audit results are included only when the corresponding tool is installed.",
        "Network-backed dependency audits run only when workflowInput.runNetworkAudits is true."
    ]
})
PY
