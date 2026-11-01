"""Checkout (payment), void, and sales reporting."""
from ..barcode import normalize
from ..database import now_str, transaction
from ..errors import AppError
from .. import pricing
from .inventory import parse_qty


def _collect_lines(db, cfg, items):
    """Merge lines for the same item and retrieve current price from database."""
    if not isinstance(items, list) or not items:
        raise AppError("Cart is empty.", code="empty_cart")

    wanted = {}  # product_id -> qty
    for item in items:
        qty = parse_qty(item.get("qty"), cfg["MAX_QTY_PER_LINE"])
        if item.get("product_id") is not None:
            row = db.execute("SELECT * FROM products WHERE id = ?",
                             (item["product_id"],)).fetchone()
        else:
            code = normalize(item.get("barcode"), cfg["STRICT_BARCODE_CHECKSUM"])
            row = db.execute("SELECT * FROM products WHERE barcode = ?", (code,)).fetchone()
        if row is None:
            raise AppError("Item not found in database. Please stock it in first.",
                           code="unknown_product")
        wanted[row["id"]] = wanted.get(row["id"], 0) + qty
    return wanted


def checkout(db, cfg, items, cash=None):
    """Record sale and decrement stock atomically."""
    with transaction(db):
        wanted = _collect_lines(db, cfg, items)

        lines, short = [], []
        total = 0
        for product_id, qty in wanted.items():
            p = db.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
            if p["stock"] < qty:
                short.append({"name": p["name"], "stock": p["stock"], "wanted": qty})
                continue
            line_total = p["price_cents"] * qty
            total += line_total
            lines.append((p, qty, line_total))

        if short:
            names = ", ".join(f"{s['name']} (remaining: {s['stock']})" for s in short)
            raise AppError(f"Insufficient stock: {names}", code="insufficient_stock",
                           details=short)

        cash_cents = total if cash in (None, "") else pricing.to_cents(cash, "cash tendered")
        if cash_cents < total:
            raise AppError(
                f"Insufficient cash payment. Total required: {pricing.money(total)}",
                code="insufficient_cash")
        change = cash_cents - total

        ts = now_str()
        sale_id = db.execute(
            """INSERT INTO sales (total_cents, cash_cents, change_cents, status, created_at)
               VALUES (?, ?, ?, 'paid', ?)""",
            (total, cash_cents, change, ts),
        ).lastrowid

        for p, qty, _line_total in lines:
            cur = db.execute(
                "UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ? AND stock >= ?",
                (qty, ts, p["id"], qty),
            )
            if cur.rowcount != 1:
                raise AppError(f"Insufficient stock: {p['name']}", code="insufficient_stock")
            db.execute(
                """INSERT INTO sale_items
                   (sale_id, product_id, barcode, name, qty, price_cents, cost_cents)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (sale_id, p["id"], p["barcode"], p["name"], qty,
                 p["price_cents"], p["cost_cents"]),
            )
            db.execute(
                """INSERT INTO stock_movements
                   (product_id, kind, qty_change, sale_id, created_at)
                   VALUES (?, 'sale', ?, ?, ?)""",
                (p["id"], -qty, sale_id, ts),
            )

    return get_sale(db, sale_id)


def get_sale(db, sale_id):
    sale = db.execute("SELECT * FROM sales WHERE id = ?", (sale_id,)).fetchone()
    if sale is None:
        raise AppError("Sale not found.", status=404, code="not_found")
    items = db.execute(
        "SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id", (sale_id,)
    ).fetchall()
    result = dict(sale)
    result["items"] = [
        {**dict(i), "line_total_cents": i["price_cents"] * i["qty"]} for i in items
    ]
    return result


def void_sale(db, sale_id):
    """Cancel sale and return items to stock."""
    with transaction(db):
        sale = db.execute("SELECT * FROM sales WHERE id = ?", (sale_id,)).fetchone()
        if sale is None:
            raise AppError("Sale not found.", status=404, code="not_found")
        if sale["status"] == "void":
            raise AppError("This sale has already been voided.", code="already_void")

        ts = now_str()
        items = db.execute("SELECT * FROM sale_items WHERE sale_id = ?", (sale_id,)).fetchall()
        for i in items:
            db.execute("UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?",
                       (i["qty"], ts, i["product_id"]))
            db.execute(
                """INSERT INTO stock_movements
                   (product_id, kind, qty_change, sale_id, note, created_at)
                   VALUES (?, 'void', ?, ?, 'Voided sale', ?)""",
                (i["product_id"], i["qty"], sale_id, ts),
            )
        db.execute("UPDATE sales SET status = 'void', voided_at = ? WHERE id = ?", (ts, sale_id))
    return get_sale(db, sale_id)


def list_sales(db, date):
    rows = db.execute(
        "SELECT id FROM sales WHERE date(created_at) = ? ORDER BY id DESC", (date,)
    ).fetchall()
    return [get_sale(db, r["id"]) for r in rows]


def daily_summary(db, date):
    """Daily total sales, cost of goods, and profit (excluding voided sales)."""

    row = db.execute(
        """SELECT COUNT(DISTINCT s.id) AS sales_count,
                  COALESCE(SUM(si.qty), 0) AS pieces,
                  COALESCE(SUM(si.qty * si.price_cents), 0) AS sales_cents,
                  COALESCE(SUM(si.qty * si.cost_cents), 0) AS cost_cents
           FROM sales s JOIN sale_items si ON si.sale_id = s.id
           WHERE s.status = 'paid' AND date(s.created_at) = ?""",
        (date,),
    ).fetchone()
    out = dict(row)
    out["profit_cents"] = out["sales_cents"] - out["cost_cents"]
    out["void_count"] = db.execute(
        "SELECT COUNT(*) FROM sales WHERE status = 'void' AND date(created_at) = ?", (date,)
    ).fetchone()[0]

    out["top_items"] = [
        dict(r) for r in db.execute(
            """SELECT si.name, SUM(si.qty) AS qty,
                      SUM(si.qty * si.price_cents) AS sales_cents
               FROM sales s JOIN sale_items si ON si.sale_id = s.id
               WHERE s.status = 'paid' AND date(s.created_at) = ?
               GROUP BY si.product_id ORDER BY qty DESC LIMIT 10""",
            (date,),
        ).fetchall()
    ]
    return out


def monthly_calendar_summary(db, year_month):
    """Monthly summary with overall totals and daily breakdown of sales and profit."""
    parts = year_month.split("-")
    if len(parts) != 2:
        raise AppError("Invalid month format. Expected YYYY-MM.", code="bad_request")

    rows = db.execute(
        """SELECT date(s.created_at) AS sale_date,
                  COUNT(DISTINCT s.id) AS sales_count,
                  COALESCE(SUM(si.qty), 0) AS pieces,
                  COALESCE(SUM(si.qty * si.price_cents), 0) AS sales_cents,
                  COALESCE(SUM(si.qty * si.cost_cents), 0) AS cost_cents
           FROM sales s JOIN sale_items si ON si.sale_id = s.id
           WHERE s.status = 'paid' AND strftime('%Y-%m', s.created_at) = ?
           GROUP BY date(s.created_at)
           ORDER BY sale_date ASC""",
        (year_month,),
    ).fetchall()

    days = {}
    month_sales = 0
    month_cost = 0
    month_pieces = 0
    month_count = 0

    for r in rows:
        sc = r["sales_cents"]
        cc = r["cost_cents"]
        pc = sc - cc
        days[r["sale_date"]] = {
            "date": r["sale_date"],
            "sales_cents": sc,
            "cost_cents": cc,
            "profit_cents": pc,
            "sales_count": r["sales_count"],
            "pieces": r["pieces"],
        }
        month_sales += sc
        month_cost += cc
        month_pieces += r["pieces"]
        month_count += r["sales_count"]

    month_profit = month_sales - month_cost

    return {
        "month": year_month,
        "sales_cents": month_sales,
        "cost_cents": month_cost,
        "profit_cents": month_profit,
        "sales_count": month_count,
        "pieces": month_pieces,
        "days": days,
    }
