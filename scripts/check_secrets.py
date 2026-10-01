"""Reject embedded privileged credentials without printing their values."""
from __future__ import annotations

import base64
import json
from pathlib import Path
import re
import subprocess
import sys

JWT = re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
TOKENS = {
    "Supabase secret key": re.compile(r"sb_secret_[A-Za-z0-9_-]{15,}"),
    "Hugging Face token": re.compile(r"hf_[A-Za-z0-9]{20,}"),
    "GitHub token": re.compile(r"(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}"),
    "Provider secret key": re.compile(r"(?:sk-(?:proj-)?|nvapi-)[A-Za-z0-9_-]{30,}"),
    "Telegram bot token": re.compile(r"\b[0-9]{8,12}:[A-Za-z0-9_-]{30,}"),
}


def find_credentials(text: str) -> list[tuple[int, str]]:
    findings = []
    for number, line in enumerate(text.splitlines(), 1):
        for match in JWT.finditer(line):
            try:
                payload = match.group().split(".")[1]
                claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
            except (ValueError, UnicodeDecodeError):
                continue
            if isinstance(claims, dict) and claims.get("role") == "service_role":
                findings.append((number, "Supabase service-role JWT"))
        for kind, pattern in TOKENS.items():
            if pattern.search(line):
                findings.append((number, kind))
    return findings


def main() -> int:
    root = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
    names = subprocess.check_output(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=root)
    failed = False
    for name in sorted(set(names.decode().split("\0")) - {""}):
        path = root / name
        if not path.is_file() or path.is_symlink():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for line, kind in find_credentials(text):
            failed = True
            print(f"{name}:{line}: embedded {kind}; move it to deployment secrets", file=sys.stderr)
    if not failed:
        print("No embedded privileged credentials found in tracked and non-ignored files.")
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
