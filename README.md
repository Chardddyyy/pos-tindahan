# Store POS

Barcode POS and inventory system for retail stores. Works with **phone/tablet/laptop cameras**
or **USB barcode scanners**, and requires **no internet connection** during daily operations.

- **Stock In:** scan barcode → enter purchase cost and markup % → view selling price, total cost, sales, and profit → directly save to inventory.
- **Sales:** scan item (price appears). Scan again to increment quantity, or type in quantity. → **Checkout** → total, change → inventory automatically updates.
- **Inventory:** view stock levels, low-stock alerts, and out-of-stock items.
- **Reports:** view daily sales, cost of goods, profit, top items, and void incorrect transactions.

---

## Getting Started

Requires **Python 3.9+** ([python.org](https://www.python.org/downloads/); on Windows, check *"Add python.exe to PATH"*).

| Platform / Use Case | Windows | Mac / Linux |
|---|---|---|
| Local computer | double-click `simula.bat` | `./simula.sh` |
| For **mobile/tablet camera** | double-click `simula-cellphone.bat` | `./simula.sh --https` |

First run will automatically install dependencies (one-time setup). Then open the
address displayed on screen, e.g. `http://localhost:5001`.

### Mobile Phone / Tablet Camera

1. Connect the mobile phone and computer to the **same WiFi / local router**.
2. Run `simula-cellphone.bat` (or `./simula.sh --https`). An address will be shown, e.g. `https://192.168.1.10:5001`.
3. Open that address in **Chrome** on the mobile device. When the browser warning appears ("Not secure"): click **Advanced → Proceed**. This is safe and only appears because it is a self-signed local certificate.
4. Click **Start Camera** and choose **Allow**.

---

## Features & Usage

### 1. Stock In (Adding Inventory)
1. **Stock In** → scan barcode (camera, USB scanner, or manual typing).
2. **New item:** enter name. **Existing item:** name and last price will load automatically.
3. Enter **purchase cost (per unit)**, **markup %**, and **quantity**.
4. Real-time preview: selling price per unit, **total cost**, **total sales when sold out**, and **total profit**.
5. **Add to Stock** (or Enter). Saved to inventory and ready for the next scan.

### 2. Sales / Checkout
1. **Sales** → scan item. Name and price load into the cart.
2. **Same item again?** Scan again (+1 per scan), click **+ / −**, or **type** the quantity directly.
3. You can also search items by name if barcodes are missing or damaged.
4. **Checkout** (or `F2`) → enter cash tendered (quick cash buttons available) → view **change** → **Complete Sale**.
5. Stock is automatically decremented. Sales cannot exceed available stock.
6. The cart persists even if the page is refreshed.

### 3. Inventory
Search items, inspect stock levels (yellow = low stock, red = out of stock). **Edit** to update name/price/markup. **Count** to adjust physical stock count (for damaged, lost, or recount discrepancies). All adjustments are logged.

### 4. Reports
Select date to view daily sales, cost of goods sold, profit, and receipts. **Void** cancels transactions and **returns items to stock**.

---

## Price Calculation

```
selling price = cost + (cost × markup%)   → rounded UP
```

Example: cost ₱9.50, markup 20% → ₱11.40 → **₱12.00** (rounded to whole peso).
In `app/config.py`, customize `PRICE_ROUND_STEP_CENTS`: `100` = whole peso, `50` = ₱0.50, `1` = no rounding.

---

## Tests

```bash
python -m unittest discover -s tests -v      # pricing, inventory, sales tests
```

## Backup & Data Safety

- All data is stored in **`data/tindahan.db`** (SQLite). Copy this file regularly to back up your data.
