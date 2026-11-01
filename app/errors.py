"""Application errors displayed cleanly to the user."""


class AppError(Exception):
    """Error with a user-friendly message for the cashier/owner."""

    def __init__(self, message, status=400, code="error", details=None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.details = details

    def to_dict(self):
        body = {"ok": False, "error": self.message, "code": self.code}
        if self.details is not None:
            body["details"] = self.details
        return body

