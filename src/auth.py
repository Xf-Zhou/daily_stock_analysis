# -*- coding: utf-8 -*-
"""
Web admin authentication module.

Single toggle (ADMIN_AUTH_ENABLED) + file-based credentials.
First login sets initial password; supports web change-password and CLI reset.
"""

from __future__ import annotations

import base64
from contextlib import contextmanager
import getpass
import hashlib
import hmac
import json
import logging
import os
import secrets
import sys
import time
from pathlib import Path
from typing import Any, Optional, Tuple

from dotenv import dotenv_values
import pyotp

logger = logging.getLogger(__name__)

COOKIE_NAME = "dsa_session"
MFA_CHALLENGE_COOKIE_NAME = "dsa_mfa_challenge"
PBKDF2_ITERATIONS = 100_000
RATE_LIMIT_WINDOW_SEC = 300
RATE_LIMIT_MAX_FAILURES = 5
SESSION_MAX_AGE_HOURS_DEFAULT = 24
MIN_PASSWORD_LEN = 6
MFA_CHALLENGE_TTL_SECONDS = 300
MFA_PENDING_TTL_SECONDS = 600
MFA_CHALLENGE_PURPOSE = "mfa_login"
MFA_ISSUER = "Daily Stock Analysis"
MFA_ACCOUNT = "admin"

# Lazy-loaded state
_auth_enabled: Optional[bool] = None
_session_secret: Optional[bytes] = None
_password_hash_salt: Optional[bytes] = None
_password_hash_stored: Optional[bytes] = None
_rate_limit: dict[str, Tuple[int, float]] = {}
_rate_limit_lock = None
_mfa_thread_lock = None


def _get_lock():
    """Lazy init threading lock for rate limit dict."""
    global _rate_limit_lock
    if _rate_limit_lock is None:
        import threading
        _rate_limit_lock = threading.Lock()
    return _rate_limit_lock


def _get_mfa_thread_lock():
    """Fallback process-local lock for platforms without fcntl."""
    global _mfa_thread_lock
    if _mfa_thread_lock is None:
        import threading
        _mfa_thread_lock = threading.Lock()
    return _mfa_thread_lock


def _ensure_env_loaded() -> None:
    """Ensure .env is loaded before reading config."""
    from src.config import setup_env
    setup_env()


def _get_data_dir() -> Path:
    """Return DATA_DIR as parent of DATABASE_PATH."""
    db_path = os.getenv("DATABASE_PATH", "./data/stock_analysis.db")
    return Path(db_path).resolve().parent


def _get_credential_path() -> Path:
    """Path to stored password hash file."""
    return _get_data_dir() / ".admin_password_hash"


def _get_mfa_path() -> Path:
    """Path to stored MFA configuration."""
    return _get_data_dir() / ".admin_mfa.json"


def _get_mfa_pending_path() -> Path:
    """Path to short-lived pending MFA setup state."""
    return _get_data_dir() / ".admin_mfa_pending.json"


@contextmanager
def _mfa_file_lock():
    """Cross-process lock for MFA read/modify/write operations."""
    data_dir = _get_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    lock_path = data_dir / ".admin_mfa.lock"
    try:
        import fcntl  # type: ignore

        with open(lock_path, "a+", encoding="utf-8") as lock_file:
            try:
                lock_path.chmod(0o600)
            except OSError:
                pass
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
    except ImportError:
        lock = _get_mfa_thread_lock()
        with lock:
            yield


def _read_json_file(path: Path) -> Optional[dict[str, Any]]:
    """Read a JSON object from disk, returning None for missing/invalid files."""
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Failed to read JSON auth state from %s: %s", path, exc)
        return None


def _write_json_file(path: Path, data: dict[str, Any]) -> None:
    """Atomically write a JSON object with owner-only permissions."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(data, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    tmp_path.chmod(0o600)
    tmp_path.replace(path)


def _delete_file_if_exists(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        return
    except OSError as exc:
        logger.warning("Failed to remove %s: %s", path, exc)


def _restore_json_file(path: Path, data: Optional[dict[str, Any]]) -> None:
    """Restore a JSON state file snapshot or remove it when the snapshot was absent."""
    if data is None:
        _delete_file_if_exists(path)
        return
    _write_json_file(path, data)


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def _mfa_hmac_key(label: bytes) -> Optional[bytes]:
    secret = _get_session_secret()
    if not secret:
        return None
    return hmac.new(secret, label, hashlib.sha256).digest()


def _is_auth_enabled_from_env() -> bool:
    """Read ADMIN_AUTH_ENABLED from .env file."""
    _ensure_env_loaded()
    env_file = os.getenv("ENV_FILE")
    env_path = Path(env_file) if env_file else Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return False
    values = dotenv_values(env_path)
    val = (values.get("ADMIN_AUTH_ENABLED") or "").strip().lower()
    return val in ("true", "1", "yes")


def rotate_session_secret() -> bool:
    """Rotate the session signing secret to invalidate all active sessions."""
    global _session_secret
    data_dir = _get_data_dir()
    secret_path = data_dir / ".session_secret"
    data_dir.mkdir(parents=True, exist_ok=True)
    new_secret = secrets.token_bytes(32)
    try:
        tmp_path = secret_path.with_suffix(".tmp")
        tmp_path.write_bytes(new_secret)
        tmp_path.chmod(0o600)
        tmp_path.replace(secret_path)
        _session_secret = new_secret
        logger.info("Session secret rotated successfully")
        return True
    except OSError as e:
        logger.error("Failed to rotate .session_secret: %s", e)
        return False


def _load_session_secret() -> Optional[bytes]:
    """Load or create session secret."""
    global _session_secret
    if _session_secret is not None:
        return _session_secret

    data_dir = _get_data_dir()
    secret_path = data_dir / ".session_secret"

    try:
        if secret_path.exists():
            _session_secret = secret_path.read_bytes()
            if len(_session_secret) != 32:
                logger.warning("Invalid .session_secret length, regenerating")
                _session_secret = None
                if rotate_session_secret():
                    return _session_secret
                return None
            return _session_secret

        data_dir.mkdir(parents=True, exist_ok=True)
        new_secret = secrets.token_bytes(32)
        try:
            with open(secret_path, "xb") as f:
                f.write(new_secret)
            secret_path.chmod(0o600)
        except FileExistsError:
            _session_secret = secret_path.read_bytes()
        else:
            _session_secret = new_secret
        return _session_secret
    except OSError as e:
        logger.error("Failed to create or read .session_secret: %s", e)
        return None


def _parse_password_hash(value: str) -> Optional[Tuple[bytes, bytes]]:
    """Parse salt_b64:hash_b64. Returns (salt, hash) or None."""
    if not value or ":" not in value:
        return None
    parts = value.strip().split(":", 1)
    if len(parts) != 2:
        return None
    try:
        salt_b64, hash_b64 = parts[0].strip(), parts[1].strip()
        salt = base64.standard_b64decode(salt_b64)
        stored_hash = base64.standard_b64decode(hash_b64)
        if salt and stored_hash:
            return (salt, stored_hash)
    except (ValueError, TypeError):
        pass
    return None


def _verify_password_hash(submitted: str, salt: bytes, stored_hash: bytes) -> bool:
    """Verify submitted password against stored pbkdf2 hash."""
    computed = hashlib.pbkdf2_hmac(
        "sha256",
        submitted.encode("utf-8"),
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    return hmac.compare_digest(computed, stored_hash)


def _load_credential_from_file() -> bool:
    """Load credential from file into module globals. Returns True if loaded."""
    global _password_hash_salt, _password_hash_stored

    path = _get_credential_path()
    if not path.exists():
        _password_hash_salt = None
        _password_hash_stored = None
        return False

    try:
        raw = path.read_text().strip()
        parsed = _parse_password_hash(raw)
        if parsed is None:
            logger.warning("Invalid .admin_password_hash format, ignoring")
            return False
        _password_hash_salt, _password_hash_stored = parsed
        return True
    except OSError as e:
        logger.error("Failed to read credential file: %s", e)
        return False


def refresh_auth_state() -> None:
    """Reload auth-related state from disk and env."""
    global _auth_enabled, _session_secret
    _auth_enabled = None
    _session_secret = None
    _load_credential_from_file()


def is_auth_enabled() -> bool:
    """Return whether admin authentication is enabled (ADMIN_AUTH_ENABLED=true)."""
    global _auth_enabled
    if _auth_enabled is not None:
        return _auth_enabled
    _auth_enabled = _is_auth_enabled_from_env()
    return _auth_enabled


def has_stored_password() -> bool:
    """Return whether a valid stored password hash exists on disk."""
    return _load_credential_from_file()


def verify_stored_password(password: str) -> bool:
    """Verify password against stored credential even when auth is disabled."""
    if not has_stored_password():
        return False
    return _verify_password_hash(password, _password_hash_salt, _password_hash_stored)


def is_password_set() -> bool:
    """Return whether initial password has been set (credential file exists and valid)."""
    if not is_auth_enabled():
        return False
    return has_stored_password()


def is_password_changeable() -> bool:
    """Return whether password can be changed via web/CLI (always True when auth enabled)."""
    return is_auth_enabled()


def _get_session_secret() -> Optional[bytes]:
    """Return session signing secret."""
    if not is_auth_enabled():
        return None
    return _load_session_secret()


def _validate_password(pwd: str) -> Optional[str]:
    """Return error message if invalid, None if valid."""
    if not pwd or not pwd.strip():
        return "密码不能为空"
    if len(pwd) < MIN_PASSWORD_LEN:
        return f"密码至少 {MIN_PASSWORD_LEN} 位"
    return None


def set_initial_password(password: str) -> Optional[str]:
    """
    Set initial password (first-time setup). Returns error message or None on success.
    Atomic write with 0o600 permissions.
    """
    err = _validate_password(password)
    if err:
        return err

    data_dir = _get_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    cred_path = _get_credential_path()

    salt = secrets.token_bytes(32)
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    salt_b64 = base64.standard_b64encode(salt).decode("ascii")
    hash_b64 = base64.standard_b64encode(derived).decode("ascii")
    content = f"{salt_b64}:{hash_b64}"

    try:
        tmp_path = cred_path.with_suffix(".tmp")
        tmp_path.write_text(content)
        tmp_path.chmod(0o600)
        tmp_path.replace(cred_path)
        _load_credential_from_file()
        return None
    except OSError as e:
        logger.error("Failed to write credential file: %s", e)
        return "密码保存失败"


def verify_password(password: str) -> bool:
    """Verify password against stored credential. Constant-time where applicable."""
    if not is_auth_enabled():
        return True
    return verify_stored_password(password)


def change_password(current: str, new: str) -> Optional[str]:
    """
    Change password. Verifies current, writes new hash. Returns error message or None on success.
    """
    if not is_auth_enabled():
        return "认证功能未启用"
    if not is_password_set():
        return "尚未设置密码"

    if not current or not current.strip():
        return "请输入当前密码"
    if not _verify_password_hash(current, _password_hash_salt, _password_hash_stored):
        return "当前密码错误"

    err = _validate_password(new)
    if err:
        return err

    cred_path = _get_credential_path()
    salt = secrets.token_bytes(32)
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        new.encode("utf-8"),
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    salt_b64 = base64.standard_b64encode(salt).decode("ascii")
    hash_b64 = base64.standard_b64encode(derived).decode("ascii")
    content = f"{salt_b64}:{hash_b64}"

    try:
        tmp_path = cred_path.with_suffix(".tmp")
        tmp_path.write_text(content)
        tmp_path.chmod(0o600)
        tmp_path.replace(cred_path)
        # Reload into memory so subsequent verify_password uses new hash
        _load_credential_from_file()
        return None
    except OSError as e:
        logger.error("Failed to write credential file: %s", e)
        return "密码保存失败"


def create_session() -> str:
    """Create a signed session payload. Format: nonce.ts.signature."""
    secret = _get_session_secret()
    if not secret:
        return ""
    nonce = secrets.token_urlsafe(32)
    ts = str(int(time.time()))
    payload = f"{nonce}.{ts}"
    sig = hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def verify_session(value: str) -> bool:
    """Verify session cookie and check expiry."""
    secret = _get_session_secret()
    if not secret or not value:
        return False
    parts = value.split(".")
    if len(parts) != 3:
        return False
    nonce, ts_str, sig = parts[0], parts[1], parts[2]
    payload = f"{nonce}.{ts_str}"
    expected = hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return False
    try:
        ts = int(ts_str)
    except ValueError:
        return False
    try:
        max_age_hours = int(os.getenv("ADMIN_SESSION_MAX_AGE_HOURS", str(SESSION_MAX_AGE_HOURS_DEFAULT)))
    except ValueError:
        max_age_hours = SESSION_MAX_AGE_HOURS_DEFAULT
    if time.time() - ts > max_age_hours * 3600:
        return False
    return True


def create_mfa_challenge(purpose: str = MFA_CHALLENGE_PURPOSE) -> str:
    """Create a signed short-lived MFA challenge token."""
    key = _mfa_hmac_key(b"dsa-mfa-challenge-v1")
    if not key:
        return ""
    payload = {
        "purpose": purpose,
        "nonce": secrets.token_urlsafe(24),
        "ts": int(time.time()),
    }
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    sig = hmac.new(key, payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def verify_mfa_challenge(value: str, purpose: str = MFA_CHALLENGE_PURPOSE) -> bool:
    """Verify a signed MFA challenge token and its short TTL."""
    key = _mfa_hmac_key(b"dsa-mfa-challenge-v1")
    if not key or not value:
        return False
    try:
        payload_b64, sig = value.split(".", 1)
    except ValueError:
        return False
    expected = hmac.new(key, payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return False
    try:
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return False
    if not isinstance(payload, dict) or payload.get("purpose") != purpose:
        return False
    try:
        ts = int(payload.get("ts", 0))
    except (TypeError, ValueError):
        return False
    if ts <= 0 or time.time() - ts > MFA_CHALLENGE_TTL_SECONDS:
        return False
    return True


def _normalize_recovery_code(code: str) -> str:
    """Normalize a recovery code while preserving hyphen grouping."""
    return "".join(str(code or "").strip().upper().split())


def _hash_recovery_code(code: str) -> dict[str, str]:
    salt = secrets.token_bytes(32)
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        _normalize_recovery_code(code).encode("utf-8"),
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    return {
        "salt": base64.standard_b64encode(salt).decode("ascii"),
        "hash": base64.standard_b64encode(derived).decode("ascii"),
    }


def _verify_recovery_code(code: str, entry: dict[str, str]) -> bool:
    try:
        salt = base64.standard_b64decode(entry.get("salt", ""))
        stored_hash = base64.standard_b64decode(entry.get("hash", ""))
    except (ValueError, TypeError):
        return False
    computed = hashlib.pbkdf2_hmac(
        "sha256",
        _normalize_recovery_code(code).encode("utf-8"),
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    return hmac.compare_digest(computed, stored_hash)


def generate_recovery_codes(count: int = 10) -> list[str]:
    """Generate human-readable single-use recovery codes."""
    return [
        f"{secrets.token_hex(4).upper()}-{secrets.token_hex(4).upper()}"
        for _ in range(count)
    ]


def _build_mfa_config(secret: str, codes: list[str]) -> dict[str, Any]:
    """Build the MFA config payload; caller is responsible for locking."""
    return {
        "enabled": True,
        "secret": secret,
        "created_at": int(time.time()),
        "last_used_counter": -1,
        "recovery_codes": [_hash_recovery_code(code) for code in codes],
    }


def is_mfa_enabled() -> bool:
    """Return whether a valid MFA configuration is stored."""
    with _mfa_file_lock():
        data = _read_json_file(_get_mfa_path())
        return bool(data and data.get("enabled") and data.get("secret"))


def get_recovery_codes_remaining() -> Optional[int]:
    """Return remaining recovery-code count when MFA is configured."""
    with _mfa_file_lock():
        data = _read_json_file(_get_mfa_path())
        if not data or not data.get("enabled"):
            return None
        codes = data.get("recovery_codes") or []
        return len(codes) if isinstance(codes, list) else 0


def enable_mfa_for_secret(secret: str, recovery_codes: Optional[list[str]] = None) -> Optional[list[str]]:
    """Enable MFA for a server-generated TOTP secret and return plaintext recovery codes once."""
    codes = recovery_codes or generate_recovery_codes()
    mfa_path = _get_mfa_path()
    pending_path = _get_mfa_pending_path()
    with _mfa_file_lock():
        previous_mfa = _read_json_file(mfa_path)
        previous_pending = _read_json_file(pending_path)
        _write_json_file(mfa_path, _build_mfa_config(secret, codes))
        _delete_file_if_exists(pending_path)
    if not rotate_session_secret():
        with _mfa_file_lock():
            _restore_json_file(mfa_path, previous_mfa)
            _restore_json_file(pending_path, previous_pending)
        return None
    return codes


def disable_mfa() -> bool:
    """Disable MFA and rotate sessions."""
    mfa_path = _get_mfa_path()
    pending_path = _get_mfa_pending_path()
    with _mfa_file_lock():
        previous_mfa = _read_json_file(mfa_path)
        previous_pending = _read_json_file(pending_path)
        _delete_file_if_exists(mfa_path)
        _delete_file_if_exists(pending_path)
    if not rotate_session_secret():
        with _mfa_file_lock():
            _restore_json_file(mfa_path, previous_mfa)
            _restore_json_file(pending_path, previous_pending)
        return False
    return True


def reset_mfa() -> bool:
    """Clear MFA state from the local server and rotate sessions."""
    return disable_mfa()


def create_pending_mfa_setup() -> dict[str, Any]:
    """Create short-lived pending setup state for a TOTP enrollment."""
    secret = pyotp.random_base32()
    uri = pyotp.TOTP(secret).provisioning_uri(name=MFA_ACCOUNT, issuer_name=MFA_ISSUER)
    created_at = int(time.time())
    with _mfa_file_lock():
        _write_json_file(
            _get_mfa_pending_path(),
            {
                "secret": secret,
                "created_at": created_at,
                "expires_at": created_at + MFA_PENDING_TTL_SECONDS,
            },
        )
    return {
        "secret": secret,
        "otpauth_uri": uri,
        "expires_at": created_at + MFA_PENDING_TTL_SECONDS,
    }


def _load_valid_pending_mfa_setup() -> Optional[dict[str, Any]]:
    pending = _read_json_file(_get_mfa_pending_path())
    if not pending:
        return None
    try:
        expires_at = int(pending.get("expires_at", 0))
    except (TypeError, ValueError):
        return None
    if expires_at < int(time.time()):
        _delete_file_if_exists(_get_mfa_pending_path())
        return None
    if not pending.get("secret"):
        return None
    return pending


def confirm_pending_mfa_setup(code: str, recovery_codes: Optional[list[str]] = None) -> tuple[bool, list[str]]:
    """Confirm pending MFA setup with a TOTP code and enable MFA."""
    codes = recovery_codes or generate_recovery_codes()
    mfa_path = _get_mfa_path()
    pending_path = _get_mfa_pending_path()
    with _mfa_file_lock():
        previous_mfa = _read_json_file(mfa_path)
        previous_pending = _read_json_file(pending_path)
        pending = _load_valid_pending_mfa_setup()
        if not pending:
            return False, []
        secret = str(pending["secret"])
        totp = pyotp.TOTP(secret)
        now = int(time.time())
        if not any(
            hmac.compare_digest(totp.at(counter * 30), str(code or "").strip())
            for counter in range(now // 30 - 1, now // 30 + 2)
        ):
            return False, []
        _write_json_file(mfa_path, _build_mfa_config(secret, codes))
        _delete_file_if_exists(pending_path)
    if not rotate_session_secret():
        with _mfa_file_lock():
            _restore_json_file(mfa_path, previous_mfa)
            _restore_json_file(pending_path, previous_pending)
        return False, []
    return True, codes


def regenerate_recovery_codes(recovery_codes: Optional[list[str]] = None) -> Optional[list[str]]:
    """Replace recovery codes for an enabled MFA config and return plaintext codes once."""
    codes = recovery_codes or generate_recovery_codes()
    with _mfa_file_lock():
        data = _read_json_file(_get_mfa_path())
        if not data or not data.get("enabled") or not data.get("secret"):
            return None
        data["recovery_codes"] = [_hash_recovery_code(code) for code in codes]
        _write_json_file(_get_mfa_path(), data)
    return codes


def verify_mfa_code(code: str) -> bool:
    """Verify a TOTP or recovery code and atomically consume replayable state."""
    submitted = str(code or "").strip()
    if not submitted:
        return False
    with _mfa_file_lock():
        data = _read_json_file(_get_mfa_path())
        if not data or not data.get("enabled") or not data.get("secret"):
            return False

        secret = str(data["secret"])
        now = int(time.time())
        current_counter = now // 30
        last_used = int(data.get("last_used_counter", -1))
        if submitted.isdigit() and len(submitted) == 6:
            totp = pyotp.TOTP(secret)
            for counter in range(current_counter - 1, current_counter + 2):
                if counter <= last_used:
                    continue
                if hmac.compare_digest(totp.at(counter * 30), submitted):
                    data["last_used_counter"] = counter
                    _write_json_file(_get_mfa_path(), data)
                    return True

        recovery_codes = data.get("recovery_codes") or []
        if isinstance(recovery_codes, list):
            for index, entry in enumerate(list(recovery_codes)):
                if isinstance(entry, dict) and _verify_recovery_code(submitted, entry):
                    del recovery_codes[index]
                    data["recovery_codes"] = recovery_codes
                    _write_json_file(_get_mfa_path(), data)
                    return True

    return False


def get_client_ip(request) -> str:
    """Get client IP, respecting TRUST_X_FORWARDED_FOR.

    When behind a single trusted reverse proxy, the proxy appends the real
    client IP as the rightmost entry in X-Forwarded-For.  We use [-1] instead
    of [0] so that an attacker cannot spoof an arbitrary leftmost value to
    rotate rate-limit buckets and bypass brute-force protection.
    """
    if os.getenv("TRUST_X_FORWARDED_FOR", "false").lower() == "true":
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[-1].strip()
    if request.client:
        return request.client.host or "127.0.0.1"
    return "127.0.0.1"


def check_rate_limit(ip: str) -> bool:
    """Return True if under limit, False if rate limited."""
    lock = _get_lock()
    now = time.time()
    with lock:
        expired_keys = [k for k, (_, ts) in _rate_limit.items() if now - ts > RATE_LIMIT_WINDOW_SEC]
        for k in expired_keys:
            del _rate_limit[k]
        if ip in _rate_limit:
            count, first_ts = _rate_limit[ip]
            if count >= RATE_LIMIT_MAX_FAILURES:
                return False
        return True


def record_login_failure(ip: str) -> None:
    """Record a failed login attempt for rate limiting."""
    lock = _get_lock()
    now = time.time()
    with lock:
        if ip in _rate_limit:
            count, first_ts = _rate_limit[ip]
            if now - first_ts > RATE_LIMIT_WINDOW_SEC:
                _rate_limit[ip] = (1, now)
            else:
                _rate_limit[ip] = (count + 1, first_ts)
        else:
            _rate_limit[ip] = (1, now)


def clear_rate_limit(ip: str) -> None:
    """Clear rate limit for IP after successful login."""
    lock = _get_lock()
    with lock:
        _rate_limit.pop(ip, None)


def overwrite_password(new_password: str) -> Optional[str]:
    """
    Overwrite stored password without verifying current. For CLI reset only.
    Returns error message or None on success.
    """
    if not is_auth_enabled():
        return "认证功能未启用"
    err = _validate_password(new_password)
    if err:
        return err

    data_dir = _get_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    cred_path = _get_credential_path()

    salt = secrets.token_bytes(32)
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        new_password.encode("utf-8"),
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    salt_b64 = base64.standard_b64encode(salt).decode("ascii")
    hash_b64 = base64.standard_b64encode(derived).decode("ascii")
    content = f"{salt_b64}:{hash_b64}"

    try:
        tmp_path = cred_path.with_suffix(".tmp")
        tmp_path.write_text(content)
        tmp_path.chmod(0o600)
        tmp_path.replace(cred_path)
        _load_credential_from_file()
        return None
    except OSError as e:
        logger.error("Failed to write credential file: %s", e)
        return "密码保存失败"


def reset_password_cli() -> int:
    """Interactive CLI to reset password. Returns exit code."""
    _ensure_env_loaded()
    if not _is_auth_enabled_from_env():
        print("Error: Auth is not enabled. Set ADMIN_AUTH_ENABLED=true in .env", file=sys.stderr)
        return 1

    print("Enter new admin password (will not echo):", end=" ")
    pwd = getpass.getpass("")
    err = _validate_password(pwd)
    if err:
        print(f"Error: {err}", file=sys.stderr)
        return 1

    print("Confirm new password:", end=" ")
    pwd2 = getpass.getpass("")
    if pwd != pwd2:
        print("Error: Passwords do not match", file=sys.stderr)
        return 1

    err = overwrite_password(pwd)
    if err:
        print(f"Error: {err}", file=sys.stderr)
        return 1

    print("Password has been reset successfully.")
    return 0


def reset_mfa_cli() -> int:
    """CLI to clear MFA state and rotate all sessions."""
    _ensure_env_loaded()
    if reset_mfa():
        print("MFA has been reset successfully.")
        return 0
    print("Error: Failed to reset MFA", file=sys.stderr)
    return 1


def _main() -> int:
    """CLI entry: auth maintenance subcommands."""
    if len(sys.argv) > 1 and sys.argv[1] == "reset_password":
        return reset_password_cli()
    if len(sys.argv) > 1 and sys.argv[1] == "reset_mfa":
        return reset_mfa_cli()
    print("Usage: python -m src.auth reset_password|reset_mfa", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(_main())
