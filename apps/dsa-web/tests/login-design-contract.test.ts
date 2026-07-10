// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('login design contract', () => {
  it('uses shared surfaces without particle, parallax, glow, or inline keyframes', () => {
    const source = readFileSync(resolve(__dirname, '..', 'src', 'pages', 'LoginPage.tsx'), 'utf8');

    expect(source).not.toContain('ParticleBackground');
    expect(source).not.toContain('useMotionValue');
    expect(source).not.toContain('login-accent-glow');
    expect(source).not.toContain('dangerouslySetInnerHTML');
    expect(source).toContain('data-slot="login-card"');
  });
});
