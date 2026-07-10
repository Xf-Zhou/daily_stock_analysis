import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppPage, Badge, Card, EmptyState, StatCard, Toolbar } from '..';

describe('shared design primitives', () => {
  it('exposes stable slots on neutral bordered surfaces', () => {
    const { container } = render(
      <div>
        <Card>Card content</Card>
        <Badge>Status</Badge>
        <StatCard label="候选" value="36" />
        <Toolbar left={<span>Filters</span>} />
        <EmptyState title="暂无数据" />
      </div>,
    );

    for (const slot of ['card', 'badge', 'stat-card', 'toolbar', 'empty-state']) {
      expect(container.querySelector(`[data-slot="${slot}"]`)).not.toBeNull();
    }
    expect(screen.getByText('Card content').closest('[data-slot="card"]')).toHaveClass('border-border');
  });

  it('forwards page-level DOM attributes and width overrides', () => {
    render(
      <AppPage data-testid="wide-page" className="max-w-[2160px]">
        Wide page
      </AppPage>,
    );

    expect(screen.getByTestId('wide-page')).toHaveClass('max-w-[2160px]');
  });
});
