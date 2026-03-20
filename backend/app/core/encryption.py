"""
Fernet symmetric encryption for BYOK API keys.

Uses PBKDF2 key derivation from the app SECRET_KEY so that
encrypted values are tied to the deployment.
"""

import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

_SALT = b"learntrack-byok-v1"
_ITERATIONS = 100_000
_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is not None:
        return _fernet

    from app.core.config import settings

    secret = settings.SECRET_KEY
    if not secret:
        raise RuntimeError("SECRET_KEY must be set for API key encryption")

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_SALT,
        iterations=_ITERATIONS,
    )
    key = base64.urlsafe_b64encode(kdf.derive(secret.encode()))
    _fernet = Fernet(key)
    return _fernet


def encrypt_api_key(plaintext: str) -> str:
    """Encrypt an API key for MongoDB storage."""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_api_key(ciphertext: str) -> str:
    """Decrypt an API key for use in provider calls."""
    return _get_fernet().decrypt(ciphertext.encode()).decode()


def mask_api_key(key: str) -> str:
    """Return a display-safe masked version of an API key (e.g. ``sk-abc...xyz``)."""
    if len(key) <= 8:
        return key[:2] + "..." + key[-2:]
    return key[:6] + "..." + key[-4:]
