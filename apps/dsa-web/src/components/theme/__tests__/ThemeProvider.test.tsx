import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../ThemeProvider';

const { providerProps } = vi.hoisted(() => ({
  providerProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('next-themes', () => ({
  ThemeProvider: (props: Record<string, unknown> & { children: ReactNode }) => {
    providerProps.push(props);
    return <>{props.children}</>;
  },
}));

describe('ThemeProvider', () => {
  it('uses light only as the no-preference default while keeping system support', () => {
    render(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>,
    );

    expect(providerProps.at(-1)).toEqual(expect.objectContaining({
      attribute: 'class',
      defaultTheme: 'light',
      enableSystem: true,
      disableTransitionOnChange: true,
    }));
  });
});
