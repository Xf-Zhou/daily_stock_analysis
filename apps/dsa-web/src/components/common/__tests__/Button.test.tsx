import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '../Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);

    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('uses the neutral primary treatment without gradient or glow classes', () => {
    render(<Button>Analyze</Button>);

    const button = screen.getByRole('button', { name: 'Analyze' });
    expect(button).toHaveAttribute('data-slot', 'button');
    expect(button).toHaveClass('bg-primary', 'text-primary-foreground', 'rounded-md');
    expect(button.className).not.toMatch(/gradient|glow|cyan/);
  });

  it('uses button type by default and exposes the selected variant', () => {
    render(<Button variant="danger">Delete</Button>);

    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('data-variant', 'danger');
    expect(button.className).toContain('bg-danger');
  });

  it('disables the button when loading and shows loading text', () => {
    render(<Button isLoading loadingText="Saving">Save</Button>);

    const button = screen.getByRole('button', { name: /saving/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Saving')).toBeInTheDocument();
  });

  it('supports the danger-subtle variant', () => {
    render(<Button variant="danger-subtle">Bulk Delete</Button>);

    const button = screen.getByRole('button', { name: 'Bulk Delete' });
    expect(button).toHaveAttribute('data-variant', 'danger-subtle');
    expect(button.className).toContain('border-danger/60');
    expect(button.className).toContain('bg-danger/10');
  });

  it.each([
    ['action-primary', 'bg-primary', 'text-primary-foreground'],
    ['action-secondary', 'border-input', 'bg-background'],
  ] as const)('maps the %s alias to shared button styles', (variant, firstClass, secondClass) => {
    render(<Button variant={variant}>Quick Action</Button>);

    const button = screen.getByRole('button', { name: 'Quick Action' });
    expect(button).toHaveAttribute('data-variant', variant);
    expect(button).toHaveClass(firstClass, secondClass);
  });
});
