"""Price calculation using Decimal (avoids float precision errors)."""
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal, InvalidOperation

from .errors import AppError

HUNDRED = Decimal(100)


def to_cents(value, field="amount"):
    """'12.5' or 12.5 -> 1250. Accepts peso/currency string or number, returns centavos integer."""
    try:
        d = Decimal(str(value).strip().replace(",", ""))
    except (InvalidOperation, AttributeError):
        raise AppError(f"Invalid {field}.", code="bad_number")
    if not d.is_finite() or d < 0:
        raise AppError(f"Invalid {field}.", code="bad_number")
    return int((d * HUNDRED).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def to_pct(value):
    try:
        d = Decimal(str(value).strip())
    except (InvalidOperation, AttributeError):
        raise AppError("Invalid markup percentage.", code="bad_number")
    if not d.is_finite() or d < 0 or d > 10000:
        raise AppError("Invalid markup percentage.", code="bad_number")
    return d


def selling_price_cents(cost_cents, markup_pct, step_cents=100):
    """price = cost + markup%, rounded UP to step_cents."""
    step = Decimal(max(int(step_cents), 1))
    raw = Decimal(int(cost_cents)) * (Decimal(1) + Decimal(str(markup_pct)) / HUNDRED)
    steps = (raw / step).to_integral_value(rounding=ROUND_CEILING)
    return int(steps * step)


def money(cents):
    """1250 -> '₱12.50' (formatted currency)."""
    return f"₱{cents / 100:,.2f}"


def preview(cost, markup_pct, qty, step_cents):
    """Calculate all numbers shown on Stock In prior to saving."""
    cost_cents = to_cents(cost, "cost")
    pct = to_pct(markup_pct)
    qty = int(qty)
    price = selling_price_cents(cost_cents, pct, step_cents)
    return {
        "cost_cents": cost_cents,
        "markup_pct": float(pct),
        "price_cents": price,
        "profit_each_cents": price - cost_cents,
        "qty": qty,
        "total_cost_cents": cost_cents * qty,
        "total_sales_cents": price * qty,
        "total_profit_cents": (price - cost_cents) * qty,
    }

