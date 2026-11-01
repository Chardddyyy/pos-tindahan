"""Web pages (HTML templates)."""
from flask import Blueprint, current_app, render_template

bp = Blueprint("pages", __name__)



def _page(template, active, **extra):
    cfg = current_app.config
    return render_template(template, active=active, store_name=cfg["STORE_NAME"],
                           default_markup=cfg["DEFAULT_MARKUP_PCT"], **extra)


@bp.get("/")
def pos():
    return _page("pos.html", "pos")


@bp.get("/stock-in")
def stock_in():
    return _page("stock_in.html", "stock_in")


@bp.get("/drawer")
def drawer():
    return _page("drawer.html", "drawer")


@bp.get("/calendar")
def calendar():
    return _page("calendar.html", "calendar")


@bp.get("/inventory")
def inventory():
    return _page("inventory.html", "inventory")


@bp.get("/reports")
def reports():
    return _page("reports.html", "reports")
