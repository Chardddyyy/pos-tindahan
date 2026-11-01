"""Barcode cleaning and validation.

Cameras can occasionally misread digits. EAN and UPC barcodes include a check digit
to catch transmission/reading errors before they enter inventory or cart.
"""
import re

from .errors import AppError

_CLEAN_RE = re.compile(r"[^\x21-\x7E]")  # strip spaces and special characters


def _check_digit(digits):
    """Check digit calculation for EAN-13 / EAN-8 (UPC-A is EAN-13 prefixed with 0)."""
    body = digits[:-1]
    total = 0
    for i, ch in enumerate(reversed(body)):
        total += int(ch) * (3 if i % 2 == 0 else 1)
    return (10 - total % 10) % 10


def has_valid_checksum(digits):
    return int(digits[-1]) == _check_digit(digits)


def upce_to_upca(upce):
    """UPC-E (8 digits, small packages) -> UPC-A (12 digits)."""
    ns, d, check = upce[0], upce[1:7], upce[7]
    last = d[5]
    if last in "012":
        body = ns + d[0:2] + last + "0000" + d[2:5]
    elif last == "3":
        body = ns + d[0:3] + "00000" + d[3:5]
    elif last == "4":
        body = ns + d[0:4] + "00000" + d[4]
    else:
        body = ns + d[0:5] + "0000" + last
    return body + check


def normalize(raw, strict=True):
    """Return normalized barcode string, or raise AppError on invalid input."""
    if raw is None:
        raise AppError("Barcode is required.", code="barcode_empty")

    code = _CLEAN_RE.sub("", str(raw))
    if not code:
        raise AppError("Barcode is required.", code="barcode_empty")
    if len(code) > 64:
        raise AppError("Barcode is too long.", code="barcode_invalid")

    if code.isdigit():
        bad_read = AppError(
            f"Invalid barcode read ({code}). Please scan again.",
            code="barcode_checksum",
        )
        if len(code) == 12:                       # UPC-A -> EAN-13
            code = "0" + code
            if strict and not has_valid_checksum(code):
                raise bad_read
        elif len(code) == 13:
            if strict and not has_valid_checksum(code):
                raise bad_read
        elif len(code) == 8:
            if has_valid_checksum(code):           # EAN-8
                pass
            elif code[0] in "01" and has_valid_checksum("0" + upce_to_upca(code)):
                code = "0" + upce_to_upca(code)    # UPC-E -> EAN-13
            elif strict:
                raise bad_read
    return code

