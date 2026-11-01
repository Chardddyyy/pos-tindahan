-- Lahat ng pera ay nakasave bilang CENTAVOS (integer) para walang
-- pagkakamali sa decimal. Halimbawa: ₱12.50 = 1250.

CREATE TABLE IF NOT EXISTS products (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode          TEXT    NOT NULL UNIQUE,
    name             TEXT    NOT NULL,
    cost_cents       INTEGER NOT NULL CHECK (cost_cents >= 0),   -- huling bili (bawat piraso)
    markup_pct       REAL    NOT NULL CHECK (markup_pct >= 0),   -- % na kita
    price_cents      INTEGER NOT NULL CHECK (price_cents >= 0),  -- presyong benta (bawat piraso)
    stock            INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    low_stock_level  INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_level >= 0),
    created_at       TEXT    NOT NULL,
    updated_at       TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

-- Tala ng lahat ng pagbabago sa stock (stock in, benta, adjust, void)
CREATE TABLE IF NOT EXISTS stock_movements (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id   INTEGER NOT NULL REFERENCES products(id),
    kind         TEXT    NOT NULL CHECK (kind IN ('stock_in','sale','adjust','void')),
    qty_change   INTEGER NOT NULL,                -- + pumasok, - lumabas
    cost_cents   INTEGER,                         -- bili bawat piraso (para sa stock_in)
    sale_id      INTEGER REFERENCES sales(id),
    note         TEXT,
    created_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id);

CREATE TABLE IF NOT EXISTS sales (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    total_cents   INTEGER NOT NULL CHECK (total_cents >= 0),
    cash_cents    INTEGER NOT NULL CHECK (cash_cents >= 0),
    change_cents  INTEGER NOT NULL CHECK (change_cents >= 0),
    status        TEXT    NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','void')),
    created_at    TEXT    NOT NULL,
    voided_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);

-- Kinokopya ang pangalan/presyo/puhunan sa oras ng benta, para hindi
-- magbago ang lumang resibo kapag nagbago ang presyo ng item.
CREATE TABLE IF NOT EXISTS sale_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id      INTEGER NOT NULL REFERENCES sales(id),
    product_id   INTEGER NOT NULL REFERENCES products(id),
    barcode      TEXT    NOT NULL,
    name         TEXT    NOT NULL,
    qty          INTEGER NOT NULL CHECK (qty > 0),
    price_cents  INTEGER NOT NULL,
    cost_cents   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);

-- Cash Drawer movements: change fund replenishment, initial float, cash out
CREATE TABLE IF NOT EXISTS cash_movements (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    kind              TEXT    NOT NULL CHECK (kind IN ('add_change', 'initial_float', 'cash_out')),
    category          TEXT    NOT NULL CHECK (category IN ('coins', 'bills', 'mixed')),
    amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
    note              TEXT,
    denominations_json TEXT,
    created_at        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_date ON cash_movements(created_at);

-- Cash Drawer physical counts: audit of bills and coins in register
CREATE TABLE IF NOT EXISTS drawer_counts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    total_cents       INTEGER NOT NULL CHECK (total_cents >= 0),
    bills_cents       INTEGER NOT NULL DEFAULT 0 CHECK (bills_cents >= 0),
    coins_cents       INTEGER NOT NULL DEFAULT 0 CHECK (coins_cents >= 0),
    denominations_json TEXT    NOT NULL,
    note              TEXT,
    created_at        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_drawer_counts_date ON drawer_counts(created_at);
