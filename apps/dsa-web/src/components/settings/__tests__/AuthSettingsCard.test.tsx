import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthSettingsCard } from '../AuthSettingsCard';

const {
  refreshStatus,
  updateSettings,
  loginMfa,
  startMfaSetup,
  confirmMfaSetup,
  disableMfa,
  regenerateMfaRecoveryCodes,
  useAuthMock,
} = vi.hoisted(() => ({
  refreshStatus: vi.fn(),
  updateSettings: vi.fn(),
  loginMfa: vi.fn(),
  startMfaSetup: vi.fn(),
  confirmMfaSetup: vi.fn(),
  disableMfa: vi.fn(),
  regenerateMfaRecoveryCodes: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock('../../../hooks', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('../../../api/auth', () => ({
  authApi: {
    updateSettings,
    loginMfa,
    startMfaSetup,
    confirmMfaSetup,
    disableMfa,
    regenerateMfaRecoveryCodes,
  },
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <div data-testid="qr-code">{value}</div>,
}));

describe('AuthSettingsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({
      authEnabled: false,
      setupState: 'no_password',
      mfaEnabled: false,
      recoveryCodesRemaining: null,
      refreshStatus,
    });
  });

  it('enables auth with a new password and refreshes status', async () => {
    updateSettings.mockResolvedValue(undefined);
    refreshStatus.mockResolvedValue(undefined);

    render(<AuthSettingsCard />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('设置管理员密码'), { target: { value: 'passwd6' } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'passwd6' } });
    fireEvent.click(screen.getByRole('button', { name: '开启认证' }));

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith(true, 'passwd6', 'passwd6', undefined);
    });
    expect(refreshStatus).toHaveBeenCalled();
    expect(await screen.findByText('认证设置已更新')).toBeInTheDocument();
  });

  it('allows disabling auth without current password when the session is still valid', async () => {
    useAuthMock.mockReturnValue({
      authEnabled: true,
      setupState: 'enabled',
      mfaEnabled: false,
      recoveryCodesRemaining: null,
      refreshStatus,
    });
    updateSettings.mockResolvedValue(undefined);
    refreshStatus.mockResolvedValue(undefined);

    render(<AuthSettingsCard />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '关闭认证' }));

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith(false, undefined, undefined, undefined);
    });
    expect(refreshStatus).toHaveBeenCalled();
    expect(await screen.findByText('认证已关闭')).toBeInTheDocument();
  });

  it('requires MFA code when disabling auth while MFA is enabled', async () => {
    useAuthMock.mockReturnValue({
      authEnabled: true,
      setupState: 'enabled',
      mfaEnabled: true,
      recoveryCodesRemaining: 2,
      refreshStatus,
    });
    updateSettings.mockResolvedValue({ authEnabled: false });
    refreshStatus.mockResolvedValue(undefined);

    render(<AuthSettingsCard />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getAllByLabelText('当前管理员密码')[0], { target: { value: 'passwd6' } });

    fireEvent.click(screen.getByRole('button', { name: '关闭认证' }));

    expect(await screen.findByText('请输入 MFA 验证码或恢复码')).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('MFA 验证码或恢复码'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: '关闭认证' }));

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith(false, undefined, undefined, 'passwd6', '123456');
    });
  });

  it('shows only current password when re-enabling with a retained password', () => {
    useAuthMock.mockReturnValue({
      authEnabled: false,
      setupState: 'password_retained',
      mfaEnabled: false,
      recoveryCodesRemaining: null,
      refreshStatus,
    });

    render(<AuthSettingsCard />);

    fireEvent.click(screen.getByRole('checkbox'));

    expect(screen.getByLabelText('当前管理员密码')).toBeInTheDocument();
    expect(screen.queryByLabelText('设置管理员密码')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('确认新密码')).not.toBeInTheDocument();
  });

  it('does not show new password fields while auth is already enabled', () => {
    useAuthMock.mockReturnValue({
      authEnabled: true,
      setupState: 'enabled',
      mfaEnabled: false,
      recoveryCodesRemaining: null,
      refreshStatus,
    });

    render(<AuthSettingsCard />);

    expect(screen.queryByLabelText('设置管理员密码')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('确认新密码')).not.toBeInTheDocument();
  });

  it('blocks initial enable when the new password is missing', async () => {
    render(<AuthSettingsCard />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '开启认证' }));

    expect(await screen.findByText('设置新密码是必填项')).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('enters MFA verification when re-enabling retained auth requires it', async () => {
    useAuthMock.mockReturnValue({
      authEnabled: false,
      setupState: 'password_retained',
      mfaEnabled: true,
      recoveryCodesRemaining: null,
      refreshStatus,
    });
    updateSettings.mockResolvedValue({ mfaRequired: true });
    loginMfa.mockResolvedValue({ ok: true });
    refreshStatus.mockResolvedValue(undefined);

    render(<AuthSettingsCard />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('当前管理员密码'), { target: { value: 'passwd6' } });
    fireEvent.click(screen.getByRole('button', { name: '开启认证' }));

    expect(await screen.findByLabelText('验证码或恢复码')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('验证码或恢复码'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: '完成 MFA 验证' }));

    await waitFor(() => expect(loginMfa).toHaveBeenCalledWith('123456'));
    expect(refreshStatus).toHaveBeenCalled();
  });

  it('starts and confirms MFA setup with recovery codes', async () => {
    useAuthMock.mockReturnValue({
      authEnabled: true,
      setupState: 'enabled',
      mfaEnabled: false,
      recoveryCodesRemaining: null,
      refreshStatus,
    });
    startMfaSetup.mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/DSA',
      expiresAt: 123,
    });
    confirmMfaSetup.mockResolvedValue({
      recoveryCodes: ['AAAA-BBBB', 'CCCC-DDDD'],
    });
    refreshStatus.mockResolvedValue(undefined);

    render(<AuthSettingsCard />);

    fireEvent.change(screen.getByLabelText('当前管理员密码'), { target: { value: 'passwd6' } });
    fireEvent.click(screen.getByRole('button', { name: '开始绑定 MFA' }));

    expect(await screen.findByTestId('qr-code')).toHaveTextContent('otpauth://totp/DSA');
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('绑定验证码'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: '确认启用 MFA' }));

    expect(await screen.findByText('AAAA-BBBB')).toBeInTheDocument();
    expect(screen.getByText('CCCC-DDDD')).toBeInTheDocument();
    expect(confirmMfaSetup).toHaveBeenCalledWith('passwd6', '123456');
  });
});
