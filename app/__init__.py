"""Tindahan POS - Barcode POS and inventory system for retail stores."""
import sqlite3

from flask import Flask, jsonify, request

from .config import Config
from .database import close_db, init_db
from .errors import AppError


def create_app(overrides=None):
    app = Flask(__name__)
    app.config.from_object(Config)
    if overrides:
        app.config.update(overrides)

    init_db(app.config["DATABASE"])
    app.teardown_appcontext(close_db)

    from .routes import api, pages
    app.register_blueprint(pages.bp)
    app.register_blueprint(api.bp)

    @app.errorhandler(AppError)
    def handle_app_error(err):
        return jsonify(err.to_dict()), err.status

    @app.errorhandler(sqlite3.OperationalError)
    def handle_db_busy(err):
        app.logger.exception("Database error")
        return jsonify({"ok": False, "code": "db_busy",
                        "error": "Database is busy. Please try again."}), 503

    @app.errorhandler(404)
    def handle_404(err):
        if request.path.startswith("/api/"):
            return jsonify({"ok": False, "code": "not_found", "error": "Not found."}), 404
        return err

    @app.errorhandler(Exception)
    def handle_unexpected(err):
        if hasattr(err, "code") and isinstance(err.code, int):  # HTTPException
            return err
        app.logger.exception("Unexpected error")
        return jsonify({"ok": False, "code": "server_error",
                        "error": "An unexpected error occurred. Please try again."}), 500

    @app.after_request
    def no_cache_api(resp):
        if request.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    return app

