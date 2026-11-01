"""SQLite connection at transaction helpers."""
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime

from flask import current_app, g

SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")


def now_str():
    """Oras ngayon (local time ng computer) bilang text."""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def connect(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # isolation_level=None -> kami ang nag-uutos ng BEGIN/COMMIT (tingnan ang transaction())
    conn = sqlite3.connect(path, isolation_level=None, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def get_db():
    if "db" not in g:
        g.db = connect(current_app.config["DATABASE"])
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db(path):
    conn = connect(path)
    with open(SCHEMA_PATH, encoding="utf-8") as f:
        conn.executescript(f.read())
    conn.close()


@contextmanager
def transaction(db):
    """Lahat o wala. Kapag may error, ibabalik sa dati ang lahat ng pagbabago.

    BEGIN IMMEDIATE ang gamit para hindi magsabay ang dalawang cashier
    sa pagbawas ng iisang stock.
    """
    db.execute("BEGIN IMMEDIATE")
    try:
        yield db
    except BaseException:
        db.execute("ROLLBACK")
        raise
    else:
        db.execute("COMMIT")
