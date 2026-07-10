// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readE2e = (fileName: string) => (
  readFileSync(resolve(__dirname, '..', 'e2e', fileName), 'utf8')
);

describe('browser e2e design contracts', () => {
  it('uses the current login branding and submit labels in browser tests', () => {
    const smokeSource = readE2e('smoke.spec.ts');
    const reportSource = readE2e('report-markdown.spec.ts');

    expect(smokeSource).toContain('每日股票分析');
    expect(smokeSource).toContain('投研工作台');
    expect(smokeSource).toContain('/登录|完成设置并登录/');
    expect(reportSource).toContain('/登录|完成设置并登录/');
    expect(smokeSource).not.toContain('DAILY STOCK');
    expect(smokeSource).not.toContain('Analysis Engine');
    expect(smokeSource).not.toContain('授权进入工作台');
    expect(reportSource).not.toContain('授权进入工作台');
  });

  it('uses a stable history-item slot instead of the removed legacy class', () => {
    const reportSource = readE2e('report-markdown.spec.ts');

    expect(reportSource).toContain('[data-slot="history-item"]');
    expect(reportSource).not.toContain('.home-history-item');
  });
});
