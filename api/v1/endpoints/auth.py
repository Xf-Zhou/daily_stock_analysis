# -*- coding: utf-8 -*-
"""Authentication endpoints for Web admin login."""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from api.deps import get_system_config_service
from src.auth import (
    COOKIE_NAME,
    MFA_CHALLENGE_COOKIE_NAME,
    MFA_CHALLENGE_TTL_SECONDS,
    SESSION_MAX_AGE_HOURS_DEFAULT,
    change_password,
    check_rate_limit,
    confirm_pending_mfa_setup,
    create_mfa_challenge,
    create_pending_mfa_setup,
    clear_rate_limit,
    create_session,
    disable_mfa,
    get_recovery_codes_remaining,
    get_client_ip,
    has_stored_password,
    is_auth_enabled,
    is_mfa_enabled,
    is_password_changeable,
    is_password_set,
    record_login_failure,
    regenerate_recovery_codes,
    refresh_auth_state,
    rotate_session_secret,
    set_initial_password,
    verify_mfa_challenge,
    verify_mfa_code,
    verify_password,
    verify_stored_password,
    verify_session,
)
from src.config import Config, setup_env
from src.core.config_manager import ConfigManager

logger = logging.getLogger(__name__)

router = APIRouter()


class LoginRequest(BaseModel):
    """Login request body. For first-time setup use password + password_confirm."""

    model_config = {"populate_by_name": True}

    password: str = Field(default="", description="Admin password")
    password_confirm: str | None = Field(default=None, alias="passwordConfirm", description="Confirm (first-time)")


class MfaLoginRequest(BaseModel):
    """Second-step MFA login request."""

    model_config = {"populate_by_name": True}

    code: str = Field(default="", description="TOTP or recovery code")


class ChangePasswordRequest(BaseModel):
    """Change password request body."""

    model_config = {"populate_by_name": True}

    current_password: str = Field(default="", alias="currentPassword")
    new_password: str = Field(default="", alias="newPassword")
    new_password_confirm: str = Field(default="", alias="newPasswordConfirm")
    mfa_code: str = Field(default="", alias="mfaCode")


class AuthSettingsRequest(BaseModel):
    """Update auth enablement and initial password settings."""

    model_config = {"populate_by_name": True}

    auth_enabled: bool = Field(alias="authEnabled")
    password: str = Field(default="")
    password_confirm: str | None = Field(default=None, alias="passwordConfirm")
    current_password: str = Field(default="", alias="currentPassword")
    mfa_code: str = Field(default="", alias="mfaCode")


class MfaSetupStartRequest(BaseModel):
    """Start MFA setup after verifying the admin password."""

    model_config = {"populate_by_name": True}

    current_password: str = Field(default="", alias="currentPassword")
    mfa_code: str = Field(default="", alias="mfaCode")


class MfaSetupConfirmRequest(BaseModel):
    """Confirm a pending MFA setup with a TOTP code."""

    model_config = {"populate_by_name": True}

    current_password: str = Field(default="", alias="currentPassword")
    code: str = Field(default="", description="TOTP code from authenticator app")
    mfa_code: str = Field(default="", alias="mfaCode")


class MfaProtectedRequest(BaseModel):
    """Request body for MFA-protected settings operations."""

    model_config = {"populate_by_name": True}

    current_password: str = Field(default="", alias="currentPassword")
    mfa_code: str = Field(default="", alias="mfaCode")


def _cookie_params(request: Request) -> dict:
    """Build cookie params including Secure based on request."""
    secure = False
    if os.getenv("TRUST_X_FORWARDED_FOR", "false").lower() == "true":
        proto = request.headers.get("X-Forwarded-Proto", "").lower()
        secure = proto == "https"
    else:
        # Check URL scheme when not behind proxy
        secure = request.url.scheme == "https"

    try:
        max_age_hours = int(os.getenv("ADMIN_SESSION_MAX_AGE_HOURS", str(SESSION_MAX_AGE_HOURS_DEFAULT)))
    except ValueError:
        max_age_hours = SESSION_MAX_AGE_HOURS_DEFAULT
    max_age = max_age_hours * 3600

    return {
        "httponly": True,
        "samesite": "lax",
        "secure": secure,
        "path": "/",
        "max_age": max_age,
    }


def _apply_auth_enabled(enabled: bool, request: Request | None = None) -> bool:
    """Persist auth toggle to .env and reload runtime config."""
    manager_applied = False
    if request is not None:
        try:
            service = get_system_config_service(request)
            service.apply_simple_updates(
                updates=[("ADMIN_AUTH_ENABLED", "true" if enabled else "false")],
                mask_token="******",
            )
            manager_applied = True
        except Exception as exc:
            logger.warning(
                "Failed to apply auth toggle via shared SystemConfigService, falling back: %s",
                exc,
                exc_info=True,
            )
            manager_applied = False

    if not manager_applied:
        try:
            manager = ConfigManager()
            manager.apply_updates(
                updates=[("ADMIN_AUTH_ENABLED", "true" if enabled else "false")],
                sensitive_keys=set(),
                mask_token="******",
            )
            manager_applied = True
        except Exception as exc:
            logger.error("Failed to apply auth toggle via ConfigManager: %s", exc, exc_info=True)
            manager_applied = False

    if not manager_applied:
        return False

    Config.reset_instance()
    setup_env(override=True)
    refresh_auth_state()
    return True


def _password_set_for_response(auth_enabled: bool) -> bool:
    """Avoid exposing stored-password state when auth is disabled."""
    return is_password_set() if auth_enabled else False


def _set_session_cookie(response: Response, session_value: str, request: Request) -> None:
    """Attach the admin session cookie to a response."""
    params = _cookie_params(request)
    response.set_cookie(
        key=COOKIE_NAME,
        value=session_value,
        httponly=params["httponly"],
        samesite=params["samesite"],
        secure=params["secure"],
        path=params["path"],
        max_age=params["max_age"],
    )


def _set_mfa_challenge_cookie(response: Response, challenge_value: str, request: Request) -> None:
    """Attach a short-lived MFA challenge cookie scoped to the MFA endpoint."""
    params = _cookie_params(request)
    response.set_cookie(
        key=MFA_CHALLENGE_COOKIE_NAME,
        value=challenge_value,
        httponly=params["httponly"],
        samesite=params["samesite"],
        secure=params["secure"],
        path="/api/v1/auth/login/mfa",
        max_age=MFA_CHALLENGE_TTL_SECONDS,
    )


def _clear_mfa_challenge_cookie(response: Response) -> None:
    """Clear the short-lived MFA challenge cookie."""
    response.delete_cookie(key=MFA_CHALLENGE_COOKIE_NAME, path="/api/v1/auth/login/mfa")


def _mfa_required_response(request: Request, content: dict | None = None) -> JSONResponse:
    """Return an MFA-required response and issue a signed short-lived challenge."""
    challenge = create_mfa_challenge()
    if not challenge:
        return JSONResponse(
            status_code=500,
            content={"error": "internal_error", "message": "Failed to create MFA challenge"},
        )
    payload = {"ok": True, "mfaRequired": True}
    if content:
        payload.update(content)
    response = JSONResponse(content=payload)
    _set_mfa_challenge_cookie(response, challenge, request)
    return response


def _get_auth_status_dict(request: Request | None = None) -> dict:
    """Helper to build consistent auth status response body."""
    auth_enabled = is_auth_enabled()
    logged_in = False
    if auth_enabled and request:
        cookie_val = request.cookies.get(COOKIE_NAME)
        logged_in = verify_session(cookie_val) if cookie_val else False

    # setupState determination:
    # - enabled: auth is active
    # - password_retained: auth disabled but password exists
    # - no_password: auth disabled and no password exists
    if auth_enabled:
        setup_state = "enabled"
    elif has_stored_password():
        setup_state = "password_retained"
    else:
        setup_state = "no_password"

    mfa_enabled = is_mfa_enabled()
    recovery_remaining = get_recovery_codes_remaining() if logged_in else None

    return {
        "authEnabled": auth_enabled,
        "loggedIn": logged_in,
        "passwordSet": _password_set_for_response(auth_enabled),
        "passwordChangeable": is_password_changeable() if auth_enabled else False,
        "setupState": setup_state,
        "mfaEnabled": mfa_enabled,
        "mfaRequired": bool(auth_enabled and mfa_enabled and not logged_in),
        "recoveryCodesRemaining": recovery_remaining,
    }


@router.get(
    "/status",
    summary="Get auth status",
    description="Returns whether auth is enabled and if the current request is logged in.",
)
async def auth_status(request: Request):
    """Return authEnabled, loggedIn, passwordSet, passwordChangeable, setupState without requiring auth."""
    return _get_auth_status_dict(request)


def _rate_limited_response() -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={
            "error": "rate_limited",
            "message": "Too many failed attempts. Please try again later.",
        },
    )


def _verify_current_password_or_response(request: Request, current_password: str) -> JSONResponse | None:
    """Verify current stored admin password for settings operations."""
    if not current_password:
        return JSONResponse(
            status_code=400,
            content={"error": "current_required", "message": "请输入当前管理员密码"},
        )
    ip = get_client_ip(request)
    if not check_rate_limit(ip):
        return _rate_limited_response()
    if not verify_stored_password(current_password):
        record_login_failure(ip)
        return JSONResponse(
            status_code=401,
            content={"error": "invalid_password", "message": "当前密码错误"},
        )
    return None


def _verify_mfa_or_response(request: Request, mfa_code: str) -> JSONResponse | None:
    """Verify MFA for sensitive settings operations when configured."""
    if not is_mfa_enabled():
        return None
    if not mfa_code:
        return JSONResponse(
            status_code=400,
            content={"error": "mfa_required", "message": "请输入 MFA 验证码或恢复码"},
        )
    ip = get_client_ip(request)
    if not check_rate_limit(ip):
        return _rate_limited_response()
    if not verify_mfa_code(mfa_code):
        record_login_failure(ip)
        return JSONResponse(
            status_code=401,
            content={"error": "invalid_mfa_code", "message": "MFA 验证码或恢复码无效"},
        )
    return None


def _new_session_response(request: Request, content: dict) -> JSONResponse:
    """Create a fresh admin session after sensitive operations that rotate session secret."""
    session_val = create_session()
    if not session_val:
        return JSONResponse(
            status_code=500,
            content={"error": "internal_error", "message": "Failed to create session"},
        )
    response = JSONResponse(content=content)
    _set_session_cookie(response, session_val, request)
    clear_rate_limit(get_client_ip(request))
    return response


@router.post(
    "/settings",
    summary="Update auth settings",
    description=(
        "Enable or disable password login. When enabling without an existing password, "
        "password + passwordConfirm are required. When re-enabling with a stored password, "
        "currentPassword is required."
    ),
)
async def auth_update_settings(request: Request, body: AuthSettingsRequest):
    """Manage auth enablement from the settings page."""
    target_enabled = body.auth_enabled
    current_enabled = is_auth_enabled()
    stored_password_exists = has_stored_password()

    password = (body.password or "").strip()
    confirm = (body.password_confirm or "").strip()
    current_password = (body.current_password or "").strip()
    mfa_code = (body.mfa_code or "").strip()
    reenable_requires_mfa = False

    if target_enabled:
        if password or confirm:
            if stored_password_exists:
                return JSONResponse(
                    status_code=400,
                    content={
                        "error": "password_already_set",
                        "message": "已存在管理员密码，请启用认证后通过修改密码功能更新",
                    },
                )
            if not password:
                return JSONResponse(
                    status_code=400,
                    content={"error": "password_required", "message": "请输入要设置的管理员密码"},
                )
            if password != confirm:
                return JSONResponse(
                    status_code=400,
                    content={"error": "password_mismatch", "message": "两次输入的密码不一致"},
                )
            if has_stored_password():
                return JSONResponse(
                    status_code=400,
                    content={
                        "error": "password_already_set",
                        "message": "已存在管理员密码，请启用认证后通过修改密码功能更新",
                    },
                )
            err = set_initial_password(password)
            if err:
                return JSONResponse(
                    status_code=400,
                    content={"error": "invalid_password", "message": err},
                )
        elif not stored_password_exists:
            return JSONResponse(
                status_code=400,
                content={"error": "password_required", "message": "开启密码登录前请先设置密码"},
            )
        else:
            # P1 Vulnerability Fix: Enforce current-password check independent of global cached flag
            # We must verify they actually possess a valid admin session, otherwise an attacker
            # could hit a race condition when auth becomes enabled mid-flight.
            # This triggers whenever trying to enable/keep enabled an existing auth setup.
            cookie_val = request.cookies.get(COOKIE_NAME)
            # if target_enabled is True here, they are requesting to enable or keep auth enabled
            is_valid_session = cookie_val and verify_session(cookie_val)
            
            if not is_valid_session:
                password_error = _verify_current_password_or_response(request, current_password)
                if password_error:
                    password_error_body = getattr(password_error, "body", b"")
                    if b"current_required" in password_error_body:
                        return JSONResponse(
                            status_code=400,
                            content={"error": "current_required", "message": "重新开启认证前请输入当前密码"},
                        )
                    return password_error
                reenable_requires_mfa = bool(is_mfa_enabled() and not current_enabled)
    else:
        if current_enabled:
            if is_mfa_enabled():
                password_error = _verify_current_password_or_response(request, current_password)
                if password_error:
                    password_error_body = getattr(password_error, "body", b"")
                    if b"current_required" in password_error_body:
                        return JSONResponse(
                            status_code=400,
                            content={"error": "current_required", "message": "关闭认证前请输入当前密码"},
                        )
                    return password_error
                mfa_error = _verify_mfa_or_response(request, mfa_code)
                if mfa_error:
                    return mfa_error
            else:
                cookie_val = request.cookies.get(COOKIE_NAME)
                is_valid_session = cookie_val and verify_session(cookie_val)

                if not is_valid_session:
                    password_error = _verify_current_password_or_response(request, current_password)
                    if password_error:
                        password_error_body = getattr(password_error, "body", b"")
                        if b"current_required" in password_error_body:
                            return JSONResponse(
                                status_code=400,
                                content={"error": "current_required", "message": "关闭认证前请输入当前密码"},
                            )
                        return password_error

    if target_enabled != current_enabled:
        if not _apply_auth_enabled(target_enabled, request=request):
            return JSONResponse(
                status_code=500,
                content={"error": "internal_error", "message": "Failed to update auth settings"},
            )
        if not rotate_session_secret():
            rollback_ok = _apply_auth_enabled(current_enabled, request=request)
            if not rollback_ok:
                logger.error("Failed to roll back auth state after session secret rotation failure")
            return JSONResponse(
                status_code=500,
                content={"error": "internal_error", "message": "Failed to rotate session secret"},
            )
    else:
        if not _apply_auth_enabled(target_enabled, request=request):
            return JSONResponse(
                status_code=500,
                content={"error": "internal_error", "message": "Failed to update auth settings"},
            )

    if target_enabled:
        if reenable_requires_mfa:
            content = _get_auth_status_dict(request)
            content["authEnabled"] = True
            content["passwordSet"] = True
            content["mfaRequired"] = True
            content["loggedIn"] = False
            return _mfa_required_response(request, content=content)

        session_val = create_session()
        if not session_val:
            rollback_ok = _apply_auth_enabled(current_enabled, request=request)
            if not rollback_ok:
                logger.error("Failed to roll back auth state after session creation failure")
            return JSONResponse(
                status_code=500,
                content={"error": "internal_error", "message": "Failed to create session"},
            )
        # We manually set loggedIn=True because the cookie is being set in this response
        # and won't be visible in request.cookies until the NEXT request.
        content = _get_auth_status_dict(request)
        content["loggedIn"] = True
        resp = JSONResponse(content=content)
        _set_session_cookie(resp, session_val, request)
        clear_rate_limit(get_client_ip(request))
        return resp

    resp = JSONResponse(content=_get_auth_status_dict(request))
    resp.delete_cookie(key=COOKIE_NAME, path="/")
    return resp



@router.post(
    "/login",
    summary="Login or set initial password",
    description="Verify password and set session cookie. If password not set yet, accepts password+passwordConfirm.",
)
async def auth_login(request: Request, body: LoginRequest):
    """Verify password or set initial password, set cookie on success. Returns 401 or 429 on failure."""
    if not is_auth_enabled():
        return JSONResponse(
            status_code=400,
            content={"error": "auth_disabled", "message": "Authentication is not configured"},
        )

    password = (body.password or "").strip()
    if not password:
        return JSONResponse(
            status_code=400,
            content={"error": "password_required", "message": "请输入密码"},
        )

    ip = get_client_ip(request)
    if not check_rate_limit(ip):
        return JSONResponse(
            status_code=429,
            content={
                "error": "rate_limited",
                "message": "Too many failed attempts. Please try again later.",
            },
        )

    password_set = is_password_set()

    if not password_set:
        # First-time setup: require passwordConfirm
        confirm = (body.password_confirm or "").strip()
        if password != confirm:
            record_login_failure(ip)
            return JSONResponse(
                status_code=400,
                content={"error": "password_mismatch", "message": "Passwords do not match"},
            )
        err = set_initial_password(password)
        if err:
            record_login_failure(ip)
            return JSONResponse(
                status_code=400,
                content={"error": "invalid_password", "message": err},
            )
    else:
        if not verify_password(password):
            record_login_failure(ip)
            return JSONResponse(
                status_code=401,
                content={"error": "invalid_password", "message": "密码错误"},
            )

    if is_mfa_enabled():
        return _mfa_required_response(request)

    clear_rate_limit(ip)
    session_val = create_session()
    if not session_val:
        return JSONResponse(
            status_code=500,
            content={"error": "internal_error", "message": "Failed to create session"},
        )

    resp = JSONResponse(content={"ok": True})
    _set_session_cookie(resp, session_val, request)
    return resp


@router.post(
    "/login/mfa",
    summary="Complete MFA login",
    description="Verify a short-lived MFA challenge and TOTP/recovery code before issuing a full session.",
)
async def auth_login_mfa(request: Request, body: MfaLoginRequest):
    """Complete the second MFA login step."""
    if not is_auth_enabled():
        return JSONResponse(
            status_code=400,
            content={"error": "auth_disabled", "message": "Authentication is not configured"},
        )

    ip = get_client_ip(request)
    if not check_rate_limit(ip):
        return _rate_limited_response()

    challenge = request.cookies.get(MFA_CHALLENGE_COOKIE_NAME)
    if not challenge or not verify_mfa_challenge(challenge):
        record_login_failure(ip)
        return JSONResponse(
            status_code=401,
            content={"error": "invalid_mfa_challenge", "message": "MFA challenge 已失效，请重新输入密码"},
        )

    if not verify_mfa_code(body.code):
        record_login_failure(ip)
        return JSONResponse(
            status_code=401,
            content={"error": "invalid_mfa_code", "message": "MFA 验证码或恢复码无效"},
        )

    clear_rate_limit(ip)
    session_val = create_session()
    if not session_val:
        return JSONResponse(
            status_code=500,
            content={"error": "internal_error", "message": "Failed to create session"},
        )

    resp = JSONResponse(content={"ok": True, "mfaRequired": False})
    _set_session_cookie(resp, session_val, request)
    _clear_mfa_challenge_cookie(resp)
    return resp


@router.post(
    "/mfa/setup/start",
    summary="Start MFA setup",
    description="Create a short-lived server-side pending TOTP secret after password verification.",
)
async def auth_mfa_setup_start(request: Request, body: MfaSetupStartRequest):
    """Start MFA enrollment and return the otpauth URI for QR rendering."""
    if not is_auth_enabled():
        return JSONResponse(
            status_code=400,
            content={"error": "auth_disabled", "message": "Authentication is not configured"},
        )

    password_error = _verify_current_password_or_response(request, body.current_password.strip())
    if password_error:
        return password_error
    mfa_error = _verify_mfa_or_response(request, body.mfa_code.strip())
    if mfa_error:
        return mfa_error

    setup = create_pending_mfa_setup()
    return {
        "ok": True,
        "secret": setup["secret"],
        "otpauthUri": setup["otpauth_uri"],
        "expiresAt": setup["expires_at"],
    }


@router.post(
    "/mfa/setup/confirm",
    summary="Confirm MFA setup",
    description="Verify a pending TOTP secret and enable MFA.",
)
async def auth_mfa_setup_confirm(request: Request, body: MfaSetupConfirmRequest):
    """Confirm MFA enrollment and return recovery codes once."""
    if not is_auth_enabled():
        return JSONResponse(
            status_code=400,
            content={"error": "auth_disabled", "message": "Authentication is not configured"},
        )

    password_error = _verify_current_password_or_response(request, body.current_password.strip())
    if password_error:
        return password_error
    mfa_error = _verify_mfa_or_response(request, body.mfa_code.strip())
    if mfa_error:
        return mfa_error

    ok, recovery_codes = confirm_pending_mfa_setup(body.code.strip())
    if not ok:
        return JSONResponse(
            status_code=400,
            content={"error": "invalid_mfa_setup", "message": "MFA 绑定已过期或验证码无效"},
        )

    content = _get_auth_status_dict(request)
    content.update(
        {
            "ok": True,
            "loggedIn": True,
            "mfaEnabled": True,
            "mfaRequired": False,
            "recoveryCodesRemaining": len(recovery_codes),
            "recoveryCodes": recovery_codes,
        }
    )
    return _new_session_response(request, content)


@router.delete(
    "/mfa",
    summary="Disable MFA",
    description="Disable MFA after current password and MFA verification.",
)
async def auth_mfa_disable(request: Request, body: MfaProtectedRequest):
    """Disable MFA and rotate all existing sessions."""
    if not is_mfa_enabled():
        return JSONResponse(
            status_code=400,
            content={"error": "mfa_not_enabled", "message": "MFA 尚未启用"},
        )

    password_error = _verify_current_password_or_response(request, body.current_password.strip())
    if password_error:
        return password_error
    mfa_error = _verify_mfa_or_response(request, body.mfa_code.strip())
    if mfa_error:
        return mfa_error

    if not disable_mfa():
        return JSONResponse(
            status_code=500,
            content={"error": "internal_error", "message": "Failed to disable MFA"},
        )

    content = _get_auth_status_dict(request)
    content.update(
        {"ok": True, "loggedIn": True, "mfaEnabled": False, "mfaRequired": False, "recoveryCodesRemaining": None}
    )
    return _new_session_response(request, content)


@router.post(
    "/mfa/recovery-codes",
    summary="Regenerate MFA recovery codes",
    description="Replace single-use recovery codes after password and MFA verification.",
)
async def auth_mfa_regenerate_recovery_codes(request: Request, body: MfaProtectedRequest):
    """Regenerate recovery codes and return them once."""
    if not is_mfa_enabled():
        return JSONResponse(
            status_code=400,
            content={"error": "mfa_not_enabled", "message": "MFA 尚未启用"},
        )

    password_error = _verify_current_password_or_response(request, body.current_password.strip())
    if password_error:
        return password_error
    mfa_error = _verify_mfa_or_response(request, body.mfa_code.strip())
    if mfa_error:
        return mfa_error

    recovery_codes = regenerate_recovery_codes()
    if recovery_codes is None:
        return JSONResponse(
            status_code=400,
            content={"error": "mfa_not_enabled", "message": "MFA 尚未启用"},
        )

    return {
        "ok": True,
        "recoveryCodes": recovery_codes,
        "recoveryCodesRemaining": len(recovery_codes),
    }


@router.post(
    "/change-password",
    summary="Change password",
    description="Change password. Requires valid session.",
)
async def auth_change_password(request: Request, body: ChangePasswordRequest):
    """Change password. Requires login."""
    if not is_password_changeable():
        return JSONResponse(
            status_code=400,
            content={"error": "not_changeable", "message": "Password cannot be changed via web"},
        )

    current = (body.current_password or "").strip()
    new_pwd = (body.new_password or "").strip()
    new_confirm = (body.new_password_confirm or "").strip()

    if not current:
        return JSONResponse(
            status_code=400,
            content={"error": "current_required", "message": "请输入当前密码"},
        )
    if new_pwd != new_confirm:
        return JSONResponse(
            status_code=400,
            content={"error": "password_mismatch", "message": "两次输入的新密码不一致"},
        )

    ip = get_client_ip(request)
    if not check_rate_limit(ip):
        return _rate_limited_response()
    if not verify_stored_password(current):
        record_login_failure(ip)
        return JSONResponse(
            status_code=400,
            content={"error": "invalid_password", "message": "当前密码错误"},
        )

    mfa_error = _verify_mfa_or_response(request, body.mfa_code.strip())
    if mfa_error:
        return mfa_error

    err = change_password(current, new_pwd)
    if err:
        return JSONResponse(
            status_code=400,
            content={"error": "invalid_password", "message": err},
        )
    return Response(status_code=204)


@router.post(
    "/logout",
    summary="Logout",
    description="Clear session cookie.",
)
async def auth_logout(request: Request):
    """Clear session cookie."""
    if is_auth_enabled() and not rotate_session_secret():
        return JSONResponse(
            status_code=500,
            content={"error": "internal_error", "message": "Failed to invalidate session"},
        )
    resp = Response(status_code=204)
    resp.delete_cookie(key=COOKIE_NAME, path="/")
    return resp
