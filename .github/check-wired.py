#!/usr/bin/env python3
"""Catch things that were built and never connected.

The most repeated mistake in this project's history is not a wrong answer, it is work
that never got plugged in: a bridge to the accounts layer while the router still used a
regex, a pace model nothing consulted, named windows that never reached the JSON. Each
one looked finished and did nothing.

A function nothing outside the tests calls is the shape that leaves behind.

    python3 .github/check-wired.py
"""
import ast
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "bin" / "oms"

tree = ast.parse(SRC.read_text())
# Anything reachable from the command table or __main__ is wired by definition; test
# helpers are named for what they hold and are called only from selftest.
defined = {n.name: n.lineno for n in tree.body
           if isinstance(n, ast.FunctionDef)
           and not n.name.startswith(("cmd_", "_check", "_statusline"))
           and n.name not in {"selftest"}}

used = set()
in_test = {n.name for n in tree.body
           if isinstance(n, ast.FunctionDef) and (n.name == "selftest" or n.name.startswith("_"))
           and any(isinstance(d, ast.Constant) for d in ast.walk(n))}


class Calls(ast.NodeVisitor):
    def __init__(self, skip):
        self.skip = skip

    def visit_FunctionDef(self, node):
        if node.name in self.skip:
            return                      # a helper calling another helper proves nothing
        self.generic_visit(node)

    def visit_Name(self, node):
        used.add(node.id)


tests = {n for n in defined if n.startswith("_") and n.endswith(
    ("_holds", "_hold", "_is_safe", "_intact", "_a_login", "_the_trail"))} | {"selftest"}
Calls(tests).visit(tree)

orphans = sorted((line, name) for name, line in defined.items()
                 if name not in used and name not in tests)
if orphans:
    for line, name in orphans:
        print(f"bin/oms:{line}: {name}() is defined and nothing outside the tests uses it")
    sys.exit(f"\n{len(orphans)} thing(s) built and not wired up")
print(f"checked {len(defined)} definitions: everything built is used")
