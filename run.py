"""Start the POS system.

    python run.py              -> http://localhost:5000  (local computer)
    python run.py --https      -> https://<computer-IP>:5000  (for phone/tablet camera on same WiFi)

WHY HTTPS IS NEEDED: Mobile browsers only allow camera access on HTTPS addresses
(or localhost). A self-signed certificate is automatically generated for your local IP.
"""
import argparse
import datetime
import ipaddress
import os
import socket

from app import create_app
from app.config import BASE_DIR


def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def ensure_cert(ip):
    """Generate self-signed certificate (saved in data/certs, reused across runs)."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    cert_dir = os.path.join(BASE_DIR, "data", "certs")
    os.makedirs(cert_dir, exist_ok=True)
    cert_path = os.path.join(cert_dir, "cert.pem")
    key_path = os.path.join(cert_dir, "key.pem")
    ip_file = os.path.join(cert_dir, "ip.txt")

    if (os.path.exists(cert_path) and os.path.exists(key_path)
            and os.path.exists(ip_file) and open(ip_file).read().strip() == ip):
        return cert_path, key_path

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Store POS")])
    now = datetime.datetime.now(datetime.timezone.utc)
    san = x509.SubjectAlternativeName([
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
        x509.IPAddress(ipaddress.ip_address(ip)),
    ])
    cert = (
        x509.CertificateBuilder()
        .subject_name(name).issuer_name(name).public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=825))
        .add_extension(san, critical=False)
        .sign(key, hashes.SHA256())
    )
    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    with open(key_path, "wb") as f:
        f.write(key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption()))
    with open(ip_file, "w") as f:
        f.write(ip)
    return cert_path, key_path


def main():
    parser = argparse.ArgumentParser(description="Store POS")
    parser.add_argument("--https", action="store_true",
                        help="enable HTTPS (required for mobile device camera)")
    parser.add_argument("--port", type=int, default=None,
                        help="port number (defaults to 5000, or 5001 if 5000 is occupied)")
    args = parser.parse_args()

    port = args.port
    if port is None:
        port = 5000
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("0.0.0.0", 5000))
            except OSError:
                port = 5001
                print("Note: Port 5000 is in use by macOS (AirPlay Receiver). Switching to port 5001.")

    app = create_app()
    ip = local_ip()

    if args.https:
        cert, key = ensure_cert(ip)
        print(f"\n  This computer : https://localhost:{port}")
        print(f"  Phone/tablet  : https://{ip}:{port}   (on same WiFi)\n")
        app.run(host="0.0.0.0", port=port, ssl_context=(cert, key), threaded=True)
    else:
        print(f"\n  Open in browser : http://localhost:{port}")
        print("  (For mobile camera access: python run.py --https)\n")
        app.run(host="0.0.0.0", port=port, threaded=True)


if __name__ == "__main__":
    main()

