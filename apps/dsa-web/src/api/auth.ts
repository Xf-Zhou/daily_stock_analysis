import apiClient from './index';

export type AuthStatusResponse = {
  authEnabled: boolean;
  loggedIn: boolean;
  passwordSet?: boolean;
  passwordChangeable?: boolean;
  setupState: 'enabled' | 'password_retained' | 'no_password';
  mfaEnabled?: boolean;
  mfaRequired?: boolean;
  recoveryCodesRemaining?: number | null;
};

export type LoginResponse = {
  ok?: boolean;
  mfaRequired?: boolean;
};

export type MfaSetupStartResponse = {
  ok: boolean;
  secret: string;
  otpauthUri: string;
  expiresAt: number;
};

export type MfaRecoveryCodesResponse = AuthStatusResponse & {
  ok?: boolean;
  recoveryCodes?: string[];
};

export const authApi = {
  async getStatus(): Promise<AuthStatusResponse> {
    const { data } = await apiClient.get<AuthStatusResponse>('/api/v1/auth/status');
    return data;
  },

  async updateSettings(
    authEnabled: boolean,
    password?: string,
    passwordConfirm?: string,
    currentPassword?: string,
    mfaCode?: string
  ): Promise<AuthStatusResponse> {
    const body: {
      authEnabled: boolean;
      password?: string;
      passwordConfirm?: string;
      currentPassword?: string;
      mfaCode?: string;
    } = { authEnabled };
    if (password !== undefined) {
      body.password = password;
    }
    if (passwordConfirm !== undefined) {
      body.passwordConfirm = passwordConfirm;
    }
    if (currentPassword !== undefined) {
      body.currentPassword = currentPassword;
    }
    if (mfaCode !== undefined) {
      body.mfaCode = mfaCode;
    }
    const { data } = await apiClient.post<AuthStatusResponse>('/api/v1/auth/settings', body);
    return data;
  },

  async login(password: string, passwordConfirm?: string): Promise<LoginResponse> {
    const body: { password: string; passwordConfirm?: string } = { password };
    if (passwordConfirm !== undefined) {
      body.passwordConfirm = passwordConfirm;
    }
    const { data } = await apiClient.post<LoginResponse>('/api/v1/auth/login', body);
    return data;
  },

  async loginMfa(code: string): Promise<LoginResponse> {
    const { data } = await apiClient.post<LoginResponse>('/api/v1/auth/login/mfa', { code });
    return data;
  },

  async changePassword(
    currentPassword: string,
    newPassword: string,
    newPasswordConfirm: string,
    mfaCode?: string
  ): Promise<void> {
    await apiClient.post('/api/v1/auth/change-password', {
      currentPassword,
      newPassword,
      newPasswordConfirm,
      ...(mfaCode !== undefined ? { mfaCode } : {}),
    });
  },

  async startMfaSetup(currentPassword: string, mfaCode?: string): Promise<MfaSetupStartResponse> {
    const { data } = await apiClient.post<MfaSetupStartResponse>('/api/v1/auth/mfa/setup/start', {
      currentPassword,
      ...(mfaCode !== undefined ? { mfaCode } : {}),
    });
    return data;
  },

  async confirmMfaSetup(
    currentPassword: string,
    code: string,
    mfaCode?: string
  ): Promise<MfaRecoveryCodesResponse> {
    const { data } = await apiClient.post<MfaRecoveryCodesResponse>('/api/v1/auth/mfa/setup/confirm', {
      currentPassword,
      code,
      ...(mfaCode !== undefined ? { mfaCode } : {}),
    });
    return data;
  },

  async disableMfa(currentPassword: string, mfaCode: string): Promise<AuthStatusResponse> {
    const { data } = await apiClient.delete<AuthStatusResponse>('/api/v1/auth/mfa', {
      data: { currentPassword, mfaCode },
    });
    return data;
  },

  async regenerateMfaRecoveryCodes(
    currentPassword: string,
    mfaCode: string
  ): Promise<MfaRecoveryCodesResponse> {
    const { data } = await apiClient.post<MfaRecoveryCodesResponse>('/api/v1/auth/mfa/recovery-codes', {
      currentPassword,
      mfaCode,
    });
    return data;
  },

  async logout(): Promise<void> {
    await apiClient.post('/api/v1/auth/logout');
  },
};
