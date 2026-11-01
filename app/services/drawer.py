"""Cash drawer management, denomination counting, and change replenishment."""
import json
from datetime import date as date_cls

from ..database import now_str, transaction
from ..errors import AppError
from .. import pricing

# Standard Philippine Peso denominations
BILL_DENOMINATIONS = [
    {"code": "1000", "label": "₱1,000 Bill", "cents": 100000},
    {"code": "500", "label": "₱500 Bill", "cents": 50000},
    {"code": "200", "label": "₱200 Bill", "cents": 20000},
    {"code": "100", "label": "₱100 Bill", "cents": 10000},
    {"code": "50", "label": "₱50 Bill", "cents": 5000},
    {"code": "20", "label": "₱20 Bill", "cents": 2000},
]

COIN_DENOMINATIONS = [
    {"code": "20", "label": "₱20 Coin", "cents": 2000},
    {"code": "10", "label": "₱10 Coin", "cents": 1000},
    {"code": "5", "label": "₱5 Coin", "cents": 500},
    {"code": "1", "label": "₱1 Coin", "cents": 100},
    {"code": "0.25", "label": "25¢ Coin", "cents": 25},
]


def get_denominations():
    """Return standard denominations metadata for frontend and calculations."""
    return {
        "bills": BILL_DENOMINATIONS,
        "coins": COIN_DENOMINATIONS,
    }


def suggest_change_breakdown(change_cents):
    """Breakdown change amount into suggested bills and coins."""
    if not isinstance(change_cents, int) or change_cents <= 0:
        return []

    remaining = change_cents
    breakdown = []

    # Prefer larger paper bills first
    for b in BILL_DENOMINATIONS:
        if remaining >= b["cents"]:
            count = remaining // b["cents"]
            remaining %= b["cents"]
            breakdown.append({
                "type": "bill",
                "code": b["code"],
                "label": b["label"],
                "unit_cents": b["cents"],
                "count": count,
                "subtotal_cents": count * b["cents"],
            })

    # Then coins
    for c in COIN_DENOMINATIONS:
        if c["cents"] == 2000 and any(item["type"] == "bill" and item["code"] == "20" for item in breakdown):
            continue  # ₱20 already used as bill
        if remaining >= c["cents"]:
            count = remaining // c["cents"]
            remaining %= c["cents"]
            breakdown.append({
                "type": "coin",
                "code": c["code"],
                "label": c["label"],
                "unit_cents": c["cents"],
                "count": count,
                "subtotal_cents": count * c["cents"],
            })

    return breakdown


def add_cash_movement(db, kind, category, amount=None, note="", denominations=None, amount_cents=None):
    """Add a cash movement (change fund replenishment, initial float, or cash out)."""
    if kind not in ("add_change", "initial_float", "cash_out"):
        raise AppError("Invalid movement kind. Must be add_change, initial_float, or cash_out.",
                       code="invalid_kind")

    if category not in ("coins", "bills", "mixed"):
        raise AppError("Invalid category. Must be coins, bills, or mixed.", code="invalid_category")

    if amount_cents is not None:
        final_cents = int(amount_cents)
    elif amount is not None:
        final_cents = pricing.to_cents(amount, "amount")
    else:
        raise AppError("Amount is required.", code="invalid_amount")

    if final_cents <= 0:
        raise AppError("Amount must be greater than zero.", code="invalid_amount")

    denoms_json = None
    if denominations:
        if isinstance(denominations, str):
            denoms_json = denominations
        else:
            denoms_json = json.dumps(denominations)

    ts = now_str()
    with transaction(db):
        movement_id = db.execute(
            """INSERT INTO cash_movements
               (kind, category, amount_cents, note, denominations_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (kind, category, final_cents, (note or "").strip(), denoms_json, ts),
        ).lastrowid

    row = db.execute("SELECT * FROM cash_movements WHERE id = ?", (movement_id,)).fetchone()
    out = dict(row)
    if out.get("denominations_json"):
        try:
            out["denominations"] = json.loads(out["denominations_json"])
        except Exception:
            out["denominations"] = None
    return out


def record_drawer_count(db, counts_data, note=""):
    """Save a physical count of register bills and coins."""
    if not isinstance(counts_data, dict):
        raise AppError("Invalid counts data.", code="invalid_counts")

    bills_input = counts_data.get("bills") or {}
    coins_input = counts_data.get("coins") or {}

    bills_cents = 0
    coins_cents = 0

    bill_map = {b["code"]: b["cents"] for b in BILL_DENOMINATIONS}
    coin_map = {c["code"]: c["cents"] for c in COIN_DENOMINATIONS}

    clean_bills = {}
    for code, cents in bill_map.items():
        qty = int(bills_input.get(code) or 0)
        if qty < 0:
            raise AppError("Denomination counts cannot be negative.", code="invalid_counts")
        clean_bills[code] = qty
        bills_cents += qty * cents

    clean_coins = {}
    for code, cents in coin_map.items():
        qty = int(coins_input.get(code) or 0)
        if qty < 0:
            raise AppError("Denomination counts cannot be negative.", code="invalid_counts")
        clean_coins[code] = qty
        coins_cents += qty * cents

    total_cents = bills_cents + coins_cents
    denoms_json = json.dumps({"bills": clean_bills, "coins": clean_coins})
    ts = now_str()

    with transaction(db):
        count_id = db.execute(
            """INSERT INTO drawer_counts
               (total_cents, bills_cents, coins_cents, denominations_json, note, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (total_cents, bills_cents, coins_cents, denoms_json, (note or "").strip(), ts),
        ).lastrowid

    row = db.execute("SELECT * FROM drawer_counts WHERE id = ?", (count_id,)).fetchone()
    out = dict(row)
    out["denominations"] = {"bills": clean_bills, "coins": clean_coins}
    return out


def list_cash_movements(db, day=None):
    """List cash drawer movements for a given day (defaults to today)."""
    day = day or date_cls.today().isoformat()
    rows = db.execute(
        """SELECT * FROM cash_movements
           WHERE date(created_at) = ?
           ORDER BY id DESC""",
        (day,),
    ).fetchall()

    results = []
    for r in rows:
        item = dict(r)
        if item.get("denominations_json"):
            try:
                item["denominations"] = json.loads(item["denominations_json"])
            except Exception:
                item["denominations"] = None
        results.append(item)
    return results


def get_latest_drawer_count(db, day=None):
    """Get the most recent drawer count for the given day."""
    day = day or date_cls.today().isoformat()
    row = db.execute(
        """SELECT * FROM drawer_counts
           WHERE date(created_at) = ?
           ORDER BY id DESC LIMIT 1""",
        (day,),
    ).fetchone()
    if not row:
        return None
    out = dict(row)
    try:
        out["denominations"] = json.loads(out["denominations_json"])
    except Exception:
        out["denominations"] = None
    return out


def get_drawer_summary(db, day=None):
    """Compute expected register cash, movements breakdown, and audit variance."""
    day = day or date_cls.today().isoformat()

    # Cash from completed sales: cash_cents - change_cents = total_cents of paid cash sales
    sales_row = db.execute(
        """SELECT COALESCE(SUM(total_cents), 0) AS sales_cash_cents,
                  COALESCE(SUM(cash_cents), 0) AS tendered_cents,
                  COALESCE(SUM(change_cents), 0) AS change_given_cents,
                  COUNT(*) AS sales_count
           FROM sales
           WHERE status = 'paid' AND date(created_at) = ?""",
        (day,),
    ).fetchone()

    # Cash movements today
    movements_row = db.execute(
        """SELECT
             COALESCE(SUM(CASE WHEN kind = 'initial_float' THEN amount_cents ELSE 0 END), 0) AS float_cents,
             COALESCE(SUM(CASE WHEN kind = 'add_change' THEN amount_cents ELSE 0 END), 0) AS added_change_cents,
             COALESCE(SUM(CASE WHEN kind = 'add_change' AND category = 'coins' THEN amount_cents ELSE 0 END), 0) AS added_change_coins_cents,
             COALESCE(SUM(CASE WHEN kind = 'add_change' AND category = 'bills' THEN amount_cents ELSE 0 END), 0) AS added_change_bills_cents,
             COALESCE(SUM(CASE WHEN kind = 'add_change' AND category = 'mixed' THEN amount_cents ELSE 0 END), 0) AS added_change_mixed_cents,
             COALESCE(SUM(CASE WHEN kind = 'cash_out' THEN amount_cents ELSE 0 END), 0) AS cash_out_cents
           FROM cash_movements
           WHERE date(created_at) = ?""",
        (day,),
    ).fetchone()

    sales_cash = sales_row["sales_cash_cents"]
    tendered = sales_row["tendered_cents"]
    change_given = sales_row["change_given_cents"]
    sales_count = sales_row["sales_count"]

    initial_float = movements_row["float_cents"]
    added_change = movements_row["added_change_cents"]
    added_coins = movements_row["added_change_coins_cents"]
    added_bills = movements_row["added_change_bills_cents"]
    added_mixed = movements_row["added_change_mixed_cents"]
    cash_out = movements_row["cash_out_cents"]

    # Expected cash in register = Starting float + Added change fund + Net cash from sales - Cash withdrawals
    expected_cash_cents = initial_float + added_change + sales_cash - cash_out

    latest_count = get_latest_drawer_count(db, day)
    variance_cents = None
    if latest_count:
        variance_cents = latest_count["total_cents"] - expected_cash_cents

    return {
        "date": day,
        "expected_cash_cents": expected_cash_cents,
        "initial_float_cents": initial_float,
        "added_change_cents": added_change,
        "added_change_breakdown": {
            "coins_cents": added_coins,
            "bills_cents": added_bills,
            "mixed_cents": added_mixed,
        },
        "sales_cash_cents": sales_cash,
        "tendered_cents": tendered,
        "change_given_cents": change_given,
        "sales_count": sales_count,
        "cash_out_cents": cash_out,
        "latest_count": latest_count,
        "variance_cents": variance_cents,
        "denominations": get_denominations(),
    }
