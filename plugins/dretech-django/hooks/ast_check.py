#!/usr/bin/env python3
"""
Django styleguide AST helper (stdlib only).

CLI:
    python hooks/ast_check.py --role <service|selector|view|api|task|model> --file <path-or->

Reads file content from stdin when --file is `-`.
Always exits 0 for successful analysis (even with findings). Non-zero only on
unexpected crashes. On SyntaxError: prints {"findings":[],"error":"syntax"} and
exits 0 (fail-open contract for the Node hook).

Semantic rules (SVC-001 keyword-only, SVC-002 full_clean-before-save) are only
enforced when --role is `service` or `selector`.
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
from typing import Any, Iterable, Optional


SEMANTIC_ROLES = {"service", "selector"}

RULE_KEYWORD_ONLY = "SVC-001"
RULE_FULL_CLEAN = "SVC-002"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def analyze(source: str, role: str = "service") -> dict[str, Any]:
    """Parse *source* and return a findings payload.

    Always returns a dict with at least a ``findings`` list. On SyntaxError the
    payload is ``{"findings": [], "error": "syntax"}``.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return {"findings": [], "error": "syntax"}

    if role not in SEMANTIC_ROLES:
        return {"findings": []}

    findings: list[dict[str, Any]] = []
    for node in tree.body:
        _walk_top_level(node, findings)
    return {"findings": findings}


def run_cli(argv: Optional[list[str]] = None) -> int:
    """CLI entry point. Returns process exit code (always 0 on analysis success)."""
    parser = argparse.ArgumentParser(description="Django styleguide AST checker")
    parser.add_argument(
        "--role",
        required=True,
        choices=["service", "selector", "view", "api", "task", "model"],
        help="File role; semantic checks only for service/selector",
    )
    parser.add_argument(
        "--file",
        required=True,
        help="Path to a Python file, or '-' to read from stdin",
    )
    args = parser.parse_args(argv)

    if args.file == "-":
        source = sys.stdin.read()
    else:
        with open(args.file, "r", encoding="utf-8") as fh:
            source = fh.read()

    payload = analyze(source, role=args.role)
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    return 0


# ---------------------------------------------------------------------------
# Walkers
# ---------------------------------------------------------------------------

def _walk_top_level(node: ast.AST, findings: list[dict[str, Any]]) -> None:
    """Inspect top-level functions and class methods; skip nested defs."""
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        _check_function(node, findings)
    elif isinstance(node, ast.ClassDef):
        for item in node.body:
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                _check_function(item, findings)


def _is_public(name: str) -> bool:
    return not name.startswith("_")


def _check_function(
    fn: ast.FunctionDef | ast.AsyncFunctionDef,
    findings: list[dict[str, Any]],
) -> None:
    if not _is_public(fn.name):
        return
    _check_keyword_only(fn, findings)
    _check_full_clean_dominance(fn, findings)


# ---------------------------------------------------------------------------
# SVC-001: keyword-only arguments
# ---------------------------------------------------------------------------

def _check_keyword_only(
    fn: ast.FunctionDef | ast.AsyncFunctionDef,
    findings: list[dict[str, Any]],
) -> None:
    args = fn.args

    # Collect non-self/cls positional-or-keyword params
    posonly = list(args.posonlyargs)
    plain = list(args.args)
    all_pos = posonly + plain

    # Drop leading self/cls
    non_self: list[ast.arg] = []
    for i, arg in enumerate(all_pos):
        if i == 0 and arg.arg in ("self", "cls"):
            continue
        non_self.append(arg)

    # *args present?
    has_varargs = args.vararg is not None

    # Exempt: 0 or 1 non-self parameter (and no *args to flag for 0/1-arg cases
    # that are otherwise exempt — *args with >=2 kwonly would still be >1 total,
    # but the plan says: flag *args for non-exempt public services. "Non-exempt"
    # means the function would otherwise require keyword-only, i.e. >1 non-self
    # params OR has *args that expands the signature. Spec: "*args in a
    # non-exempt public service/selector is a violation." And "0 or 1 non-self
    # parameter is exempt from *,." So *args alone (no other params) is still
    # 0 fixed params → exempt? Spec says: "flag positional-or-keyword params
    # and *args for non-exempt public functions/methods." Non-exempt = >1
    # non-self params. *args with 2+ kwonlys is non-exempt.
    #
    # Practical rule matching the acceptance matrix:
    # - count non-self fixed params (posonly + plain + kwonly)
    # - if total fixed non-self params <= 1 AND no *args → exempt
    # - if *args present AND (fixed non-self + indication of multi-arg) → flag
    # - if any non-self positional-or-keyword params exist when total > 1 → flag

    kwonly = list(args.kwonlyargs)
    fixed_count = len(non_self) + len(kwonly)

    # *args always counts as making the function non-exempt when there are also
    # other params (the acceptance test: `*args, email, name`).
    if has_varargs and (fixed_count >= 1 or len(non_self) + len(kwonly) >= 1):
        findings.append(
            {
                "rule_id": RULE_KEYWORD_ONLY,
                "severity": "CRITICAL",
                "line": fn.lineno,
                "message": (
                    f"Service/selector '{fn.name}' uses *args; public multi-arg "
                    "functions must be keyword-only (def f(*, a, b))"
                ),
            }
        )
        return

    if fixed_count <= 1:
        return  # exempt

    # Non-exempt: any remaining positional-or-keyword (non-self) params are a violation
    if non_self:
        findings.append(
            {
                "rule_id": RULE_KEYWORD_ONLY,
                "severity": "CRITICAL",
                "line": fn.lineno,
                "message": (
                    f"Service/selector '{fn.name}' must use keyword-only arguments "
                    "(def f(*, a, b)); positional parameters are not allowed when "
                    "there is more than one non-self parameter"
                ),
            }
        )


# ---------------------------------------------------------------------------
# SVC-002: full_clean must dominate every save on the same receiver
# ---------------------------------------------------------------------------

def _receiver_key(node: ast.AST) -> Optional[str]:
    """Return a stable string key for a simple Name / attribute-chain receiver.

    Returns None for anything we cannot match (calls, subscripts, etc.) — those
    are treated as unvalidated by the caller.
    """
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _receiver_key(node.value)
        if base is None:
            return None
        return f"{base}.{node.attr}"
    return None


def _unwrap_await(node: ast.AST) -> ast.AST:
    if isinstance(node, ast.Await):
        return _unwrap_await(node.value)
    return node


def _is_method_call(node: ast.AST, method_name: str) -> Optional[str]:
    """If *node* is a call to ``<receiver>.method_name(...)`` (possibly awaited),
    return the receiver key; else None.
    """
    node = _unwrap_await(node)
    if not isinstance(node, ast.Call):
        return None
    func = node.func
    if not isinstance(func, ast.Attribute):
        return None
    if func.attr != method_name:
        return None
    return _receiver_key(func.value)


def _check_full_clean_dominance(
    fn: ast.FunctionDef | ast.AsyncFunctionDef,
    findings: list[dict[str, Any]],
) -> None:
    """Require that every save() is dominated by a matching full_clean() on the
    same receiver along every straight-line path through the function body.
    """
    # Analyze the function body as a sequence of statements with branch joins.
    # We track the set of receivers that have been full_clean()'d on EVERY path
    # reaching the current point (must-set / intersection semantics).
    cleaned = _analyze_block(fn.body)

    # `_analyze_block` reports findings for saves that aren't dominated; we just
    # need it to mutate `findings`.
    # Re-run with findings collection:
    _analyze_block_collect(fn.body, frozenset(), findings)


def _analyze_block(
    body: list[ast.stmt],
) -> frozenset[str]:
    """Return the set of receivers known-cleaned after *body* (intersection)."""
    # Pure analysis without findings — used only if needed. Real work is in
    # _analyze_block_collect. Kept for clarity / potential reuse.
    cleaned: set[str] = set()
    # Not used by the collector path; stub.
    return frozenset(cleaned)


def _analyze_block_collect(
    body: list[ast.stmt],
    cleaned_in: frozenset[str],
    findings: list[dict[str, Any]],
) -> frozenset[str]:
    """Walk *body* statements, emitting SVC-002 findings for undominated saves.

    Returns the set of receivers that are cleaned on every path through *body*,
    starting from *cleaned_in*.
    """
    cleaned: set[str] = set(cleaned_in)

    for stmt in body:
        # Unwrap Expr of Await / Call for bare method calls as statements
        if isinstance(stmt, ast.Expr):
            _handle_expr(stmt.value, cleaned, findings)
            continue

        if isinstance(stmt, ast.Assign):
            # Right-hand side may be a call we don't care about for cleaning.
            # Left-hand side rebinding: if we rebind a name that was cleaned,
            # drop it (conservative).
            for target in stmt.targets:
                key = _receiver_key(target)
                if key is not None and key in cleaned:
                    cleaned.discard(key)
                # Also drop any attribute-chain starting with this name
                if isinstance(target, ast.Name):
                    prefix = target.id + "."
                    cleaned = {c for c in cleaned if not c.startswith(prefix) and c != target.id}
            # RHS call may itself be full_clean/save (unusual but handle)
            _handle_expr(stmt.value, cleaned, findings)
            continue

        if isinstance(stmt, ast.AnnAssign):
            if stmt.target is not None:
                key = _receiver_key(stmt.target)
                if key is not None and key in cleaned:
                    cleaned.discard(key)
            if stmt.value is not None:
                _handle_expr(stmt.value, cleaned, findings)
            continue

        if isinstance(stmt, ast.AugAssign):
            key = _receiver_key(stmt.target)
            if key is not None and key in cleaned:
                cleaned.discard(key)
            _handle_expr(stmt.value, cleaned, findings)
            continue

        if isinstance(stmt, ast.If):
            then_cleaned = _analyze_block_collect(stmt.body, frozenset(cleaned), findings)
            else_body = stmt.orelse if stmt.orelse else []
            else_cleaned = _analyze_block_collect(else_body, frozenset(cleaned), findings)
            # Only receivers cleaned on BOTH branches remain cleaned afterwards
            cleaned = set(then_cleaned & else_cleaned)
            continue

        if isinstance(stmt, (ast.For, ast.AsyncFor, ast.While)):
            # Conservatively: analyze the loop body once starting from current
            # cleaned set (finds saves inside the loop), but do NOT assume any
            # new cleans dominate after the loop (loop may not run).
            _analyze_block_collect(stmt.body, frozenset(cleaned), findings)
            if stmt.orelse:
                # else runs only if loop didn't break; still intersect
                else_cleaned = _analyze_block_collect(stmt.orelse, frozenset(cleaned), findings)
                cleaned = set(frozenset(cleaned) & else_cleaned)
            # Loop body cleans do not dominate post-loop
            continue

        if isinstance(stmt, ast.With) or isinstance(stmt, ast.AsyncWith):
            cleaned = set(_analyze_block_collect(stmt.body, frozenset(cleaned), findings))
            continue

        if isinstance(stmt, ast.Try):
            # Body
            try_cleaned = _analyze_block_collect(stmt.body, frozenset(cleaned), findings)
            # Each handler starts from pre-try cleaned (exception may fire anytime)
            handler_sets = []
            for handler in stmt.handlers:
                handler_sets.append(
                    _analyze_block_collect(handler.body, frozenset(cleaned), findings)
                )
            else_cleaned = (
                _analyze_block_collect(stmt.orelse, try_cleaned, findings)
                if stmt.orelse
                else try_cleaned
            )
            # finally always runs
            # Post-try cleaned = intersection of (try+else) and all handlers,
            # then finally applied on top. Conservatively intersect everything.
            candidates = [else_cleaned] + handler_sets
            if candidates:
                inter = candidates[0]
                for s in candidates[1:]:
                    inter = inter & s
            else:
                inter = try_cleaned
            cleaned = set(_analyze_block_collect(stmt.finalbody, inter, findings))
            continue

        if isinstance(stmt, (ast.Return, ast.Raise, ast.Break, ast.Continue)):
            # Control leaves this block; no further dominance concerns here.
            # Still check any value expression.
            if isinstance(stmt, ast.Return) and stmt.value is not None:
                _handle_expr(stmt.value, cleaned, findings)
            if isinstance(stmt, ast.Raise) and stmt.exc is not None:
                _handle_expr(stmt.exc, cleaned, findings)
            # After return/raise, treat cleaned as "everything" for join purposes
            # so we don't force intersection with dead code. Represent as a
            # sentinel by returning the current cleaned (caller intersects).
            return frozenset(cleaned)

        # Nested function/class definitions: out of scope (private/nested excluded)
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue

        # Other statements (Pass, Import, Delete, Assert, Global, Nonlocal, ...)
        # — ignore for dominance.

    return frozenset(cleaned)


def _handle_expr(
    expr: ast.AST,
    cleaned: set[str],
    findings: list[dict[str, Any]],
) -> None:
    """Process a single expression for full_clean / save method calls."""
    # Direct call (possibly awaited)
    receiver = _is_method_call(expr, "full_clean")
    if receiver is not None:
        cleaned.add(receiver)
        return

    receiver = _is_method_call(expr, "save")
    if receiver is not None:
        if receiver not in cleaned:
            line = getattr(expr, "lineno", 0) or 0
            # Prefer the line of the inner Call if Await-wrapped
            call_node = _unwrap_await(expr)
            line = getattr(call_node, "lineno", line) or line
            findings.append(
                {
                    "rule_id": RULE_FULL_CLEAN,
                    "severity": "CRITICAL",
                    "line": line,
                    "message": (
                        f"Call to .save() on '{receiver}' is not dominated by a "
                        f"matching .full_clean() on the same receiver; always call "
                        f"full_clean() before save()"
                    ),
                }
            )
        return

    # Walk into boolean ops / ternaries / etc. conservatively for nested calls
    for child in ast.iter_child_nodes(expr):
        if isinstance(child, (ast.Call, ast.Await)):
            _handle_expr(child, cleaned, findings)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    sys.exit(run_cli())


if __name__ == "__main__":
    main()
