#!/usr/bin/env python3
"""Catch documentation that describes a CLI that no longer exists, or a skill that will not load.

Prose does not fail to compile. A skill told Claude to run `oms config <name> <flags>`
for a week after settings moved to `oms set`, and nothing noticed, because nothing was
looking. This looks.

    python3 .github/check-docs.py
"""
import json
import os
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

# A skill whose frontmatter does not parse is not an error anywhere - it is a skill
# that quietly never loads, which looks exactly like a skill nobody invoked.
for skill in sorted(ROOT.glob("skills/*/SKILL.md")):
    where = skill.relative_to(ROOT)
    head = re.match(r"^---\n(.*?)\n---\n", skill.read_text(), re.S)
    if not head:
        bad.append(f"{where}:1: no YAML frontmatter, so this skill will not load")
        continue
    keys = dict(re.findall(r"^([\w-]+):\s*(.*)$", head.group(1), re.M))
    if not keys.get("description", "").strip():
        bad.append(f"{where}:1: frontmatter has no description, which is what Claude "
                   f"reads to decide whether the skill applies")
    for k in keys:
        if k not in {"description", "name", "disable-model-invocation", "allowed-tools"}:
            bad.append(f"{where}:1: unknown frontmatter key {k!r}")

print(f"checked {len(known)} commands against the docs: {', '.join(sorted(known))}")
# Same shape of quiet failure as a skill: a malformed hooks.json means the hook never
# fires, and a hook that never fires looks like a threshold never reached.
# The two manifests name the same plugin from opposite ends, and `claude plugin install
# <name>@<marketplace>` needs them to agree. Renaming the plugin means editing both;
# editing one leaves an install command that resolves to nothing.
manifest = json.loads((ROOT / ".claude-plugin" / "plugin.json").read_text())
market = json.loads((ROOT / ".claude-plugin" / "marketplace.json").read_text())
listed = [e["name"] for e in market.get("plugins", [])]
if manifest.get("name") not in listed:
    bad.append(f".claude-plugin/marketplace.json:1: lists {listed}, but the plugin is "
               f"named {manifest.get('name')!r} - `plugin install` would find nothing")
if not re.fullmatch(r"\d+\.\d+\.\d+", manifest.get("version", "")):
    bad.append(f".claude-plugin/plugin.json:1: version {manifest.get('version')!r} is not "
               f"x.y.z, and a version that does not sort is a version nobody receives")
install = f"claude plugin install {manifest['name']}@{market['name']}"
if install not in (ROOT / "README.md").read_text():
    bad.append(f"README.md: the install line should read `{install}`")

# A hook that ships undocumented is one that fires at someone with no explanation
# anywhere. The quota warning went undocumented for eleven releases after a replacement
# edit silently matched nothing.
readme = (ROOT / "README.md").read_text()
hooks_file = ROOT / "hooks" / "hooks.json"
if hooks_file.exists():
    try:
        hooks = json.loads(hooks_file.read_text()).get("hooks", {})
    except ValueError as e:
        hooks, _ = {}, bad.append(f"hooks/hooks.json:1: not valid JSON ({e})")
    for event, entries in hooks.items():
        for entry in entries:
            for hook in entry.get("hooks", []):
                cmd = hook.get("command", "")
                if not cmd:
                    bad.append(f"hooks/hooks.json:1: {event} has a hook with no command")
                    continue
                # ${CLAUDE_PLUGIN_ROOT} is the plugin root, which is this repository
                target = cmd.replace("${CLAUDE_PLUGIN_ROOT}/", "").split()[0]
                if not (ROOT / target).exists():
                    bad.append(f"hooks/hooks.json:1: {event} runs {target}, "
                               f"which is not in this repository")
                elif not os.access(ROOT / target, os.X_OK):
                    bad.append(f"hooks/hooks.json:1: {target} is not executable")
            if event not in readme:
                bad.append(f"README.md: nothing explains the {event} hook, which fires "
                           f"at people who install this")
    print(f"checked {sum(len(v) for v in hooks.values())} hook(s)")

# An edit that misses its anchor leaves the old text in place and says nothing, so a
# section can end up described two or three times, each copy a different vintage. The
# oldest ones describe behaviour that no longer exists.
import collections
for doc in sorted(ROOT.glob("*.md")) + sorted(ROOT.glob("agent/*.md")) + \
        sorted(ROOT.glob("skills/*/SKILL.md")):
    where = doc.relative_to(ROOT)
    text = doc.read_text()
    seen = collections.Counter(l.strip() for l in text.splitlines() if len(l.strip()) > 40)
    for line, n in seen.items():
        if n > 1:
            bad.append(f"{where}: this sentence appears {n} times, so at least one copy "
                       f"describes an older version of the same thing:\n      {line[:70]}...")
    # a line count in prose is true on the day it is written and false soon after
    for m in re.finditer(r"`?(src/)?([\w.-]+\.ts)`?[^\n]{0,40}?(\d{2,4}) lines", text):
        f = ROOT / "agent" / (m.group(1) or "") / m.group(2)
        if f.exists() and len(f.read_text().splitlines()) != int(m.group(3)):
            bad.append(f"{where}: says {m.group(2)} is {m.group(3)} lines; it is "
                       f"{len(f.read_text().splitlines())}")

print(f"checked {len(list(ROOT.glob('skills/*/SKILL.md')))} skills")
if bad:
    print("\n" + "\n".join(bad))
    sys.exit(f"\n{len(bad)} problem(s) above")
print("everything documented exists, and everything installed will load")
