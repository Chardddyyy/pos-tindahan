"""Store settings. Modify defaults here."""
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Config:
    STORE_NAME = "My Store"

    # Where the database is saved (single file, easy to backup)
    DATABASE = os.path.join(BASE_DIR, "data", "tindahan.db")

    # Default profit markup percentage for new items
    DEFAULT_MARKUP_PCT = 20

    # Price rounding UP, in centavos.
    #   100 = whole peso (₱11.40 -> ₱12)
    #    50 = half peso (₱11.40 -> ₱11.50)
    #    25 = ₱0.25
    #     1 = no rounding (to the centavo)
    PRICE_ROUND_STEP_CENTS = 100

    # Low stock threshold
    LOW_STOCK_DEFAULT = 5

    # Reject EAN-13 / EAN-8 / UPC-A with invalid check digits
    # Set to False if using custom non-standard barcode labels.
    STRICT_BARCODE_CHECKSUM = True

    # Maximum quantity per line item (typo protection)
    MAX_QTY_PER_LINE = 10000

