import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { KeyRound, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { authApi } from '../../api/auth';
import { getParsedApiError, isParsedApiError, type ParsedApiError } from '../../api/error';
import { useAuth } from '../../hooks';
import { Badge, Button, Input, Checkbox } from '../common';
import { SettingsAlert } from './SettingsAlert';
import { SettingsSectionCard } from './SettingsSectionCard';

function createNextModeLabel(authEnabled: boolean, desiredEnabled: boolean) {
  if (authEnabled && !desiredEnabled) {
    return '关闭认证';
  }
  if (!authEnabled && desiredEnabled) {
    return '开启认证';
  }
  return authEnabled ? '保持已开启' : '保持已关闭';
}

export const AuthSettingsCard: React.FC = () => {
  const { authEnabled, setupState, mfaEnabled, recoveryCodesRemaining, refreshStatus } = useAuth();
  const [desiredEnabled, setDesiredEnabled] = useState(authEnabled);
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [settingsMfaPending, setSettingsMfaPending] = useState(false);
  const [settingsMfaCode, setSettingsMfaCode] = useState('');
  const [authToggleMfaCode, setAuthToggleMfaCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | ParsedApiError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [mfaPassword, setMfaPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaConfirmCode, setMfaConfirmCode] = useState('');
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauthUri: string; expiresAt: number } | null>(null);
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = useState<string[]>([]);
  const [mfaAction, setMfaAction] = useState<'idle' | 'start' | 'confirm' | 'disable' | 'recover'>('idle');
  const [mfaError, setMfaError] = useState<string | ParsedApiError | null>(null);
  const [mfaSuccessMessage, setMfaSuccessMessage] = useState<string | null>(null);

  const requiresMfaForAuthToggle = authEnabled && !desiredEnabled && mfaEnabled;
  const isDirty = desiredEnabled !== authEnabled || currentPassword || password || passwordConfirm || authToggleMfaCode;
  const targetActionLabel = createNextModeLabel(authEnabled, desiredEnabled);

  const helperText = useMemo(() => {
    switch (setupState) {
      case 'no_password':
        return '系统尚未设置密码。启用认证前请先设置初始管理员密码，设置后请妥善保管。';
      case 'password_retained':
        return '系统已保留之前设置的管理员密码。输入当前密码即可快速重新启用认证。';
      case 'enabled':
        return !desiredEnabled
          ? mfaEnabled
            ? 'MFA 已启用。关闭管理员认证前需要当前密码和 MFA 验证。'
            : '若当前登录会话仍有效，可直接关闭认证；若会话已失效，请输入当前管理员密码。'
          : '管理员认证已启用。如需更新密码，请使用下方的“修改密码”功能。';
      default:
        return '管理员认证可保护 Web 设置页及 API 接口，防止未经授权的访问。';
    }
  }, [setupState, desiredEnabled, mfaEnabled]);

  useEffect(() => {
    setDesiredEnabled(authEnabled);
  }, [authEnabled]);

  const resetForm = () => {
    setCurrentPassword('');
    setPassword('');
    setPasswordConfirm('');
    setSettingsMfaPending(false);
    setSettingsMfaCode('');
    setAuthToggleMfaCode('');
  };

  const resetMfaForm = () => {
    setMfaPassword('');
    setMfaCode('');
    setMfaConfirmCode('');
    setMfaSetup(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (settingsMfaPending) {
      if (!settingsMfaCode.trim()) {
        setError('请输入 MFA 验证码或恢复码');
        return;
      }
      setIsSubmitting(true);
      try {
        await authApi.loginMfa(settingsMfaCode.trim());
        await refreshStatus();
        setSuccessMessage('认证已重新开启');
        resetForm();
      } catch (err: unknown) {
        setError(getParsedApiError(err));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Initial setup validation
    if (setupState === 'no_password' && desiredEnabled) {
      if (!password) {
        setError('设置新密码是必填项');
        return;
      }
      if (password !== passwordConfirm) {
        setError('两次输入的新密码不一致');
        return;
      }
    }

    if (requiresMfaForAuthToggle) {
      if (!currentPassword.trim()) {
        setError('请输入当前管理员密码');
        return;
      }
      if (!authToggleMfaCode.trim()) {
        setError('请输入 MFA 验证码或恢复码');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const settingsArgs: Parameters<typeof authApi.updateSettings> = [
        desiredEnabled,
        password.trim() || undefined,
        passwordConfirm.trim() || undefined,
        currentPassword.trim() || undefined,
      ];
      if (requiresMfaForAuthToggle) {
        settingsArgs.push(authToggleMfaCode.trim());
      }
      const status = await authApi.updateSettings(...settingsArgs);
      if (status?.mfaRequired) {
        setSettingsMfaPending(true);
        setSettingsMfaCode('');
        setSuccessMessage('密码已验证，请完成 MFA 验证');
        return;
      }
      await refreshStatus();
      setSuccessMessage(desiredEnabled ? '认证设置已更新' : '认证已关闭');
      resetForm();
    } catch (err: unknown) {
      setError(getParsedApiError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartMfaSetup = async () => {
    setMfaError(null);
    setMfaSuccessMessage(null);
    setMfaRecoveryCodes([]);
    if (!mfaPassword.trim()) {
      setMfaError('请输入当前管理员密码');
      return;
    }
    setMfaAction('start');
    try {
      const setup = await authApi.startMfaSetup(mfaPassword.trim());
      setMfaSetup(setup);
      setMfaSuccessMessage('请用验证器扫描二维码后输入验证码完成绑定');
    } catch (err: unknown) {
      setMfaError(getParsedApiError(err));
    } finally {
      setMfaAction('idle');
    }
  };

  const handleConfirmMfaSetup = async () => {
    setMfaError(null);
    setMfaSuccessMessage(null);
    if (!mfaPassword.trim()) {
      setMfaError('请输入当前管理员密码');
      return;
    }
    if (!mfaConfirmCode.trim()) {
      setMfaError('请输入验证器中的 6 位验证码');
      return;
    }
    setMfaAction('confirm');
    try {
      const result = await authApi.confirmMfaSetup(mfaPassword.trim(), mfaConfirmCode.trim());
      setMfaRecoveryCodes(result.recoveryCodes ?? []);
      setMfaSuccessMessage('MFA 已启用，请妥善保存恢复码');
      resetMfaForm();
      await refreshStatus();
    } catch (err: unknown) {
      setMfaError(getParsedApiError(err));
    } finally {
      setMfaAction('idle');
    }
  };

  const handleDisableMfa = async () => {
    setMfaError(null);
    setMfaSuccessMessage(null);
    if (!mfaPassword.trim() || !mfaCode.trim()) {
      setMfaError('请输入当前密码和 MFA 验证码或恢复码');
      return;
    }
    setMfaAction('disable');
    try {
      await authApi.disableMfa(mfaPassword.trim(), mfaCode.trim());
      setMfaSuccessMessage('MFA 已禁用');
      setMfaRecoveryCodes([]);
      resetMfaForm();
      await refreshStatus();
    } catch (err: unknown) {
      setMfaError(getParsedApiError(err));
    } finally {
      setMfaAction('idle');
    }
  };

  const handleRegenerateRecoveryCodes = async () => {
    setMfaError(null);
    setMfaSuccessMessage(null);
    if (!mfaPassword.trim() || !mfaCode.trim()) {
      setMfaError('请输入当前密码和 MFA 验证码或恢复码');
      return;
    }
    setMfaAction('recover');
    try {
      const result = await authApi.regenerateMfaRecoveryCodes(mfaPassword.trim(), mfaCode.trim());
      setMfaRecoveryCodes(result.recoveryCodes ?? []);
      setMfaSuccessMessage('恢复码已重新生成，旧恢复码已失效');
      setMfaCode('');
      await refreshStatus();
    } catch (err: unknown) {
      setMfaError(getParsedApiError(err));
    } finally {
      setMfaAction('idle');
    }
  };

  return (
    <SettingsSectionCard
      title="认证与登录保护"
      description="管理管理员密码认证，保护您的系统配置安全。"
      actions={
        <Badge
          variant={authEnabled ? 'success' : 'default'}
          size="sm"
          className={authEnabled ? '' : 'border-border bg-muted text-muted-foreground'}
        >
          {authEnabled ? '已启用' : '未启用'}
        </Badge>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="rounded-md border border-border bg-background p-4 transition-colors duration-200 hover:bg-muted/30">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">管理员认证</p>
              <p className="text-xs leading-6 text-muted-text">{helperText}</p>
            </div>
            <Checkbox
              checked={desiredEnabled}
              disabled={isSubmitting}
              label={desiredEnabled ? '开启' : '关闭'}
              onChange={(event) => setDesiredEnabled(event.target.checked)}
              containerClassName="rounded-md border border-border bg-muted px-4 py-2 transition-colors duration-200 hover:bg-accent"
            />
          </div>
        </div>

        {settingsMfaPending ? (
          <div className="rounded-md border border-border bg-muted/30 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <KeyRound className="h-4 w-4 text-[var(--settings-accent)]" />
              <span>完成 MFA 验证</span>
            </div>
            <Input
              label="验证码或恢复码"
              type="text"
              value={settingsMfaCode}
              onChange={(event) => setSettingsMfaCode(event.target.value)}
              autoComplete="one-time-code"
              disabled={isSubmitting}
              placeholder="输入 6 位验证码或恢复码"
            />
          </div>
        ) : null}

        {/* Password input fields logic based on setupState and desiredEnabled */}
        {!settingsMfaPending && (desiredEnabled || (authEnabled && !desiredEnabled)) && (
          <div className="grid gap-4 md:grid-cols-2">
            {/* Show Current Password if we have one and we're either re-enabling or turning off */}
            {(setupState === 'password_retained' && desiredEnabled) || 
             (setupState === 'enabled' && !desiredEnabled) ? (
              <div className="space-y-3">
                <Input
                  label="当前管理员密码"
                  type="password"
                  allowTogglePassword
                  iconType="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  disabled={isSubmitting}
                  placeholder="请输入当前密码"
                  hint={setupState === 'password_retained' ? '输入旧密码以重新激活认证' : '关闭认证前可能需要验证身份'}
                />
              </div>
            ) : null}

            {requiresMfaForAuthToggle ? (
              <div className="space-y-3">
                <Input
                  label="MFA 验证码或恢复码"
                  type="text"
                  value={authToggleMfaCode}
                  onChange={(event) => setAuthToggleMfaCode(event.target.value)}
                  autoComplete="one-time-code"
                  disabled={isSubmitting}
                  placeholder="输入 6 位验证码或恢复码"
                  hint="MFA 已启用，关闭管理员认证也需要二次验证"
                />
              </div>
            ) : null}

            {/* Show New Password fields only during initial setup */}
            {setupState === 'no_password' && desiredEnabled ? (
              <>
                <div className="space-y-3">
                  <Input
                    label="设置管理员密码"
                    type="password"
                    allowTogglePassword
                    iconType="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    disabled={isSubmitting}
                    placeholder="输入新密码 (至少 6 位)"
                  />
                </div>
                <div className="space-y-3">
                  <Input
                    label="确认新密码"
                    type="password"
                    allowTogglePassword
                    iconType="password"
                    value={passwordConfirm}
                    onChange={(event) => setPasswordConfirm(event.target.value)}
                    autoComplete="new-password"
                    disabled={isSubmitting}
                    placeholder="再次输入以确认"
                  />
                </div>
              </>
            ) : null}
          </div>
        )}

        {error ? (
          isParsedApiError(error) ? (
            <SettingsAlert
              title="认证设置失败"
              message={error.message}
              variant="error"
            />
          ) : (
            <SettingsAlert title="认证设置失败" message={error} variant="error" />
          )
        ) : null}

        {successMessage ? (
          <SettingsAlert title="操作成功" message={successMessage} variant="success" />
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            variant="settings-primary"
            isLoading={isSubmitting}
            disabled={!settingsMfaPending && !isDirty}
          >
            {settingsMfaPending ? '完成 MFA 验证' : targetActionLabel}
          </Button>
          <Button
            type="button"
            variant="settings-secondary"
            onClick={() => {
              setDesiredEnabled(authEnabled);
              setError(null);
              setSuccessMessage(null);
              resetForm();
            }}
            disabled={isSubmitting || !isDirty}
          >
            还原
          </Button>
        </div>
      </form>

      <div className="mt-6 border-t border-[var(--settings-border)] pt-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {mfaEnabled ? (
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
              ) : (
                <ShieldOff className="h-4 w-4 text-muted-text" />
              )}
              <span>多因素验证 MFA</span>
            </p>
            <p className="text-xs leading-6 text-muted-text">
              {authEnabled
                ? '绑定验证器应用后，登录需要密码和一次性验证码。'
                : mfaEnabled
                  ? 'MFA 配置已保留；管理员认证关闭期间暂停生效，重新开启后继续要求验证。'
                  : '开启管理员认证后，可绑定验证器应用作为第二因素。'}
            </p>
          </div>
          <Badge variant={mfaEnabled ? 'success' : 'default'} size="sm">
            {mfaEnabled ? `已启用 · 恢复码 ${recoveryCodesRemaining ?? '-'} 个` : '未启用'}
          </Badge>
        </div>

        {authEnabled ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="当前管理员密码"
                type="password"
                allowTogglePassword
                iconType="password"
                value={mfaPassword}
                onChange={(event) => setMfaPassword(event.target.value)}
                autoComplete="current-password"
                disabled={mfaAction !== 'idle'}
                placeholder="输入当前密码"
              />
              {mfaEnabled ? (
                <Input
                  label="当前 MFA 验证码或恢复码"
                  type="text"
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value)}
                  autoComplete="one-time-code"
                  disabled={mfaAction !== 'idle'}
                  placeholder="输入 6 位验证码或恢复码"
                />
              ) : null}
            </div>

            {!mfaEnabled ? (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="settings-secondary"
                    onClick={handleStartMfaSetup}
                    isLoading={mfaAction === 'start'}
                    disabled={mfaAction !== 'idle'}
                  >
                    开始绑定 MFA
                  </Button>
                </div>

                {mfaSetup ? (
                  <div className="grid gap-4 rounded-xl border border-[var(--settings-border)] bg-[var(--settings-surface)] p-4 md:grid-cols-[auto_1fr]">
                    <div className="rounded-lg bg-white p-3">
                      <QRCodeSVG value={mfaSetup.otpauthUri} size={132} />
                    </div>
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-text">手动密钥</p>
                        <p className="mt-1 break-all font-mono text-sm text-foreground">{mfaSetup.secret}</p>
                      </div>
                      <Input
                        label="绑定验证码"
                        type="text"
                        value={mfaConfirmCode}
                        onChange={(event) => setMfaConfirmCode(event.target.value)}
                        autoComplete="one-time-code"
                        disabled={mfaAction !== 'idle'}
                        placeholder="输入验证器中的 6 位验证码"
                      />
                      <Button
                        type="button"
                        variant="settings-primary"
                        onClick={handleConfirmMfaSetup}
                        isLoading={mfaAction === 'confirm'}
                        disabled={mfaAction !== 'idle'}
                      >
                        确认启用 MFA
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="settings-secondary"
                  onClick={handleRegenerateRecoveryCodes}
                  isLoading={mfaAction === 'recover'}
                  disabled={mfaAction !== 'idle'}
                >
                  <RefreshCw className="h-4 w-4" />
                  重新生成恢复码
                </Button>
                <Button
                  type="button"
                  variant="settings-secondary"
                  onClick={handleDisableMfa}
                  isLoading={mfaAction === 'disable'}
                  disabled={mfaAction !== 'idle'}
                  className="border-red-500/40 text-red-300 hover:border-red-500/60 hover:bg-red-500/10"
                >
                  禁用 MFA
                </Button>
              </div>
            )}

            {mfaRecoveryCodes.length > 0 ? (
              <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
                <p className="text-sm font-semibold text-amber-200">恢复码只显示一次</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {mfaRecoveryCodes.map((code) => (
                    <code
                      key={code}
                      className="rounded-md border border-amber-400/20 bg-black/20 px-3 py-2 font-mono text-sm text-amber-100"
                    >
                      {code}
                    </code>
                  ))}
                </div>
              </div>
            ) : null}

            {mfaError ? (
              isParsedApiError(mfaError) ? (
                <SettingsAlert title="MFA 操作失败" message={mfaError.message} variant="error" />
              ) : (
                <SettingsAlert title="MFA 操作失败" message={mfaError} variant="error" />
              )
            ) : null}

            {mfaSuccessMessage ? (
              <SettingsAlert title="MFA 已更新" message={mfaSuccessMessage} variant="success" />
            ) : null}
          </div>
        ) : (
          <SettingsAlert
            title={mfaEnabled ? 'MFA 暂停生效' : '先开启管理员认证'}
            message={
              mfaEnabled
                ? '管理员认证关闭期间不会要求 MFA；重新开启认证时，如已保留 MFA 配置，将先要求二次验证。'
                : '管理员认证关闭时不能绑定 MFA；开启密码登录后可在这里绑定验证器应用。'
            }
            variant="warning"
          />
        )}
      </div>
    </SettingsSectionCard>
  );
};
