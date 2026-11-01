"""Stock in, product listings, and inventory adjustments."""
from .. import pricing
from ..barcode import normalize
from ..database import now_str, transaction
from ..errors import AppError


def parse_qty(value, max_qty, minimum=1, field="quantity"):
    try:
        qty = int(str(value).strip())
    except (ValueError, AttributeError):
        raise AppError(f"Invalid {field}.", code="bad_qty")
    if qty < minimum or qty > max_qty:
        raise AppError(f"Invalid {field}.", code="bad_qty")
    return qty


def product_to_dict(row):
    if row is None:
        return None
    d = dict(row)
    d["is_low"] = d["stock"] <= d["low_stock_level"]
    d["is_out"] = d["stock"] == 0
    return d


def find_by_barcode(db, barcode):
    row = db.execute("SELECT * FROM products WHERE barcode = ?", (barcode,)).fetchone()
    return product_to_dict(row)


def get_product(db, product_id):
    row = db.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
    if row is None:
        raise AppError("Item not found.", status=404, code="not_found")
    return product_to_dict(row)


def list_products(db, query="", low_only=False):
    sql = "SELECT * FROM products"
    where, params = [], []
    if query:
        where.append("(name LIKE ? OR barcode LIKE ?)")
        like = f"%{query}%"
        params += [like, like]
    if low_only:
        where.append("stock <= low_stock_level")
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY name COLLATE NOCASE"
    return [product_to_dict(r) for r in db.execute(sql, params).fetchall()]


def stock_in(db, cfg, barcode, name, cost, markup_pct, qty):
    """Add stock. Creates a new item if the barcode is not yet registered.

    - cost = per unit purchase cost
    - new selling price is calculated using cost + markup%
    """
    code = normalize(barcode, cfg["STRICT_BARCODE_CHECKSUM"])
    qty = parse_qty(qty, cfg["MAX_QTY_PER_LINE"])
    calc = pricing.preview(cost, markup_pct, qty, cfg["PRICE_ROUND_STEP_CENTS"])
    name = (name or "").strip()

    with transaction(db):
        existing = db.execute("SELECT * FROM products WHERE barcode = ?", (code,)).fetchone()
        ts = now_str()

        if existing is None:
            if not name:
                raise AppError("This is a new item. Please enter the item name.", code="name_required")
            cur = db.execute(
                """INSERT INTO products
                   (barcode, name, cost_cents, markup_pct, price_cents, stock,
                    low_stock_level, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (code, name, calc["cost_cents"], calc["markup_pct"], calc["price_cents"],
                 qty, cfg["LOW_STOCK_DEFAULT"], ts, ts),
            )
            product_id = cur.lastrowid
            is_new = True
        else:
            product_id = existing["id"]
            new_name = name or existing["name"]
            db.execute(
                """UPDATE products
                   SET name = ?, cost_cents = ?, markup_pct = ?, price_cents = ?,
                       stock = stock + ?, updated_at = ?
                   WHERE id = ?""",
                (new_name, calc["cost_cents"], calc["markup_pct"], calc["price_cents"],
                 qty, ts, product_id),
            )
            is_new = False

        db.execute(
            """INSERT INTO stock_movements
               (product_id, kind, qty_change, cost_cents, note, created_at)
               VALUES (?, 'stock_in', ?, ?, ?, ?)""",
            (product_id, qty, calc["cost_cents"], "New item" if is_new else None, ts),
        )

    product = get_product(db, product_id)
    return {"product": product, "added_qty": qty, "is_new": is_new, "calc": calc}


def update_product(db, cfg, product_id, data):
    """Update name, price, markup%, or low-stock level (not stock quantity)."""
    current = get_product(db, product_id)
    name = (data.get("name", current["name"]) or "").strip()
    if not name:
        raise AppError("Item name is required.", code="name_required")

    cost_cents = current["cost_cents"]
    markup = current["markup_pct"]
    price = current["price_cents"]

    if "cost" in data:
        cost_cents = pricing.to_cents(data["cost"], "cost")
    if "markup_pct" in data:
        markup = float(pricing.to_pct(data["markup_pct"]))
    if "cost" in data or "markup_pct" in data:
        price = pricing.selling_price_cents(cost_cents, markup, cfg["PRICE_ROUND_STEP_CENTS"])
    if "price" in data and str(data["price"]).strip() != "":
        price = pricing.to_cents(data["price"], "price")  # manual custom price

    low = current["low_stock_level"]
    if "low_stock_level" in data:
        low = parse_qty(data["low_stock_level"], 100000, minimum=0, field="low stock level")

    with transaction(db):
        db.execute(
            """UPDATE products SET name = ?, cost_cents = ?, markup_pct = ?,
               price_cents = ?, low_stock_level = ?, updated_at = ? WHERE id = ?""",
            (name, cost_cents, markup, price, low, now_str(), product_id),
        )
    return get_product(db, product_id)


def adjust_stock(db, cfg, product_id, new_stock, note=None):
    """Adjust stock after a count (e.g. damaged, lost, or counting error)."""
    new_stock = parse_qty(new_stock, cfg["MAX_QTY_PER_LINE"] * 100, minimum=0, field="stock")
    with transaction(db):
        row = db.execute("SELECT stock FROM products WHERE id = ?", (product_id,)).fetchone()
        if row is None:
            raise AppError("Item not found.", status=404, code="not_found")
        diff = new_stock - row["stock"]
        ts = now_str()
        db.execute("UPDATE products SET stock = ?, updated_at = ? WHERE id = ?",
                   (new_stock, ts, product_id))
        if diff != 0:
            db.execute(
                """INSERT INTO stock_movements
                   (product_id, kind, qty_change, note, created_at)
                   VALUES (?, 'adjust', ?, ?, ?)""",
                (product_id, diff, (note or "Stock adjustment").strip(), ts),
            )
    return get_product(db, product_id)


def delete_product(db, product_id):
    """Only allow deleting items that have no sales history."""
    with transaction(db):
        used = db.execute("SELECT 1 FROM sale_items WHERE product_id = ? LIMIT 1",
                          (product_id,)).fetchone()
        if used:
            raise AppError(
                "This item has sales history and cannot be deleted. "
                "Set its stock to 0 instead.", code="has_sales")
        db.execute("DELETE FROM stock_movements WHERE product_id = ?", (product_id,))
        cur = db.execute("DELETE FROM products WHERE id = ?", (product_id,))
        if cur.rowcount == 0:
            raise AppError("Item not found.", status=404, code="not_found")



def inventory_summary(db):
    row = db.execute(
        """SELECT COUNT(*) AS items,
                  COALESCE(SUM(stock), 0) AS pieces,
                  COALESCE(SUM(stock * cost_cents), 0) AS cost_value,
                  COALESCE(SUM(stock * price_cents), 0) AS sales_value,
                  COALESCE(SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END), 0) AS out_count,
                  COALESCE(SUM(CASE WHEN stock > 0 AND stock <= low_stock_level
                                    THEN 1 ELSE 0 END), 0) AS low_count
           FROM products"""
    ).fetchone()
    return dict(row)
