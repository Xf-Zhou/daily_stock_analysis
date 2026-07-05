import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../auth';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const del = vi.hoisted(() => vi.fn());

vi.mock('../index', () => ({
  default: {
    get,
    post,
    delete: del,
  },
}));

describe('authApi MFA methods', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    del.mockReset();
  });

  it('returns mfaRequired from the password login step', async () => {
    post.mockResolvedValueOnce({ data: { ok: true, mfaRequired: true } });

    const result = await authApi.login('passwd6');

    expect(post).toHaveBeenCalledWith('/api/v1/auth/login', { password: 'passwd6' });
    expect(result.mfaRequired).toBe(true);
  });

  it('submits MFA login code to the second-step endpoint', async () => {
    post.mockResolvedValueOnce({ data: { ok: true, mfaRequired: false } });

    await authApi.loginMfa('123456');

    expect(post).toHaveBeenCalledWith('/api/v1/auth/login/mfa', { code: '123456' });
  });

  it('starts and confirms MFA setup', async () => {
    post
      .mockResolvedValueOnce({ data: { ok: true, secret: 'SECRET', otpauthUri: 'otpauth://totp/DSA', expiresAt: 1 } })
      .mockResolvedValueOnce({ data: { ok: true, recoveryCodes: ['AAAA-BBBB'] } });

    await authApi.startMfaSetup('passwd6');
    await authApi.confirmMfaSetup('passwd6', '123456');

    expect(post).toHaveBeenNthCalledWith(1, '/api/v1/auth/mfa/setup/start', { currentPassword: 'passwd6' });
    expect(post).toHaveBeenNthCalledWith(2, '/api/v1/auth/mfa/setup/confirm', {
      currentPassword: 'passwd6',
      code: '123456',
    });
  });

  it('passes MFA code for sensitive settings operations', async () => {
    del.mockResolvedValueOnce({ data: { authEnabled: true, loggedIn: true, setupState: 'enabled' } });
    post.mockResolvedValueOnce({ data: { ok: true, recoveryCodes: ['AAAA-BBBB'] } });

    await authApi.disableMfa('passwd6', '123456');
    await authApi.regenerateMfaRecoveryCodes('passwd6', '654321');

    expect(del).toHaveBeenCalledWith('/api/v1/auth/mfa', {
      data: { currentPassword: 'passwd6', mfaCode: '123456' },
    });
    expect(post).toHaveBeenCalledWith('/api/v1/auth/mfa/recovery-codes', {
      currentPassword: 'passwd6',
      mfaCode: '654321',
    });
  });
});
