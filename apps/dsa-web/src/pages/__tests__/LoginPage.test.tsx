import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '../LoginPage';

const { navigate, useSearchParamsMock, useAuthMock } = vi.hoisted(() => ({
  navigate: vi.fn(),
  useSearchParamsMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock('../../hooks', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useSearchParams: () => useSearchParamsMock(),
  };
});

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.className = 'light';
    useSearchParamsMock.mockReturnValue([new URLSearchParams('redirect=%2Fsettings')]);
  });

  it('blocks first-time setup when confirmation does not match', async () => {
    const login = vi.fn();
    useAuthMock.mockReturnValue({
      login,
      loginMfa: vi.fn(),
      passwordSet: false,
      setupState: 'no_password',
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('管理员密码'), { target: { value: 'passwd6' } });
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'passwd7' } });
    fireEvent.click(screen.getByRole('button', { name: '完成设置并登录' }));

    expect(await screen.findByText('两次输入的密码不一致')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
    expect(screen.getByLabelText('管理员密码')).toHaveAttribute('data-slot', 'input');
    expect(screen.getByLabelText('确认密码')).toHaveAttribute('data-slot', 'input');
  });

  it('navigates to redirect after a successful login', async () => {
    useAuthMock.mockReturnValue({
      login: vi.fn().mockResolvedValue({ success: true }),
      loginMfa: vi.fn(),
      passwordSet: true,
      setupState: 'enabled',
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('登录密码'), { target: { value: 'passwd6' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/settings', { replace: true }));
    expect(screen.getByLabelText('登录密码')).toHaveAttribute('data-slot', 'input');
  });

  it('shows MFA step before navigating when login requires MFA', async () => {
    const login = vi.fn().mockResolvedValue({ success: true, mfaRequired: true });
    const loginMfa = vi.fn().mockResolvedValue({ success: true });
    useAuthMock.mockReturnValue({
      login,
      loginMfa,
      passwordSet: true,
      setupState: 'enabled',
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('登录密码'), { target: { value: 'passwd6' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByLabelText('验证码或恢复码')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('验证码或恢复码'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: '完成二次验证' }));

    await waitFor(() => expect(loginMfa).toHaveBeenCalledWith('123456'));
    expect(navigate).toHaveBeenCalledWith('/settings', { replace: true });
  });

  it('renders the shared neutral authentication surface', () => {
    useAuthMock.mockReturnValue({
      login: vi.fn(),
      loginMfa: vi.fn(),
      passwordSet: true,
      setupState: 'enabled',
    });

    const { container } = render(<LoginPage />);
    const pageRoot = container.firstElementChild as HTMLElement | null;

    expect(pageRoot).not.toBeNull();
    expect(pageRoot).toHaveClass('bg-muted/30');
    expect(container.querySelector('[data-slot="login-card"]')).toHaveClass('border-border', 'bg-card');
    expect(container.querySelector('canvas')).toBeNull();
  });
});
