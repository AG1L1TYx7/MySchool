import pytest

from app.tools.math_tool import MathError, check_equation, evaluate, run_tool, simplify_fraction


def test_evaluates_arithmetic_and_functions() -> None:
    assert evaluate("2*(3+4)/7") == 2.0
    assert evaluate("2^3") == 8.0
    assert evaluate("sqrt(16) + abs(-2)") == 6.0
    assert evaluate("2*x + 3", {"x": 4}) == 11.0


def test_refuses_code_and_unknown_names() -> None:
    for bad in ("__import__('os')", "x.__class__", "open('f')", "lambda: 1", "1 if 2 else 3", "a", "2**99999"):
        with pytest.raises(MathError):
            evaluate(bad, {})
    with pytest.raises(MathError):
        evaluate("1/0")


def test_equation_check_and_fractions() -> None:
    assert check_equation("2*x+3", "11", {"x": 4})
    assert not check_equation("2*x+3", "12", {"x": 4})
    assert simplify_fraction(6, 8) == "3/4"
    assert simplify_fraction(8, 4) == "2"


def test_tool_entry_point_never_raises() -> None:
    assert run_tool({"expression": "3*3"}) == {"ok": True, "value": 9.0}
    assert run_tool({"left": "x+1", "right": "5", "variables": {"x": 4}}) == {"ok": True, "equal": True}
    assert run_tool({"expression": "import os"})["ok"] is False
