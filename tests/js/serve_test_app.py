"""Nagpapatakbo ng POS na may pansamantalang database, para sa UI test.

    python serve_test_app.py <port>
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app import create_app  # noqa: E402

port = int(sys.argv[1])
tmp = tempfile.mkdtemp()
app = create_app({"DATABASE": os.path.join(tmp, "ui-test.db")})
app.run(host="127.0.0.1", port=port, threaded=True, use_reloader=False)
