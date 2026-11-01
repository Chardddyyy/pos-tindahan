"""Subukan ang buong daloy: stock in -> benta -> pagbawas ng stock.

Patakbuhin:  python -m unittest discover -s tests -v
"""
import os
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app, pricing  # noqa: E402
from app.barcode import has_valid_checksum, normalize  # noqa: E402
from app.errors import AppError  # noqa: E402

COKE = "4800016644801"   # may tamang check digit
NOODLES = "4800361019613"
UPC_A = "036000291452"   # 12 digits -> magiging 0036000291452


class PricingTests(unittest.TestCase):
    def test_markup_rounds_up_to_whole_peso(self):
        # 9.50 + 20% = 11.40 -> 12.00
        self.assertEqual(pricing.selling_price_cents(950, 20, 100), 1200)

    def test_exact_value_is_not_rounded_up_extra(self):
        # 10.00 + 20% = 12.00 eksakto, hindi dapat maging 13
        self.assertEqual(pricing.selling_price_cents(1000, 20, 100), 1200)

    def test_float_trap(self):
        # 0.1 + 0.2 problem: 8.50 + 10% = 9.35 -> 10
        self.assertEqual(pricing.selling_price_cents(850, 10, 100), 1000)

    def test_step_50_centavos(self):
        self.assertEqual(pricing.selling_price_cents(950, 20, 50), 1150)

    def test_to_cents(self):
        self.assertEqual(pricing.to_cents("12.5"), 1250)
        self.assertEqual(pricing.to_cents("1,250.75"), 125075)
        self.assertEqual(pricing.to_cents("0.295"), 30)  # half-up
        for bad in ("abc", "-5", "", None, "nan", "inf"):
            with self.assertRaises(AppError):
                pricing.to_cents(bad)


class BarcodeTests(unittest.TestCase):
    def test_checksums(self):
        self.assertTrue(has_valid_checksum(COKE))
        self.assertTrue(has_valid_checksum(NOODLES))
        self.assertTrue(has_valid_checksum("96385074"))  # EAN-8

    def test_wrong_read_is_rejected(self):
        with self.assertRaises(AppError) as ctx:
            normalize("4800016644802")  # isang digit mali
        self.assertEqual(ctx.exception.code, "barcode_checksum")

    def test_upca_becomes_ean13(self):
        self.assertEqual(normalize(UPC_A), "0" + UPC_A)

    def test_upce_expands_to_ean13(self):
        # UPC-E 04252614 = UPC-A 042100005264 (kilalang halimbawa)
        self.assertEqual(normalize("04252614"), "0042100005264")
        self.assertEqual(normalize("042100005264"), "0042100005264")  # pareho ang resulta

    def test_cleaning_and_non_numeric(self):
        self.assertEqual(normalize("  " + COKE + "\n"), COKE)
        self.assertEqual(normalize("ABC-123"), "ABC-123")  # Code128/39 labels
        with self.assertRaises(AppError):
            normalize("   ")

    def test_non_strict_allows_bad_checksum(self):
        self.assertEqual(normalize("4800016644802", strict=False), "4800016644802")


class AppTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app({
            "DATABASE": os.path.join(self.tmp.name, "test.db"),
            "TESTING": True,
        })
        self.client = self.app.test_client()

    def tearDown(self):
        self.tmp.cleanup()

    # --- helpers ---
    def post(self, url, body, status=200):
        r = self.client.post(url, json=body)
        self.assertEqual(r.status_code, status, r.get_json())
        return r.get_json()

    def stock_in(self, barcode=COKE, name="Coke 1.5L", cost="50", pct="20", qty=10, status=200):
        return self.post("/api/stock-in", {"barcode": barcode, "name": name, "cost": cost,
                                           "markup_pct": pct, "qty": qty}, status)

    def product(self, barcode=COKE):
        r = self.client.get(f"/api/products/by-barcode/{barcode}").get_json()
        return r["product"]


class StockInTests(AppTestCase):
    def test_new_item_goes_straight_to_stock(self):
        r = self.stock_in(cost="50", pct="20", qty=10)
        self.assertTrue(r["is_new"])
        p = r["product"]
        self.assertEqual(p["stock"], 10)
        self.assertEqual(p["cost_cents"], 5000)
        self.assertEqual(p["price_cents"], 6000)  # 50 + 20% = 60
        self.assertEqual(r["calc"]["total_cost_cents"], 50000)
        self.assertEqual(r["calc"]["total_sales_cents"], 60000)
        self.assertEqual(r["calc"]["total_profit_cents"], 10000)

    def test_restock_adds_and_updates_price(self):
        self.stock_in(cost="50", pct="20", qty=10)
        r = self.stock_in(cost="55", pct="20", qty=5, name="")
        self.assertFalse(r["is_new"])
        p = self.product()
        self.assertEqual(p["stock"], 15)
        self.assertEqual(p["price_cents"], 6600)  # 55 + 20% = 66
        self.assertEqual(p["name"], "Coke 1.5L")  # hindi nabura ang pangalan

    def test_new_item_needs_name(self):
        r = self.stock_in(name="", status=400)
        self.assertEqual(r["code"], "name_required")

    def test_bad_inputs(self):
        self.assertEqual(self.stock_in(qty=0, status=400)["code"], "bad_qty")
        self.assertEqual(self.stock_in(qty="abc", status=400)["code"], "bad_qty")
        self.assertEqual(self.stock_in(cost="-1", status=400)["code"], "bad_number")
        self.assertEqual(self.stock_in(barcode="4800016644802", status=400)["code"],
                         "barcode_checksum")
        # walang nasave na kahit ano
        self.assertEqual(len(self.client.get("/api/products").get_json()["products"]), 0)

    def test_preview_matches_saved_price(self):
        calc = self.post("/api/pricing/preview",
                         {"cost": "9.50", "markup_pct": "20", "qty": 3})["calc"]
        self.assertEqual(calc["price_cents"], 1200)
        self.assertEqual(calc["total_sales_cents"], 3600)
        r = self.stock_in(cost="9.50", pct="20", qty=3)
        self.assertEqual(r["product"]["price_cents"], calc["price_cents"])

    def test_upca_scan_matches_ean13(self):
        self.stock_in(barcode=UPC_A, name="Imported", qty=2)
        self.assertEqual(self.product("0" + UPC_A)["stock"], 2)
        self.assertEqual(self.product(UPC_A)["stock"], 2)


class SalesTests(AppTestCase):
    def setUp(self):
        super().setUp()
        self.stock_in(COKE, "Coke 1.5L", "50", "20", 10)       # presyo 60
        self.stock_in(NOODLES, "Lucky Me", "9.50", "20", 20)   # presyo 12

    def checkout(self, items, cash=None, status=200):
        return self.post("/api/sales/checkout", {"items": items, "cash": cash}, status)

    def test_total_and_stock_deduction(self):
        r = self.checkout([{"barcode": COKE, "qty": 2}, {"barcode": NOODLES, "qty": 5}],
                          cash="200")
        sale = r["sale"]
        self.assertEqual(sale["total_cents"], 2 * 6000 + 5 * 1200)   # 180.00
        self.assertEqual(sale["change_cents"], 2000)
        self.assertEqual(self.product(COKE)["stock"], 8)
        self.assertEqual(self.product(NOODLES)["stock"], 15)

    def test_same_item_scanned_many_times_is_merged(self):
        r = self.checkout([{"barcode": NOODLES, "qty": 1}] * 3 + [{"barcode": NOODLES, "qty": 2}])
        self.assertEqual(len(r["sale"]["items"]), 1)
        self.assertEqual(r["sale"]["items"][0]["qty"], 5)
        self.assertEqual(self.product(NOODLES)["stock"], 15)

    def test_cannot_sell_more_than_stock_and_nothing_changes(self):
        r = self.checkout([{"barcode": NOODLES, "qty": 3}, {"barcode": COKE, "qty": 11}],
                          status=400)
        self.assertEqual(r["code"], "insufficient_stock")
        self.assertEqual(self.product(COKE)["stock"], 10)
        self.assertEqual(self.product(NOODLES)["stock"], 20)  # hindi nabawasan
        self.assertEqual(self.client.get("/api/sales").get_json()["sales"], [])

    def test_split_lines_cannot_oversell(self):
        # 6 + 6 = 12 > 10 stock, kahit hiwalay ang linya
        r = self.checkout([{"barcode": COKE, "qty": 6}, {"barcode": COKE, "qty": 6}], status=400)
        self.assertEqual(r["code"], "insufficient_stock")

    def test_insufficient_cash(self):
        r = self.checkout([{"barcode": COKE, "qty": 1}], cash="59.99", status=400)
        self.assertEqual(r["code"], "insufficient_cash")
        self.assertEqual(self.product(COKE)["stock"], 10)

    def test_exact_cash_default(self):
        s = self.checkout([{"barcode": COKE, "qty": 1}])["sale"]
        self.assertEqual(s["cash_cents"], s["total_cents"])
        self.assertEqual(s["change_cents"], 0)

    def test_unknown_item_and_empty_cart(self):
        self.assertEqual(self.checkout([{"barcode": "4800016644825", "qty": 1}],
                                       status=400)["code"], "unknown_product")
        self.assertEqual(self.checkout([], status=400)["code"], "empty_cart")
        self.assertEqual(self.checkout([{"barcode": COKE, "qty": 0}], status=400)["code"],
                         "bad_qty")

    def test_old_receipt_keeps_old_price(self):
        sale = self.checkout([{"barcode": COKE, "qty": 1}])["sale"]
        self.stock_in(COKE, "", "80", "20", 1)   # tumaas ang presyo -> 96
        self.assertEqual(self.product(COKE)["price_cents"], 9600)
        again = self.client.get("/api/sales").get_json()["sales"][0]
        self.assertEqual(again["id"], sale["id"])
        self.assertEqual(again["items"][0]["price_cents"], 6000)

    def test_void_restores_stock(self):
        sale = self.checkout([{"barcode": COKE, "qty": 4}])["sale"]
        self.assertEqual(self.product(COKE)["stock"], 6)
        self.post(f"/api/sales/{sale['id']}/void", {})
        self.assertEqual(self.product(COKE)["stock"], 10)
        self.post(f"/api/sales/{sale['id']}/void", {}, status=400)  # hindi pwede dalawang beses
        self.assertEqual(self.product(COKE)["stock"], 10)

    def test_daily_report(self):
        self.checkout([{"barcode": COKE, "qty": 2}, {"barcode": NOODLES, "qty": 10}])
        voided = self.checkout([{"barcode": COKE, "qty": 1}])["sale"]
        self.post(f"/api/sales/{voided['id']}/void", {})
        rep = self.client.get("/api/reports/summary").get_json()
        s = rep["summary"]
        self.assertEqual(s["sales_count"], 1)
        self.assertEqual(s["sales_cents"], 2 * 6000 + 10 * 1200)
        self.assertEqual(s["cost_cents"], 2 * 5000 + 10 * 950)
        self.assertEqual(s["profit_cents"], s["sales_cents"] - s["cost_cents"])
        self.assertEqual(s["void_count"], 1)
        inv = rep["inventory"]
        self.assertEqual(inv["pieces"], 8 + 10)

    def test_client_cannot_set_price(self):
        sale = self.checkout([{"barcode": COKE, "qty": 1, "price_cents": 1}])["sale"]
        self.assertEqual(sale["total_cents"], 6000)

    def test_concurrent_checkouts_never_go_negative(self):
        """Dalawang cashier ang sabay bumili ng huling stock."""
        results = []

        def buy():
            client = self.app.test_client()
            r = client.post("/api/sales/checkout",
                            json={"items": [{"barcode": COKE, "qty": 6}]})
            results.append(r.status_code)

        threads = [threading.Thread(target=buy) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sorted(results), [200, 400])
        self.assertEqual(self.product(COKE)["stock"], 4)


class InventoryTests(AppTestCase):
    def setUp(self):
        super().setUp()
        self.stock_in(COKE, "Coke 1.5L", "50", "20", 10)

    def test_search_and_low_filter(self):
        self.stock_in(NOODLES, "Lucky Me Pancit Canton", "9.50", "20", 3)
        found = self.client.get("/api/products?q=pancit").get_json()["products"]
        self.assertEqual([p["barcode"] for p in found], [NOODLES])
        low = self.client.get("/api/products?low=1").get_json()["products"]
        self.assertEqual([p["barcode"] for p in low], [NOODLES])

    def test_adjust_stock_is_logged(self):
        pid = self.product()["id"]
        r = self.post(f"/api/products/{pid}/adjust", {"stock": 7, "note": "nasira 3"})
        self.assertEqual(r["product"]["stock"], 7)
        self.post(f"/api/products/{pid}/adjust", {"stock": -1}, status=400)
        with self.app.app_context():
            from app.database import get_db
            rows = get_db().execute(
                "SELECT qty_change, kind FROM stock_movements WHERE kind='adjust'").fetchall()
            self.assertEqual([(r["qty_change"], r["kind"]) for r in rows], [(-3, "adjust")])

    def test_edit_product(self):
        pid = self.product()["id"]
        r = self.client.patch(f"/api/products/{pid}", json={"name": "Coke Zero", "markup_pct": 30})
        self.assertEqual(r.status_code, 200)
        p = r.get_json()["product"]
        self.assertEqual(p["name"], "Coke Zero")
        self.assertEqual(p["price_cents"], 6500)  # 50 + 30%
        r = self.client.patch(f"/api/products/{pid}", json={"price": "70"})
        self.assertEqual(r.get_json()["product"]["price_cents"], 7000)  # manual

    def test_delete_only_without_sales(self):
        pid = self.product()["id"]
        self.post("/api/sales/checkout", {"items": [{"barcode": COKE, "qty": 1}]})
        r = self.client.delete(f"/api/products/{pid}")
        self.assertEqual(r.status_code, 400)
        self.stock_in(NOODLES, "Lucky Me", "9.50", "20", 1)
        pid2 = self.product(NOODLES)["id"]
        self.assertEqual(self.client.delete(f"/api/products/{pid2}").status_code, 200)


class DrawerTests(AppTestCase):
    def test_suggest_change_breakdown(self):
        from app.services.drawer import suggest_change_breakdown
        # ₱385.00 change (38500 cents) -> 1x ₱200, 1x ₱100, 1x ₱50, 1x ₱20, 1x ₱10, 1x ₱5
        bd = suggest_change_breakdown(38500)
        items = {item["label"]: item["count"] for item in bd}
        self.assertEqual(items.get("₱200 Bill"), 1)
        self.assertEqual(items.get("₱100 Bill"), 1)
        self.assertEqual(items.get("₱50 Bill"), 1)
        self.assertEqual(items.get("₱20 Bill"), 1)
        self.assertEqual(items.get("₱10 Coin"), 1)
        self.assertEqual(items.get("₱5 Coin"), 1)

    def test_add_change_fund_movement(self):
        # Replenish change in coins
        r = self.post("/api/drawer/movements", {
            "kind": "add_change",
            "category": "coins",
            "amount": "200.00",
            "note": "Coins for customer change shortage"
        })
        self.assertTrue(r["ok"])
        self.assertEqual(r["movement"]["amount_cents"], 20000)
        self.assertEqual(r["movement"]["category"], "coins")
        self.assertEqual(r["summary"]["added_change_cents"], 20000)
        self.assertEqual(r["summary"]["added_change_breakdown"]["coins_cents"], 20000)

        # Replenish change in paper bills
        r2 = self.post("/api/drawer/movements", {
            "kind": "add_change",
            "category": "bills",
            "amount": 500,
            "note": "₱500 bills inserted"
        })
        self.assertEqual(r2["summary"]["added_change_cents"], 70000)
        self.assertEqual(r2["summary"]["added_change_breakdown"]["bills_cents"], 50000)

    def test_drawer_physical_cash_count(self):
        # Count bills and coins
        r = self.post("/api/drawer/counts", {
            "counts": {
                "bills": {
                    "1000": 2,  # 2000
                    "500": 1,   # 500
                    "100": 3,   # 300
                    "50": 2,    # 100
                },
                "coins": {
                    "20": 5,    # 100
                    "10": 10,   # 100
                    "5": 10,    # 50
                    "1": 25,    # 25
                }
            },
            "note": "Midday register count"
        })
        self.assertTrue(r["ok"])
        # Bills: 2000 + 500 + 300 + 100 = ₱2900 (290000 cents)
        self.assertEqual(r["count"]["bills_cents"], 290000)
        # Coins: 100 + 100 + 50 + 25 = ₱275 (27500 cents)
        self.assertEqual(r["count"]["coins_cents"], 27500)
        # Total: ₱3175 (317500 cents)
        self.assertEqual(r["count"]["total_cents"], 317500)

    def test_expected_drawer_cash_after_sales(self):
        # Stock in Coke first
        self.stock_in(COKE, "Coca-Cola 500ml", "50", "20", 10)

        # 1. Start with change replenishment
        self.post("/api/drawer/movements", {
            "kind": "add_change",
            "category": "mixed",
            "amount": "1000.00",
            "note": "Starting change fund"
        })
        # 2. Make a sale of 1 Coke @ ₱60, tendered ₱100, change ₱40
        self.post("/api/sales/checkout", {
            "items": [{"barcode": COKE, "qty": 1}],
            "cash": "100.00"
        })
        # 3. Check drawer summary: expected = 1000 (added change) + 60 (net sales) = 1060
        res = self.client.get("/api/drawer").get_json()
        self.assertEqual(res["summary"]["expected_cash_cents"], 106000)
        self.assertEqual(res["summary"]["added_change_cents"], 100000)
        self.assertEqual(res["summary"]["sales_cash_cents"], 6000)


class CalendarTests(AppTestCase):
    def test_monthly_and_daily_calendar_earnings(self):
        # Stock in items
        self.stock_in(COKE, "Coca-Cola 500ml", "50", "20", 10)  # price 60 (profit 10 each)
        self.stock_in(NOODLES, "Lucky Me Pancit Canton", "10", "20", 10)  # price 12 (profit 2 each)

        # Checkout 2 Cokes + 1 Noodles: total = 120 + 12 = 132 (cost: 100 + 10 = 110, profit = 22)
        self.post("/api/sales/checkout", {
            "items": [{"barcode": COKE, "qty": 2}, {"barcode": NOODLES, "qty": 1}],
            "cash": "150.00"
        })

        import datetime
        today_iso = datetime.date.today().isoformat()
        current_ym = today_iso[:7]

        # 1. Fetch monthly calendar data
        res = self.client.get(f"/api/calendar/month?month={current_ym}").get_json()
        self.assertTrue(res["ok"])
        self.assertEqual(res["summary"]["sales_cents"], 13200)
        self.assertEqual(res["summary"]["profit_cents"], 2200)
        self.assertEqual(res["summary"]["pieces"], 3)
        self.assertEqual(res["summary"]["sales_count"], 1)
        self.assertIn(today_iso, res["summary"]["days"])
        self.assertEqual(res["summary"]["days"][today_iso]["sales_cents"], 13200)

        # 2. Fetch daily calendar data
        day_res = self.client.get(f"/api/calendar/day?date={today_iso}").get_json()
        self.assertTrue(day_res["ok"])
        self.assertEqual(day_res["summary"]["sales_cents"], 13200)
        self.assertEqual(day_res["summary"]["profit_cents"], 2200)

    def test_future_dates_are_strictly_blocked(self):
        # Future month
        r_month = self.client.get("/api/calendar/month?month=2099-12")
        self.assertEqual(r_month.status_code, 400)
        self.assertEqual(r_month.get_json()["code"], "future_date_blocked")

        # Future day
        r_day = self.client.get("/api/calendar/day?date=2099-12-31")
        self.assertEqual(r_day.status_code, 400)
        self.assertEqual(r_day.get_json()["code"], "future_date_blocked")


class PageTests(AppTestCase):
    def test_pages_load(self):
        for url in ("/", "/drawer", "/calendar", "/stock-in", "/inventory", "/reports"):
            r = self.client.get(url)
            self.assertEqual(r.status_code, 200, url)
        self.assertEqual(self.client.get("/static/vendor/html5-qrcode.min.js").status_code, 200)
        self.assertEqual(self.client.get("/static/js/scanner.js").status_code, 200)
        self.assertEqual(self.client.get("/static/js/drawer.js").status_code, 200)
        self.assertEqual(self.client.get("/static/js/calendar.js").status_code, 200)


if __name__ == "__main__":
    unittest.main()
