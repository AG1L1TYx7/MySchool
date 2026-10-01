"""Deterministic arithmetic and algebra checks without executing code (docs/10 section 4)."""

from __future__ import annotations

import ast
import math
import operator
from fractions import Fraction
from typing import Any

_BIN = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.Mod: operator.mod,
    ast.FloorDiv: operator.floordiv,
}
_UNARY = {ast.UAdd: operator.pos, ast.USub: operator.neg}
_FUNCS: dict[str, Any] = {"sqrt": math.sqrt, "abs": abs, "round": round}
_MAX_LEN = 200
_MAX_POWER = 1000


class MathError(ValueError):
    pass


def evaluate(expression: str, variables: dict[str, float] | None = None) -> float:
    """Evaluates +, -, *, /, ** (bounded), %, //, sqrt, abs, round and named variables. Nothing else."""
    if len(expression) > _MAX_LEN:
        raise MathError("expression too long")
    try:
        tree = ast.parse(expression.replace("^", "**"), mode="eval")
    except SyntaxError as e:
        raise MathError("not a valid expression") from e
    return float(_eval(tree.body, variables or {}))


def _eval(node: ast.AST, variables: dict[str, float]) -> float:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return float(node.value)
    if isinstance(node, ast.Name):
        if node.id in variables:
            return float(variables[node.id])
        raise MathError(f"unknown variable '{node.id}'")
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
        return _UNARY[type(node.op)](_eval(node.operand, variables))
    if isinstance(node, ast.BinOp) and type(node.op) in _BIN:
        left, right = _eval(node.left, variables), _eval(node.right, variables)
        if isinstance(node.op, ast.Pow) and abs(right) > _MAX_POWER:
            raise MathError("exponent too large")
        if isinstance(node.op, (ast.Div, ast.FloorDiv, ast.Mod)) and right == 0:
            raise MathError("division by zero")
        return float(_BIN[type(node.op)](left, right))
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCS and not node.keywords:
        args = [_eval(a, variables) for a in node.args]
        return float(_FUNCS[node.func.id](*args))
    raise MathError("unsupported expression")


def check_equation(left: str, right: str, variables: dict[str, float] | None = None) -> bool:
    """True when both sides evaluate to the same value (to 1e-9), e.g. check_equation('2*x+3', '11', {'x': 4})."""
    return math.isclose(evaluate(left, variables), evaluate(right, variables), rel_tol=1e-9, abs_tol=1e-9)


def simplify_fraction(numerator: int, denominator: int) -> str:
    if denominator == 0:
        raise MathError("division by zero")
    f = Fraction(numerator, denominator)
    return f"{f.numerator}/{f.denominator}" if f.denominator != 1 else str(f.numerator)


def run_tool(arguments: dict[str, Any]) -> dict[str, Any]:
    """Tool entry point used by the orchestrator: {expression} or {left, right, variables}."""
    try:
        variables = {str(k): float(v) for k, v in (arguments.get("variables") or {}).items()}
        if "left" in arguments and "right" in arguments:
            ok = check_equation(str(arguments["left"]), str(arguments["right"]), variables)
            return {"ok": True, "equal": ok}
        value = evaluate(str(arguments.get("expression", "")), variables)
        return {"ok": True, "value": value}
    except (MathError, ValueError, OverflowError) as e:
        return {"ok": False, "error": str(e)}
