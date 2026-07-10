import type React from 'react';
import { useEffect, useState } from 'react';
import { KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ParsedApiError } from '../api/error';
import { isParsedApiError } from '../api/error';
import { Button, Input } from '../components/common';
import { SettingsAlert } from '../components/settings';
import { useAuth } from '../hooks';

const LoginPage: React.FC = () => {
  const { login, loginMfa, passwordSet, setupState } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const rawRedirect = searchParams.get('redirect') ?? '';
  const redirect = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/';

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaStep, setMfaStep] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | ParsedApiError | null>(null);

  const isFirstTime = setupState === 'no_password' || !passwordSet;

  useEffect(() => {
    document.title = '登录 - DSA';
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (mfaStep) {
      if (!mfaCode.trim()) {
        setError('请输入 MFA 验证码或恢复码');
        return;
      }

      setIsSubmitting(true);
      try {
        const result = await loginMfa(mfaCode.trim());
        if (result.success) {
          navigate(redirect, { replace: true });
        } else {
          setError(result.error ?? 'MFA 验证失败');
        }
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (isFirstTime && password !== passwordConfirm) {
      setError('两次输入的密码不一致');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await login(password, isFirstTime ? passwordConfirm : undefined);
      if (result.success) {
        if (result.mfaRequired) {
          setMfaStep(true);
          setMfaCode('');
          return;
        }
        navigate(redirect, { replace: true });
      } else {
        setError(result.error ?? '登录失败');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitLabel = mfaStep
    ? isSubmitting ? '正在验证' : '完成二次验证'
    : isFirstTime
      ? isSubmitting ? '初始化中' : '完成设置并登录'
      : isSubmitting ? '正在登录' : '登录';

  const resetMfaStep = () => {
    setMfaStep(false);
    setMfaCode('');
    setError(null);
  };

  const fieldContent = mfaStep ? (
    <Input
      id="mfaCode"
      type="text"
      iconType="key"
      label="验证码或恢复码"
      placeholder="输入 6 位验证码或恢复码"
      value={mfaCode}
      onChange={(event) => setMfaCode(event.target.value)}
      disabled={isSubmitting}
      autoFocus
      autoComplete="one-time-code"
    />
  ) : (
    <>
      <Input
        id="password"
        type="password"
        allowTogglePassword
        iconType="password"
        label={isFirstTime ? '管理员密码' : '登录密码'}
        placeholder={isFirstTime ? '请设置 6 位以上密码' : '请输入密码'}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        disabled={isSubmitting}
        autoFocus
        autoComplete={isFirstTime ? 'new-password' : 'current-password'}
      />
      {isFirstTime ? (
        <Input
          id="passwordConfirm"
          type="password"
          allowTogglePassword
          iconType="password"
          label="确认密码"
          placeholder="再次确认管理员密码"
          value={passwordConfirm}
          onChange={(event) => setPasswordConfirm(event.target.value)}
          disabled={isSubmitting}
          autoComplete="new-password"
        />
      ) : null}
    </>
  );

  return (
    <main className="grid min-h-screen place-items-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3 px-1">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
            DSA
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">每日股票分析</p>
            <p className="text-xs text-muted-foreground">投研工作台</p>
          </div>
        </div>

        <section
          data-slot="login-card"
          className="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm"
        >
          <div className="mb-6">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              {mfaStep ? (
                <KeyRound className="h-5 w-5" />
              ) : isFirstTime ? (
                <ShieldCheck className="h-5 w-5" />
              ) : (
                <Lock className="h-5 w-5" />
              )}
              <span>{mfaStep ? 'MFA 验证' : isFirstTime ? '设置初始密码' : '管理员登录'}</span>
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {mfaStep
                ? '请输入验证器应用中的 6 位验证码，或使用一次性恢复码。'
                : isFirstTime
                  ? '首次启用认证，请为系统工作台设置管理员密码。'
                  : '请输入管理员凭据以访问 DSA 工作台。'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-4">{fieldContent}</div>

            {error ? (
              <SettingsAlert
                title={isFirstTime ? '配置失败' : '验证未通过'}
                message={isParsedApiError(error) ? error.message : error}
                variant="error"
              />
            ) : null}

            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              <span>{submitLabel}</span>
            </Button>

            {mfaStep ? (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={isSubmitting}
                onClick={resetMfaStep}
              >
                重新输入密码
              </Button>
            ) : null}
          </form>
        </section>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          管理员认证由当前部署环境安全配置提供
        </p>
      </div>
    </main>
  );
};

export default LoginPage;
