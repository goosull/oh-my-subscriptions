#!/usr/bin/env python3
"""Catch documentation that describes a CLI that no longer exists.

Prose does not fail to compile. A skill told Claude to run `oms config <name> <flags>`
for a week after settings moved to `oms set`, and nothing noticed, because nothing was
looking. This looks.

    python3 .github/check-docs.py
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OMS = ROOT / "bin" / "oms"

usage = subprocess.run([sys.executable, str(OMS)], capture_output=True, text=True).stdout
known = set(re.findall(r"^\s+oms ([a-z-]+)", usage, re.M))
if not known:
    sys.exit("could not read the command list out of `oms`")

bad = []
for doc in [*ROOT.glob("skills/*/SKILL.md"), ROOT / "README.md", *ROOT.glob("agent/*.md")]:
    for line, text in enumerate(doc.read_text().splitlines(), 1):
        # only inside backticks or an indented command block: prose says "oms can read"
        for cmd in re.findall(r"`oms ([a-z-]+)[^`]*`|^ {4}oms ([a-z-]+)", text, re.M):
            name = cmd[0] or cmd[1]
            if name and name not in known:
                bad.append(f"{doc.relative_to(ROOT)}:{line}: `oms {name}` is not a command")

print(f"checked {len(known)} commands against the docs: {', '.join(sorted(known))}")
if bad:
    print("\n" + "\n".join(bad))
    sys.exit(f"\n{len(bad)} reference(s) to commands oms does not have")
print("every documented command exists")
