"""JSON API endpoints called by the frontend."""
from datetime import date as date_cls

from flask import Blueprint, current_app, jsonify, request

from .. import pricing
from ..barcode import normalize
from ..database import get_db
from ..errors import AppError
from ..services import drawer, inventory, sales

bp = Blueprint("api", __name__, url_prefix="/api")


def _cfg():
    return current_app.config


def _json():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise AppError("Invalid request data.", code="bad_request")
    return data


# ---------- Products ----------

@bp.get("/products/by-barcode/<path:barcode>")
def product_by_barcode(barcode):
    """Scanner lookup: return product if already in database."""
    code = normalize(barcode, _cfg()["STRICT_BARCODE_CHECKSUM"])
    product = inventory.find_by_barcode(get_db(), code)
    return jsonify({"ok": True, "barcode": code, "product": product})



@bp.get("/products")
def products():
    items = inventory.list_products(
        get_db(),
        query=request.args.get("q", "").strip(),
        low_only=request.args.get("low") == "1",
    )
    return jsonify({"ok": True, "products": items,
                    "summary": inventory.inventory_summary(get_db())})


@bp.patch("/products/<int:product_id>")
def update_product(product_id):
    p = inventory.update_product(get_db(), _cfg(), product_id, _json())
    return jsonify({"ok": True, "product": p})


@bp.post("/products/<int:product_id>/adjust")
def adjust_product(product_id):
    data = _json()
    p = inventory.adjust_stock(get_db(), _cfg(), product_id, data.get("stock"), data.get("note"))
    return jsonify({"ok": True, "product": p})


@bp.delete("/products/<int:product_id>")
def delete_product(product_id):
    inventory.delete_product(get_db(), product_id)
    return jsonify({"ok": True})


# ---------- Stock in ----------

@bp.post("/pricing/preview")
def pricing_preview():
    data = _json()
    qty = inventory.parse_qty(data.get("qty", 1), _cfg()["MAX_QTY_PER_LINE"])
    calc = pricing.preview(data.get("cost"), data.get("markup_pct"), qty,
                           _cfg()["PRICE_ROUND_STEP_CENTS"])
    return jsonify({"ok": True, "calc": calc})


@bp.post("/stock-in")
def stock_in():
    data = _json()
    result = inventory.stock_in(
        get_db(), _cfg(),
        barcode=data.get("barcode"), name=data.get("name"),
        cost=data.get("cost"), markup_pct=data.get("markup_pct"), qty=data.get("qty", 1),
    )
    return jsonify({"ok": True, **result})


# ---------- Benta ----------

@bp.post("/sales/checkout")
def checkout():
    data = _json()
    sale = sales.checkout(get_db(), _cfg(), data.get("items"), data.get("cash"))
    return jsonify({"ok": True, "sale": sale})


@bp.get("/sales")
def sales_list():
    day = request.args.get("date") or date_cls.today().isoformat()
    return jsonify({"ok": True, "date": day, "sales": sales.list_sales(get_db(), day)})


@bp.post("/sales/<int:sale_id>/void")
def void_sale(sale_id):
    return jsonify({"ok": True, "sale": sales.void_sale(get_db(), sale_id)})


@bp.get("/reports/summary")
def report_summary():
    day = request.args.get("date") or date_cls.today().isoformat()
    return jsonify({
        "ok": True,
        "date": day,
        "summary": sales.daily_summary(get_db(), day),
        "inventory": inventory.inventory_summary(get_db()),
        "drawer": drawer.get_drawer_summary(get_db(), day),
    })


# ---------- Cash Drawer & Change Management ----------

@bp.get("/drawer")
def drawer_info():
    day = request.args.get("date") or date_cls.today().isoformat()
    return jsonify({
        "ok": True,
        "date": day,
        "summary": drawer.get_drawer_summary(get_db(), day),
        "movements": drawer.list_cash_movements(get_db(), day),
    })


@bp.post("/drawer/movements")
def drawer_add_movement():
    data = _json()
    movement = drawer.add_cash_movement(
        get_db(),
        kind=data.get("kind", "add_change"),
        category=data.get("category", "mixed"),
        amount=data.get("amount"),
        note=data.get("note", ""),
        denominations=data.get("denominations"),
    )
    return jsonify({
        "ok": True,
        "movement": movement,
        "summary": drawer.get_drawer_summary(get_db()),
    })


@bp.post("/drawer/counts")
def drawer_record_count():
    data = _json()
    count = drawer.record_drawer_count(
        get_db(),
        counts_data=data.get("counts") or data,
        note=data.get("note", ""),
    )
    return jsonify({
        "ok": True,
        "count": count,
        "summary": drawer.get_drawer_summary(get_db()),
    })


@bp.get("/drawer/change-breakdown")
def drawer_change_breakdown():
    cents_raw = request.args.get("cents")
    amount_raw = request.args.get("amount")
    if cents_raw is not None:
        try:
            cents = int(cents_raw)
        except ValueError:
            raise AppError("Invalid cents value.", code="bad_request")
    elif amount_raw is not None:
        cents = pricing.to_cents(amount_raw, "change amount")
    else:
        cents = 0

    return jsonify({
        "ok": True,
        "cents": cents,
        "breakdown": drawer.suggest_change_breakdown(cents),
    })


# ---------- Calendar & Earnings Overview ----------

@bp.get("/calendar/month")
def calendar_month():
    today = date_cls.today()
    current_ym = today.strftime("%Y-%m")
    month = request.args.get("month") or current_ym

    if month > current_ym:
        raise AppError("Future months cannot be accessed.", code="future_date_blocked", status=400)

    summary = sales.monthly_calendar_summary(get_db(), month)
    return jsonify({
        "ok": True,
        "month": month,
        "current_month": current_ym,
        "today": today.isoformat(),
        "summary": summary,
    })


@bp.get("/calendar/day")
def calendar_day():
    today_str = date_cls.today().isoformat()
    day = request.args.get("date") or today_str

    if day > today_str:
        raise AppError("Future dates cannot be accessed. Only past and present dates are available.",
                       code="future_date_blocked", status=400)

    return jsonify({
        "ok": True,
        "date": day,
        "today": today_str,
        "summary": sales.daily_summary(get_db(), day),
        "sales": sales.list_sales(get_db(), day),
    })
