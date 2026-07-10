# DSA Web Frontend Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Execution status (2026-07-10):** Implemented. The checklist below is retained as the original execution reference; optional per-task commit checkpoints were consolidated into the user-approved final commit. Final evidence: 57 Vitest files / 500 tests passed, ESLint passed, the TypeScript/Vite production build passed, and the collapsed-sidebar Chromium smoke passed for route, theme, logout, and expand controls.

**Goal:** Rebuild the DSA Web visual system around a shadcn/ui-inspired, light-first workspace while preserving every existing route, API contract, state flow, and user action.

**Architecture:** Migrate from the bottom up: establish theme tokens, restyle shared primitives, replace the application shell, then migrate pages in functional groups. Keep React component APIs and business hooks stable, use Tailwind utilities plus a smaller global token layer, and remove legacy effects only after all consumers have moved.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4, next-themes, Motion, Vitest, Testing Library, Playwright.

## Global Constraints

- Work only in `apps/dsa-web/` except for the design/plan documents and the required `docs/CHANGELOG.md` entry.
- Keep all API modules, schemas, routes, Zustand stores, hooks, authentication semantics, SSE, polling, caching, and fallback behavior unchanged.
- Use the existing React, Tailwind, next-themes, Motion, Lucide, Vitest, and Playwright dependencies; do not add a component framework or run the shadcn CLI.
- Use local-first fonts only; do not load fonts or assets from a remote CDN.
- Default to the light theme only when no user preference exists; preserve stored `light`, `dark`, and `system` preferences.
- Preserve A-share color semantics: rising/danger remains red and falling/success remains green.
- Use 8–12px surface radii, 36–40px normal control heights, 150–200ms interaction transitions, and visible focus rings.
- Keep touch targets at least 40px where the control is used as a primary mobile interaction.
- Respect `prefers-reduced-motion` and never rely on color alone to communicate state.
- Do not update `README.md`; add one flat `[Unreleased]` entry to `docs/CHANGELOG.md` after implementation.
- Do not run `git commit`, `git tag`, or `git push` without explicit user confirmation. Commit commands below are optional checkpoints and must be skipped unless approval is granted.

---

## File Structure Map

### Theme foundation

- `apps/dsa-web/index.html`: pre-React theme bootstrap and color-scheme selection.
- `apps/dsa-web/src/index.css`: light/dark tokens, base styles, shared state colors, reduced-motion rules, and legacy CSS cleanup.
- `apps/dsa-web/src/components/theme/ThemeProvider.tsx`: next-themes default and persisted preference behavior.
- `apps/dsa-web/src/components/theme/ThemeToggle.tsx`: neutral menu/trigger presentation.

### Shared primitives

- `apps/dsa-web/src/components/common/Button.tsx`: stable button variants with neutral shadcn-style presentation.
- `apps/dsa-web/src/components/common/Input.tsx`: shared field, hint, error, and password-toggle presentation.
- `apps/dsa-web/src/components/common/Select.tsx`: shared native select presentation.
- `apps/dsa-web/src/components/common/Card.tsx`: base bordered surface.
- `apps/dsa-web/src/components/common/Badge.tsx`: compact semantic status label.
- `apps/dsa-web/src/components/common/AppPage.tsx`: standard page width and spacing.
- `apps/dsa-web/src/components/common/PageHeader.tsx`: plain page heading without glass effects.
- `apps/dsa-web/src/components/common/SectionCard.tsx`: section title/action composition.
- `apps/dsa-web/src/components/common/StatCard.tsx`: metric surface and semantic tone.
- `apps/dsa-web/src/components/common/Toolbar.tsx`: shared responsive filter/action surface.
- `apps/dsa-web/src/components/common/InlineAlert.tsx`: local request/status feedback.
- `apps/dsa-web/src/components/common/ApiErrorAlert.tsx`: parsed API failure feedback.
- `apps/dsa-web/src/components/common/EmptyState.tsx`: empty/loading recovery surface.

### Application shell

- `apps/dsa-web/src/components/layout/Shell.tsx`: responsive sidebar state, content frame, and mobile Drawer.
- `apps/dsa-web/src/components/layout/SidebarNav.tsx`: grouped navigation, collapse control, theme, logout, and completion badge.

### Page migrations

- `apps/dsa-web/src/pages/LoginPage.tsx`: shared neutral authentication surface.
- `apps/dsa-web/src/pages/HomePage.tsx`: history/report workspace.
- `apps/dsa-web/src/pages/DiscoverPage.tsx`: discovery filters, summary, ranking, and stock table.
- `apps/dsa-web/src/pages/CandidatePoolPage.tsx`: candidate filters, status, and candidate table.
- `apps/dsa-web/src/pages/PortfolioPage.tsx`: portfolio scope, metrics, positions, and risk panels.
- `apps/dsa-web/src/pages/BacktestPage.tsx`: backtest inputs, metrics, and results.
- `apps/dsa-web/src/pages/ChatPage.tsx`: session list, messages, progress, and composer.
- `apps/dsa-web/src/pages/SettingsPage.tsx`: category navigation, form sections, and action bar.
- `apps/dsa-web/src/components/settings/*.tsx`: settings-specific surfaces that currently depend on legacy settings tokens.

### Verification and documentation

- Existing component/page tests under `apps/dsa-web/src/**/__tests__/` remain the behavioral baseline.
- `apps/dsa-web/tests/ui_governance.test.ts` becomes the source-level guard against legacy visual patterns.
- `apps/dsa-web/tests/index.theme-bootstrap.test.ts` verifies no-flash light-first boot behavior.
- `apps/dsa-web/tests/login-theme-tokens.test.ts` is replaced by a login design-contract test because login no longer owns a parallel token system.
- `apps/dsa-web/e2e/smoke.spec.ts` gains desktop/mobile, light/dark visual-shell checks.
- `docs/CHANGELOG.md` records the user-visible Web redesign.

---

### Task 1: Establish the light-first theme foundation

**Files:**
- Create: `apps/dsa-web/src/components/theme/__tests__/ThemeProvider.test.tsx`
- Modify: `apps/dsa-web/tests/index.theme-bootstrap.test.ts`
- Modify: `apps/dsa-web/index.html`
- Modify: `apps/dsa-web/src/components/theme/ThemeProvider.tsx`
- Modify: `apps/dsa-web/src/components/theme/ThemeToggle.tsx`
- Modify: `apps/dsa-web/src/index.css`

**Interfaces:**
- Produces: `ThemeProvider` with `defaultTheme="light"`, persisted `light | dark | system` behavior, and shared CSS variables `--background`, `--foreground`, `--card`, `--muted`, `--border`, `--input`, `--ring`, `--primary`, `--destructive`, `--success`, and `--warning`.
- Consumes: existing `next-themes` storage key `theme` and the root `class` attribute.

- [ ] **Step 1: Write failing tests for the theme default and bootstrap**

Create `ThemeProvider.test.tsx`:

```tsx
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
    render(<ThemeProvider><div>content</div></ThemeProvider>);

    expect(providerProps.at(-1)).toEqual(expect.objectContaining({
      attribute: 'class',
      defaultTheme: 'light',
      enableSystem: true,
      disableTransitionOnChange: true,
    }));
  });
});
```

Update `index.theme-bootstrap.test.ts` to require explicit stored/system/default branches:

```ts
expect(indexHtml).toContain("const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';");
expect(indexHtml).toContain("storedTheme === 'system' ? systemTheme : 'light'");
expect(indexHtml).toContain("root.style.colorScheme = theme;");
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
cd apps/dsa-web
npm run test -- src/components/theme/__tests__/ThemeProvider.test.tsx tests/index.theme-bootstrap.test.ts
```

Expected: FAIL because `ThemeProvider` and `index.html` still default to dark.

- [ ] **Step 3: Implement light-first boot and neutral tokens**

Change the provider configuration to:

```tsx
<NextThemesProvider
  attribute="class"
  defaultTheme="light"
  enableSystem
  disableTransitionOnChange
>
  {children}
</NextThemesProvider>
```

Use this exact bootstrap decision in `index.html`:

```html
<script>
  (() => {
    const storageKey = 'theme';
    const root = document.documentElement;
    const storedTheme = localStorage.getItem(storageKey);
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const theme = storedTheme === 'light' || storedTheme === 'dark'
      ? storedTheme
      : storedTheme === 'system' ? systemTheme : 'light';
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    root.style.colorScheme = theme;
  })();
</script>
```

Set the core token values at the top of `index.css` to the following HSL values, while retaining semantic aliases used by existing pages until Task 10:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 240 10% 3.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 240 10% 3.9%;
  --primary: 240 5.9% 10%;
  --primary-foreground: 0 0% 98%;
  --secondary: 240 4.8% 95.9%;
  --secondary-foreground: 240 5.9% 10%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --accent: 240 4.8% 95.9%;
  --accent-foreground: 240 5.9% 10%;
  --destructive: 0 72.2% 50.6%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 5.9% 90%;
  --input: 240 5.9% 90%;
  --ring: 240 5.9% 10%;
  --success: 142 71% 45%;
  --warning: 38 92% 50%;
  --radius: 0.625rem;
}

.dark {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  --card: 240 10% 3.9%;
  --card-foreground: 0 0% 98%;
  --popover: 240 10% 3.9%;
  --popover-foreground: 0 0% 98%;
  --primary: 0 0% 98%;
  --primary-foreground: 240 5.9% 10%;
  --secondary: 240 3.7% 15.9%;
  --secondary-foreground: 0 0% 98%;
  --muted: 240 3.7% 15.9%;
  --muted-foreground: 240 5% 64.9%;
  --accent: 240 3.7% 15.9%;
  --accent-foreground: 0 0% 98%;
  --destructive: 0 62.8% 45%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 3.7% 15.9%;
  --input: 240 3.7% 15.9%;
  --ring: 240 4.9% 83.9%;
  --success: 142 69% 48%;
  --warning: 38 92% 55%;
}
```

Replace the root font declaration with a local-only stack:

```css
font-family: "Avenir Next", "Segoe UI", "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif;
```

Restyle `ThemeToggle` with `rounded-md`, `border-border`, `bg-background`, `shadow-md` only on its menu, and `bg-accent` for the active item. Keep all three theme choices and their labels.

- [ ] **Step 4: Run focused tests and verify they pass**

Run the command from Step 2.

Expected: PASS for both theme tests.

- [ ] **Step 5: Run theme-adjacent regression tests**

Run:

```bash
npm run test -- src/components/theme/__tests__/ThemeToggle.test.tsx tests/login-theme-tokens.test.ts
```

Expected: ThemeToggle tests PASS. The login token test may remain temporarily green because legacy aliases are removed in Task 4, not here.

- [ ] **Step 6: Optional approved commit checkpoint**

If explicit commit approval has been granted:

```bash
git add apps/dsa-web/index.html apps/dsa-web/src/index.css apps/dsa-web/src/components/theme apps/dsa-web/tests/index.theme-bootstrap.test.ts
git commit -m "refactor(web): establish light-first theme tokens"
```

Otherwise skip this step.

---

### Task 2: Restyle shared UI primitives

**Files:**
- Create: `apps/dsa-web/src/components/common/__tests__/DesignPrimitives.test.tsx`
- Modify: `apps/dsa-web/src/components/common/__tests__/Button.test.tsx`
- Modify: `apps/dsa-web/src/components/common/__tests__/Input.test.tsx`
- Modify: `apps/dsa-web/src/components/common/Button.tsx`
- Modify: `apps/dsa-web/src/components/common/Input.tsx`
- Modify: `apps/dsa-web/src/components/common/Select.tsx`
- Modify: `apps/dsa-web/src/components/common/Card.tsx`
- Modify: `apps/dsa-web/src/components/common/Badge.tsx`
- Modify: `apps/dsa-web/src/components/common/AppPage.tsx`
- Modify: `apps/dsa-web/src/components/common/PageHeader.tsx`
- Modify: `apps/dsa-web/src/components/common/SectionCard.tsx`
- Modify: `apps/dsa-web/src/components/common/StatCard.tsx`
- Modify: `apps/dsa-web/src/components/common/Toolbar.tsx`
- Modify: `apps/dsa-web/src/components/common/InlineAlert.tsx`
- Modify: `apps/dsa-web/src/components/common/ApiErrorAlert.tsx`
- Modify: `apps/dsa-web/src/components/common/EmptyState.tsx`

**Interfaces:**
- Consumes: Task 1 theme tokens.
- Produces: stable `data-slot` attributes (`button`, `input`, `select`, `card`, `badge`, `page-header`, `stat-card`, `toolbar`, `inline-alert`, `api-error-alert`, `empty-state`) and the existing public component props.
- Compatibility: retain every existing `Button` variant name, mapping specialized variants to the new neutral or semantic style rather than removing the prop values.

- [ ] **Step 1: Write failing primitive design-contract tests**

Add assertions to `Button.test.tsx`:

```tsx
it('uses the neutral primary treatment without gradient or glow classes', () => {
  render(<Button>Analyze</Button>);
  const button = screen.getByRole('button', { name: 'Analyze' });

  expect(button).toHaveAttribute('data-slot', 'button');
  expect(button).toHaveClass('bg-primary', 'text-primary-foreground', 'rounded-md');
  expect(button.className).not.toMatch(/gradient|glow|cyan/);
});
```

Add assertions to `Input.test.tsx`:

```tsx
it('uses the shared compact input surface and focus ring', () => {
  render(<Input label="股票代码" />);
  const input = screen.getByLabelText('股票代码');

  expect(input).toHaveAttribute('data-slot', 'input');
  expect(input).toHaveClass('h-10', 'rounded-md', 'border-input');
  expect(input.className).toContain('focus-visible:ring-2');
});
```

Create `DesignPrimitives.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge, Card, EmptyState, StatCard, Toolbar } from '..';

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
});
```

- [ ] **Step 2: Run primitive tests and verify they fail**

Run:

```bash
cd apps/dsa-web
npm run test -- src/components/common/__tests__/Button.test.tsx src/components/common/__tests__/Input.test.tsx src/components/common/__tests__/DesignPrimitives.test.tsx
```

Expected: FAIL because the stable slots and neutral class contracts do not exist.

- [ ] **Step 3: Implement the neutral component contracts**

Use this size and variant mapping in `Button.tsx`:

```tsx
const BUTTON_SIZE_STYLES = {
  xsm: 'h-7 rounded-md px-2 text-xs',
  sm: 'h-9 rounded-md px-3 text-sm',
  md: 'h-10 rounded-md px-4 text-sm',
  lg: 'h-11 rounded-md px-5 text-sm',
  xl: 'h-12 rounded-md px-6 text-base',
} as const;

const primary = 'border border-primary bg-primary text-primary-foreground hover:bg-primary/90';
const secondary = 'border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80';
const outline = 'border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground';

const BUTTON_VARIANT_STYLES = {
  primary,
  secondary,
  outline,
  ghost: 'border border-transparent bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
  gradient: primary,
  danger: 'border border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90',
  'danger-subtle': 'border border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15',
  'settings-primary': primary,
  'settings-secondary': outline,
  'action-primary': primary,
  'action-secondary': outline,
  'home-action-ai': outline,
  'home-action-report': outline,
} as const;
```

Add `data-slot="button"`, use `transition-colors duration-200`, and replace the focus classes with:

```tsx
'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
```

For `Input` and `Select`, use this shared field surface:

```tsx
'h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm transition-colors duration-200 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50'
```

Add the matching `data-slot` to each shared primitive. Use the following base surfaces:

```tsx
// Card
'rounded-lg border border-border bg-card text-card-foreground shadow-sm'

// Toolbar
'flex flex-col gap-3 rounded-lg border border-border bg-card p-3 md:flex-row md:items-center md:justify-between'

// EmptyState
'rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center'

// PageHeader
'flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between'
```

Set `AppPage` to:

```tsx
'mx-auto min-h-full w-full max-w-[1440px] space-y-6 px-4 py-6 sm:px-6 lg:px-8'
```

Set compact metric/badge/alert surfaces to:

```tsx
// StatCard root
'rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm'

// Badge root
'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium'

// InlineAlert root
'rounded-lg border px-4 py-3 text-sm'

// ApiErrorAlert root
'rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-destructive'
```

Keep error/semantic variants on alerts and badges, but remove backdrop blur, glow, gradient, and large shadow classes. Make `SectionCard` compose the new `Card` without its own parallel surface classes.

- [ ] **Step 4: Run focused primitive tests and verify they pass**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Run all shared-component tests**

Run:

```bash
npm run test -- src/components/common
```

Expected: PASS with no changed behavior for loading, password visibility, drawer, pagination, or scroll areas.

- [ ] **Step 6: Optional approved commit checkpoint**

If explicit commit approval has been granted:

```bash
git add apps/dsa-web/src/components/common
git commit -m "refactor(web): unify shared interface primitives"
```

Otherwise skip this step.

---

### Task 3: Replace the application shell with a grouped standard sidebar

**Files:**
- Modify: `apps/dsa-web/src/components/layout/Shell.tsx`
- Modify: `apps/dsa-web/src/components/layout/SidebarNav.tsx`
- Modify: `apps/dsa-web/src/components/layout/__tests__/Shell.test.tsx`
- Modify: `apps/dsa-web/src/components/layout/__tests__/SidebarNav.test.tsx`

**Interfaces:**
- Consumes: Task 2 Button/Tooltip/Drawer/ThemeToggle styling.
- Produces: `SidebarNavProps` with `collapsed?: boolean`, `onToggleCollapsed?: () => void`, and `onNavigate?: () => void`; `Shell` owns desktop collapse state and mobile Drawer state.
- Preserves: route destinations, chat completion badge, logout confirmation, and mobile navigation behavior.

- [ ] **Step 1: Write failing navigation structure and collapse tests**

Add to `SidebarNav.test.tsx`:

```tsx
it('groups routes and exposes an accessible collapse control', () => {
  const onToggleCollapsed = vi.fn();
  render(
    <MemoryRouter initialEntries={['/discover']}>
      <SidebarNav onToggleCollapsed={onToggleCollapsed} />
    </MemoryRouter>,
  );

  expect(screen.getByText('主要功能')).toBeInTheDocument();
  expect(screen.getByText('研究工具')).toBeInTheDocument();
  expect(screen.getByText('系统')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }));
  expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
});
```

Unskip and update the two Shell tests. Add:

```tsx
it('toggles the desktop sidebar between expanded and collapsed states', () => {
  const { container } = render(
    <MemoryRouter initialEntries={['/']}>
      <ThemeProvider><Shell><div>page content</div></Shell></ThemeProvider>
    </MemoryRouter>,
  );

  const sidebar = container.querySelector('[data-slot="app-sidebar"]');
  expect(sidebar).toHaveAttribute('data-collapsed', 'false');
  fireEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }));
  expect(sidebar).toHaveAttribute('data-collapsed', 'true');
  expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run layout tests and verify they fail**

Run:

```bash
cd apps/dsa-web
npm run test -- src/components/layout/__tests__/Shell.test.tsx src/components/layout/__tests__/SidebarNav.test.tsx
```

Expected: FAIL because the sidebar is fixed at 116px, grouping is absent, and `collapsed` is hard-coded.

- [ ] **Step 3: Implement the shell state and grouped navigation**

Use this navigation model in `SidebarNav.tsx`:

```tsx
const NAV_SECTIONS = [
  {
    label: '主要功能',
    items: [
      { key: 'home', label: '首页', to: '/', icon: Home, exact: true },
      { key: 'discover', label: '发现', to: '/discover', icon: Compass },
      { key: 'candidates', label: '候选', to: '/candidates', icon: Lightbulb },
    ],
  },
  {
    label: '研究工具',
    items: [
      { key: 'chat', label: '问股', to: '/chat', icon: MessageSquareQuote, badge: 'completion' },
      { key: 'portfolio', label: '持仓', to: '/portfolio', icon: BriefcaseBusiness },
      { key: 'backtest', label: '回测', to: '/backtest', icon: BarChart3 },
    ],
  },
  {
    label: '系统',
    items: [
      { key: 'settings', label: '设置', to: '/settings', icon: Settings2 },
    ],
  },
] satisfies Array<{ label: string; items: NavItem[] }>;
```

Add `onToggleCollapsed` to the prop type and render a bottom control with `PanelLeftClose`/`PanelLeftOpen`. Hide group labels and link text when collapsed, and wrap collapsed links with the existing `Tooltip` component.

In `Shell.tsx`, replace `const collapsed = false` with:

```tsx
const [collapsed, setCollapsed] = useState(false);
```

Use this desktop shell geometry:

```tsx
<div className="flex min-h-screen bg-background text-foreground">
  <aside
    data-slot="app-sidebar"
    data-collapsed={String(collapsed)}
    className={cn(
      'sticky top-0 hidden h-screen shrink-0 border-r border-border bg-card transition-[width] duration-200 lg:flex',
      collapsed ? 'w-[72px]' : 'w-[240px]',
    )}
  >
    <SidebarNav collapsed={collapsed} onToggleCollapsed={() => setCollapsed((value) => !value)} />
  </aside>
  <main className="min-w-0 flex-1 pt-14 lg:pt-0">{children ?? <Outlet />}</main>
</div>
```

Retain the existing mobile top controls and left Drawer. Remove the floating rounded desktop aside, cyan border, and glass/background blur classes.

- [ ] **Step 4: Run focused layout tests and verify they pass**

Run the command from Step 2.

Expected: PASS, including logout confirmation and chat completion badge.

- [ ] **Step 5: Run routing-level page smoke tests**

Run:

```bash
npm run test -- src/pages/__tests__/HomePage.test.tsx src/pages/__tests__/DiscoverPage.test.tsx src/pages/__tests__/CandidatePoolPage.test.tsx
```

Expected: PASS; the shell must not change page behavior.

- [ ] **Step 6: Optional approved commit checkpoint**

If explicit commit approval has been granted:

```bash
git add apps/dsa-web/src/components/layout
git commit -m "refactor(web): adopt grouped workspace sidebar"
```

Otherwise skip this step.

---

### Task 4: Redesign the login page around shared primitives

**Files:**
- Delete: `apps/dsa-web/tests/login-theme-tokens.test.ts`
- Create: `apps/dsa-web/tests/login-design-contract.test.ts`
- Modify: `apps/dsa-web/src/pages/LoginPage.tsx`
- Modify: `apps/dsa-web/src/pages/__tests__/LoginPage.test.tsx`
- Modify: `apps/dsa-web/src/components/common/Input.tsx`
- Modify: `apps/dsa-web/src/components/common/__tests__/Input.test.tsx`

**Interfaces:**
- Consumes: Task 1 theme tokens and Task 2 Button/Input/alert styling.
- Preserves: first-time password setup, password confirmation, MFA step, recovery-code entry, parsed errors, redirect validation, and document title.
- Produces: `[data-slot="login-card"]` and no login-only visual token dependency.

- [ ] **Step 1: Write the failing login design contract**

Create `login-design-contract.test.ts`:

```ts
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
```

Add to `LoginPage.test.tsx`:

```tsx
it('renders the shared neutral authentication surface', () => {
  useAuthMock.mockReturnValue({
    login: vi.fn(),
    loginMfa: vi.fn(),
    passwordSet: true,
    setupState: 'enabled',
  });

  const { container } = render(<LoginPage />);
  expect(container.firstElementChild).toHaveClass('bg-muted/30');
  expect(container.querySelector('[data-slot="login-card"]')).toHaveClass('border-border', 'bg-card');
  expect(container.querySelector('canvas')).toBeNull();
});
```

Update the two regular-login submit lookups from `授权进入工作台` to `登录`. Remove assertions that require `data-appearance="login"`; replace them with `data-slot="input"`. Delete the `supports the login appearance` case from `Input.test.tsx`, because the shared input is now the only supported appearance.

- [ ] **Step 2: Run login tests and verify they fail**

Run:

```bash
cd apps/dsa-web
npm run test -- src/pages/__tests__/LoginPage.test.tsx tests/login-design-contract.test.ts
```

Expected: FAIL because the current page uses particles, parallax, glow tokens, and inline keyframes.

- [ ] **Step 3: Implement the neutral login composition**

Remove Motion parallax imports/state, `ParticleBackground`, `Cpu`, `TrendingUp`, `Network`, and the mousemove effect. Retain only `useEffect` for `document.title` and the existing form state/submit handler.

Replace the visual wrapper with this structure, keeping the existing conditional field props and submit labels exactly as they are:

```tsx
return (
  <main className="grid min-h-screen place-items-center bg-muted/30 px-4 py-10">
    <div className="w-full max-w-sm">
      <div className="mb-6 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">DSA</div>
        <div>
          <p className="text-sm font-semibold text-foreground">每日股票分析</p>
          <p className="text-xs text-muted-foreground">投研工作台</p>
        </div>
      </div>

      <section data-slot="login-card" className="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            {mfaStep ? <KeyRound className="h-5 w-5" /> : isFirstTime ? <ShieldCheck className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
            <span>{mfaStep ? 'MFA 验证' : isFirstTime ? '设置初始密码' : '管理员登录'}</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
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
          {mfaStep ? <Button type="button" variant="ghost" className="w-full" onClick={resetMfaStep}>重新输入密码</Button> : null}
        </form>
      </section>
    </div>
  </main>
);
```

Implement `fieldContent`, `submitLabel`, and `resetMfaStep` immediately above the return from existing state and handlers, with these exact values:

```tsx
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
```

Remove the `appearance` prop and login-token branches from `Input.tsx` only after all LoginPage usages are gone.

- [ ] **Step 4: Run login tests and verify they pass**

Run the command from Step 2.

Expected: PASS for first-time setup, regular login, MFA, redirect, shared password visibility, and the neutral design contract.

- [ ] **Step 5: Verify no login-only token consumers remain**

Run:

```bash
rg -n "login-(accent|brand|grid|input|text|bg|border)|ParticleBackground|appearance=\"login\"" apps/dsa-web/src
```

Expected: no matches in `LoginPage.tsx` or `Input.tsx`. Any remaining definitions in `index.css` are removed in Task 10.

- [ ] **Step 6: Optional approved commit checkpoint**

If explicit commit approval has been granted:

```bash
git add apps/dsa-web/src/pages/LoginPage.tsx apps/dsa-web/src/pages/__tests__/LoginPage.test.tsx apps/dsa-web/src/components/common/Input.tsx apps/dsa-web/src/components/common/__tests__/Input.test.tsx apps/dsa-web/tests/login-design-contract.test.ts apps/dsa-web/tests/login-theme-tokens.test.ts
git commit -m "refactor(web): simplify the authentication surface"
```

Otherwise skip this step.

---

### Task 5: Migrate the home history/report workspace

**Files:**
- Modify: `apps/dsa-web/src/pages/HomePage.tsx`
- Modify: `apps/dsa-web/src/pages/__tests__/HomePage.test.tsx`
- Modify: `apps/dsa-web/src/components/history/HistoryList.tsx`
- Modify: `apps/dsa-web/src/components/history/HistoryListItem.tsx`
- Modify: `apps/dsa-web/src/components/dashboard/DashboardPanelHeader.tsx`
- Modify: `apps/dsa-web/src/components/dashboard/DashboardStateBlock.tsx`
- Modify: `apps/dsa-web/src/components/report/*.tsx`

**Interfaces:**
- Consumes: Task 2 primitives and Task 3 shell spacing.
- Produces: `[data-layout="report-workspace"]`, `[data-slot="home-toolbar"]`, `[data-slot="history-pane"]`, and `[data-slot="report-pane"]`.
- Preserves: report auto-load, search/autocomplete, notify checkbox, market-review polling, setup alerts, history selection/deletion, task panel, reanalysis, follow-up navigation, report drawer, and mobile history close behavior.

- [ ] **Step 1: Add failing semantic workspace assertions**

Add to `HomePage.test.tsx` in the existing empty-history test:

```tsx
const workspace = screen.getByTestId('home-dashboard');
expect(workspace).toHaveAttribute('data-layout', 'report-workspace');
expect(workspace.querySelector('[data-slot="home-toolbar"]')).not.toBeNull();
expect(workspace.querySelector('[data-slot="history-pane"]')).not.toBeNull();
expect(workspace.querySelector('[data-slot="report-pane"]')).not.toBeNull();
```

Update the mobile drawer test to require the shared Drawer semantics instead of the legacy `.page-drawer-overlay` class:

```tsx
expect(await screen.findByRole('dialog', { name: '历史分析' })).toBeInTheDocument();
```

- [ ] **Step 2: Run HomePage tests and verify the new assertions fail**

Run:

```bash
cd apps/dsa-web
npm run test -- src/pages/__tests__/HomePage.test.tsx
```

Expected: FAIL because the semantic slots and shared mobile Drawer are not present.

- [ ] **Step 3: Implement the shared two-column workspace**

Keep all hooks, callbacks, and the existing `sidebarContent` memo unchanged. Update the opening tags of the current root, toolbar header, desktop history wrapper, and report scroll section as follows; keep their current children in the same order:

```tsx
<div
  data-testid="home-dashboard"
  data-layout="report-workspace"
  className="flex h-[calc(100vh-3.5rem)] min-h-0 w-full flex-col bg-background lg:h-screen"
>
  <header data-slot="home-toolbar" className="shrink-0 border-b border-border bg-background px-4 py-3 lg:px-6">
  <div className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1">
    <aside data-slot="history-pane" className="hidden w-72 shrink-0 border-r border-border bg-card p-3 md:flex md:flex-col">
    <section
      ref={dashboardScrollRef}
      data-testid="home-dashboard-scroll"
      data-slot="report-pane"
      className="min-w-0 flex-1 overflow-x-auto overflow-y-auto px-4 py-5 touch-pan-y lg:px-8"
    >
```

Replace the hand-built mobile overlay with the existing `Drawer` component and reuse `sidebarContent`:

```tsx
<Drawer isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} title="历史分析" side="left" width="max-w-sm">
  {sidebarContent}
</Drawer>
```

Use `Button` for analysis and market-review actions. Keep `data-testid="home-dashboard-scroll"` on the report scroll container and preserve its `overflow-y-auto` behavior.

- [ ] **Step 4: Restyle history/report child surfaces**

Apply these consistent surfaces without changing props:

```tsx
// HistoryListItem root
'group relative rounded-md border border-transparent px-3 py-2.5 hover:bg-accent data-[selected=true]:border-border data-[selected=true]:bg-accent'

// Report section cards
'rounded-lg border border-border bg-card p-5 text-card-foreground'

// Report markdown prose container
'max-w-none text-sm leading-7 text-foreground'
```

Remove home-specific glow, gradient, and shadow class usage from the migrated JSX.

- [ ] **Step 5: Run HomePage and report/history tests**

Run:

```bash
npm run test -- src/pages/__tests__/HomePage.test.tsx src/components/history src/components/report
```

Expected: PASS, including market-review scrolling, report context navigation, history deletion, and report rendering.

- [ ] **Step 6: Optional approved commit checkpoint**

If explicit commit approval has been granted:

```bash
git add apps/dsa-web/src/pages/HomePage.tsx apps/dsa-web/src/pages/__tests__/HomePage.test.tsx apps/dsa-web/src/components/history apps/dsa-web/src/components/dashboard apps/dsa-web/src/components/report
git commit -m "refactor(web): streamline the report workspace"
```

Otherwise skip this step.

---

### Task 6: Unify discovery and candidate pages

**Files:**
- Modify: `apps/dsa-web/src/pages/DiscoverPage.tsx`
- Modify: `apps/dsa-web/src/pages/CandidatePoolPage.tsx`
- Modify: `apps/dsa-web/src/pages/__tests__/DiscoverPage.test.tsx`
- Modify: `apps/dsa-web/src/pages/__tests__/CandidatePoolPage.test.tsx`
- Modify: `apps/dsa-web/src/components/stocks/WatchlistStarButton.tsx`
- Modify: `apps/dsa-web/src/components/stocks/StockKLineDrawer.tsx`

**Interfaces:**
- Consumes: `AppPage`, `PageHeader`, `Toolbar`, `StatCard`, `SectionCard`, `Badge`, `Button`, `Input`, `Select` from Task 2.
- Produces: page-specific toolbar slots `discover-toolbar` and `candidate-toolbar`, plus a shared neutral table surface.
- Preserves: all filters, pagination, rankings, cache/fallback status, watchlist behavior, K-line drawer, analysis source values, and chat navigation.

- [ ] **Step 1: Write failing shared-structure assertions**

Add to `DiscoverPage.test.tsx`:

```tsx
it('uses the shared page, toolbar, metrics, and table surfaces', async () => {
  render(
    <MemoryRouter>
      <DiscoverPage />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('heading', { name: '股票发现' })).toBeInTheDocument();
  expect(screen.getByTestId('discover-toolbar')).toHaveAttribute('data-slot', 'toolbar');
  expect(screen.getAllByTestId('discover-stat')).toHaveLength(3);
  expect(screen.getByRole('table')).toHaveAttribute('data-slot', 'data-table');
});
```

Add to `CandidatePoolPage.test.tsx`:

```tsx
it('uses the shared page, toolbar, and candidate table surfaces', async () => {
  render(
    <MemoryRouter>
      <CandidatePoolPage />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('heading', { name: '推荐关注' })).toBeInTheDocument();
  expect(screen.getByTestId('candidate-toolbar')).toHaveAttribute('data-slot', 'toolbar');
  expect(screen.getByRole('table')).toHaveAttribute('data-slot', 'data-table');
});
```

- [ ] **Step 2: Run discovery/candidate tests and verify the new assertions fail**

Run:

```bash
cd apps/dsa-web
npm run test -- src/pages/__tests__/DiscoverPage.test.tsx src/pages/__tests__/CandidatePoolPage.test.tsx
```

Expected: FAIL on the new shared slots while existing behavioral assertions remain green.

- [ ] **Step 3: Recompose both pages using shared primitives**

Use this exact section order on both existing return trees: `AppPage`, `PageHeader`, `Toolbar`, feedback alerts, summary/ranking surfaces, then the main `SectionCard` containing the stock table and pagination. Set the Discover header to `title="股票发现"` and the Candidate header to `title="推荐关注"`; retain their current descriptions, badges, action handlers, filter nodes, table nodes, and pagination nodes.

Pass `data-testid` through each page's Toolbar wrapper using a surrounding element with `data-slot="toolbar"`, or extend `ToolbarProps` with `testId?: string` and render `data-testid={testId}`. Prefer the prop so both pages use the same interface:

```tsx
interface ToolbarProps {
  left?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
  testId?: string;
}
```

Add `data-slot="data-table"` to each `<table>`. Use `StatCard` for the three discovery counts and `data-testid="discover-stat"` on each instance through a new optional `testId?: string` prop.

- [ ] **Step 4: Normalize table and action styling**

Use the same table classes on both pages:

```tsx
const tableClassName = 'w-full text-sm';
const headClassName = 'border-b border-border bg-muted/50 text-left text-xs font-medium text-muted-foreground';
const rowClassName = 'border-b border-border transition-colors hover:bg-muted/50 last:border-b-0';
const cellClassName = 'px-3 py-3 align-middle';
```

Wrap each table in `<div className="overflow-x-auto" role="region" aria-label="股票数据表格">` so narrow screens scroll the data surface rather than the page. Keep watchlist star, K-line, analysis, and chat handlers untouched. Use compact `Button size="sm"` or existing accessible icon buttons, preserving every `aria-label`.

- [ ] **Step 5: Run full discovery/candidate and stock-drawer tests**

Run:

```bash
npm run test -- src/pages/__tests__/DiscoverPage.test.tsx src/pages/__tests__/CandidatePoolPage.test.tsx src/components/stocks
```

Expected: PASS for filtering, rankings, caching, watchlist conflict handling, K-line, analysis source, and pagination.

- [ ] **Step 6: Optional approved commit checkpoint**

If explicit commit approval has been granted:

```bash
git add apps/dsa-web/src/pages/DiscoverPage.tsx apps/dsa-web/src/pages/CandidatePoolPage.tsx apps/dsa-web/src/pages/__tests__/DiscoverPage.test.tsx apps/dsa-web/src/pages/__tests__/CandidatePoolPage.test.tsx apps/dsa-web/src/components/stocks apps/dsa-web/src/components/common/Toolbar.tsx apps/dsa-web/src/components/common/StatCard.tsx
git commit -m "refactor(web): unify stock discovery workspaces"
```

Otherwise skip this step.

---

### Task 7: Unify portfolio and backtest data workspaces

**Files:**
- Modify: `apps/dsa-web/src/pages/PortfolioPage.tsx`
- Modify: `apps/dsa-web/src/pages/BacktestPage.tsx`
- Modify: `apps/dsa-web/src/pages/__tests__/PortfolioPage.test.tsx`
- Modify: `apps/dsa-web/src/pages/__tests__/BacktestPage.test.tsx`

**Interfaces:**
- Consumes: shared page, toolbar, metric, alert, button, and table primitives.
- Produces: `[data-slot="portfolio-workspace"]` and `[data-slot="backtest-workspace"]`.
- Preserves: account scope, cost method, FX refresh and stale/error behavior, portfolio risk data, backtest filters, force mode, run flow, prediction windows, and result table output.

- [ ] **Step 1: Write failing workspace contract tests**

Add one assertion to the first render test in each file:

```tsx
expect(screen.getByTestId('portfolio-workspace')).toHaveAttribute('data-slot', 'portfolio-workspace');
```

```tsx
expect(screen.getByTestId('backtest-workspace')).toHaveAttribute('data-slot', 'backtest-workspace');
```

Add table assertions where data fixtures already render rows:

```tsx
expect(screen.getByRole('table')).toHaveAttribute('data-slot', 'data-table');
```

Replace the BacktestPage expectations for `input-surface` and `input-focus-glow` with:

```tsx
expect(filterInput).toHaveClass('rounded-md', 'border-input');
expect(windowInput).toHaveClass('rounded-md', 'border-input');
```

- [ ] **Step 2: Run both page test files and verify the new assertions fail**

Run:

```bash
cd apps/dsa-web
npm run test -- src/pages/__tests__/PortfolioPage.test.tsx src/pages/__tests__/BacktestPage.test.tsx
```

Expected: FAIL only on the new layout contracts.

- [ ] **Step 3: Migrate PortfolioPage composition**

Wrap the existing PortfolioPage content in `AppPage className="space-y-6"` and a child `<div data-testid="portfolio-workspace" data-slot="portfolio-workspace" className="space-y-6">`. Reorder only the existing visual sections into: `PageHeader` with title `持仓管理`, account/cost/refresh `Toolbar`, existing feedback alerts, a responsive `StatCard` grid, position `SectionCard`, then the existing risk/trade/cash/corporate-action sections. Keep request sequence guards, request arguments, form state, dialogs, and all refresh callbacks in place.

- [ ] **Step 4: Migrate BacktestPage composition**

Wrap the existing BacktestPage content in `AppPage className="space-y-6"` and a child `<div data-testid="backtest-workspace" data-slot="backtest-workspace" className="space-y-6">`. Arrange the existing visual sections as: `PageHeader` with title `策略回测`, filter/run `Toolbar`, feedback alerts, a responsive `StatCard` grid, then the result `SectionCard`. Keep the existing input labels, placeholders, button names, request payloads, and result rendering so tests and accessibility semantics remain stable. Apply the shared table classes from Task 6.

- [ ] **Step 5: Run portfolio/backtest tests and verify they pass**

Run the command from Step 2.

Expected: PASS for every FX race/fallback case and every backtest filter/run/window case.

- [ ] **Step 6: Optional approved commit checkpoint**

If explicit commit approval has been granted:

```bash
git add apps/dsa-web/src/pages/PortfolioPage.tsx apps/dsa-web/src/pages/BacktestPage.tsx apps/dsa-web/src/pages/__tests__/PortfolioPage.test.tsx apps/dsa-web/src/pages/__tests__/BacktestPage.test.tsx
git commit -m "refactor(web): align portfolio and backtest layouts"
```

Otherwise skip this step.

---

### Task 8: Simplify the chat workspace while preserving independent scrolling

**Files:**
- Modify: `apps/dsa-web/src/pages/ChatPage.tsx`
- Modify: `apps/dsa-web/src/pages/__tests__/ChatPage.test.tsx`
- Modify: `apps/dsa-web/src/stores/agentChatStore.ts` only if a visual-only selector extraction is required; do not change state shape or actions.

**Interfaces:**
- Consumes: shared Button, Badge, Input-like textarea surface, alerts, and Task progress colors.
- Produces: `[data-slot="chat-sessions"]`, `[data-slot="chat-messages"]`, and `[data-slot="chat-composer"]`.
- Preserves: independent session/message viewports, session switching/deletion, skill selection, exports, notification sends, report-context hydration, message actions, jump-to-latest behavior, and persisted context rendering.

- [ ] **Step 1: Extend the existing fixed-workspace test with semantic slots**

In the first `ChatPage.test.tsx` test, add:

```tsx
expect(screen.getByTestId('chat-workspace').querySelector('[data-slot="chat-sessions"]')).not.toBeNull();
expect(screen.getByTestId('chat-workspace').querySelector('[data-slot="chat-messages"]')).not.toBeNull();
expect(screen.getByTestId('chat-workspace').querySelector('[data-slot="chat-composer"]')).not.toBeNull();
```

- [ ] **Step 2: Run the chat test file and verify the new assertions fail**

Run:

```bash
cd apps/dsa-web
npm run test -- src/pages/__tests__/ChatPage.test.tsx
```

Expected: FAIL on missing semantic slots.

- [ ] **Step 3: Implement the neutral three-region layout**

Retain `data-testid="chat-workspace"`, the current refs, and the current height/overflow constraints. Apply the following opening-tag contracts to the existing root, desktop session wrapper, message scroller, and composer wrapper without extracting their children:

```tsx
<div data-testid="chat-workspace" className="flex h-[calc(100vh-3.5rem)] min-h-0 bg-background lg:h-screen">
  <aside data-slot="chat-sessions" className="hidden w-72 shrink-0 flex-col border-r border-border bg-card md:flex">
  <section className="flex min-w-0 flex-1 flex-col">
    <header className="shrink-0 border-b border-border bg-background px-4 py-3">
    <div data-slot="chat-messages" className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8">
    <footer data-slot="chat-composer" className="shrink-0 border-t border-border bg-background p-4">
```

Keep the already-defined `sidebarContent` in the desktop session wrapper and existing mobile session Drawer. Replace strong bubble backgrounds with:

```tsx
const userMessageClass = 'ml-auto max-w-[85%] rounded-lg bg-primary px-4 py-3 text-primary-foreground';
const assistantMessageClass = 'max-w-none border-b border-border py-5 text-foreground';
```

Style progress/tool rows with muted text plus semantic dots. Keep every existing message `data-*`, ref, scroll callback, export handler, and context expansion button.

- [ ] **Step 4: Add reduced-motion-safe message transitions**

Where Motion remains useful, set:

```tsx
transition={{ duration: 0.18 }}
```

Do not animate message container height during streaming. Use opacity/translate only for new fixed-height status rows.

- [ ] **Step 5: Run the full chat test file**

Run the command from Step 2.

Expected: PASS for all session, skills, notification, hydration, persisted context, and scrolling tests.

- [ ] **Step 6: Optional approved commit checkpoint**

If explicit commit approval has been granted:

```bash
git add apps/dsa-web/src/pages/ChatPage.tsx apps/dsa-web/src/pages/__tests__/ChatPage.test.tsx
git commit -m "refactor(web): simplify the chat workspace"
```

Otherwise skip this step.

---

### Task 9: Normalize settings navigation and form surfaces

**Files:**
- Modify: `apps/dsa-web/src/pages/SettingsPage.tsx`
- Modify: `apps/dsa-web/src/pages/__tests__/SettingsPage.test.tsx`
- Modify: `apps/dsa-web/src/components/settings/SettingsCategoryNav.tsx`
- Modify: `apps/dsa-web/src/components/settings/SettingsSectionCard.tsx`
- Modify: `apps/dsa-web/src/components/settings/SettingsField.tsx`
- Modify: `apps/dsa-web/src/components/settings/SettingsAlert.tsx`
- Modify: `apps/dsa-web/src/components/settings/SettingsLoading.tsx`
- Modify: `apps/dsa-web/src/components/settings/AuthSettingsCard.tsx`
- Modify: `apps/dsa-web/src/components/settings/ChangePasswordCard.tsx`
- Modify: `apps/dsa-web/src/components/settings/IntelligentImport.tsx`
- Modify: `apps/dsa-web/src/components/settings/LLMChannelEditor.tsx`
- Modify: `apps/dsa-web/src/components/settings/NotificationTestPanel.tsx`

**Interfaces:**
- Consumes: all Task 2 primitives.
- Produces: `[data-slot="settings-nav"]`, `[data-slot="settings-content"]`, and neutral section surfaces.
- Preserves: config loading/saving, local drafts, reset semantics, intelligent import, LLM channel editing, notification testing, auth/MFA, environment backup/import/export, build/version information, and desktop update behavior.

- [ ] **Step 1: Add failing settings layout assertions**

Extend the existing category-navigation test:

```tsx
expect(screen.getByTestId('settings-page').querySelector('[data-slot="settings-nav"]')).not.toBeNull();
expect(screen.getByTestId('settings-page').querySelector('[data-slot="settings-content"]')).not.toBeNull();
```

Add a section-card assertion:

```tsx
expect(screen.getAllByTestId('settings-section').every((node) => node.getAttribute('data-slot') === 'card')).toBe(true);
```

- [ ] **Step 2: Run settings tests and verify the new assertions fail**

Run:

```bash
cd apps/dsa-web
npm run test -- src/pages/__tests__/SettingsPage.test.tsx src/components/settings
```

Expected: FAIL only on the new layout/slot assertions.

- [ ] **Step 3: Implement the standard settings frame**

Wrap the current settings return tree in `AppPage className="space-y-6"` and `<div data-testid="settings-page" className="space-y-6">`. Keep the current PageHeader actions and feedback branches, then apply `className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]"` to the category/content container, `data-slot="settings-nav" className="self-start lg:sticky lg:top-6"` to the navigation wrapper, and `data-slot="settings-content" className="min-w-0 space-y-6"` to the active category wrapper.

Restyle `SettingsCategoryNav` items with:

```tsx
'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[active=true]:bg-accent data-[active=true]:font-medium data-[active=true]:text-accent-foreground'
```

Make `SettingsSectionCard` render the shared `Card` with `data-testid="settings-section"` and `data-slot="card"`.

- [ ] **Step 4: Remove settings-only surface variants from migrated components**

Replace `settings-primary`/`settings-secondary` calls with `primary`/`outline` where practical, while leaving the alias mapping in `Button` for compatibility. Replace `settings-surface*`, `settings-border*`, and glow classes with `bg-card`, `bg-muted`, `border-border`, `text-foreground`, and `text-muted-foreground`.

Keep field ids, labels, help buttons, import file inputs, and test selectors unchanged.

- [ ] **Step 5: Run settings page and component tests**

Run the command from Step 2.

Expected: PASS for every settings, backup, MFA, desktop update, notification, and import flow.

- [ ] **Step 6: Optional approved commit checkpoint**

If explicit commit approval has been granted:

```bash
git add apps/dsa-web/src/pages/SettingsPage.tsx apps/dsa-web/src/pages/__tests__/SettingsPage.test.tsx apps/dsa-web/src/components/settings
git commit -m "refactor(web): normalize settings surfaces"
```

Otherwise skip this step.

---

### Task 10: Remove legacy visual effects and add accessibility guards

**Files:**
- Delete: `apps/dsa-web/src/components/common/ParticleBackground.tsx`
- Modify: `apps/dsa-web/src/components/common/index.ts`
- Modify: `apps/dsa-web/src/index.css`
- Modify: `apps/dsa-web/tailwind.config.js`
- Modify: `apps/dsa-web/tests/ui_governance.test.ts`
- Modify: any migrated source file still reported by the guard command below.

**Interfaces:**
- Consumes: all migrated pages from Tasks 4–9.
- Produces: a smaller global stylesheet with theme/base/shared-state rules and no application use of legacy glass/terminal/glow/gradient classes.
- Preserves: markdown prose, score gauge, chart, status, backtest data, and report semantic styles that still have active consumers.

- [ ] **Step 1: Add failing source-governance rules**

Extend `ui_governance.test.ts`:

```ts
const forbiddenVisualPatterns = [
  /\bglass-panel(?:-lg)?\b/,
  /\bterminal-card(?:-hover)?\b/,
  /\bbg-primary-gradient\b/,
  /\bshadow-glow-[\w-]+\b/,
  /\bParticleBackground\b/,
];

it('keeps retired visual effects out of application source', () => {
  const violations = sourceFiles.flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    return forbiddenVisualPatterns
      .filter((pattern) => pattern.test(source))
      .map((pattern) => `${filePath}:${pattern.source}`);
  });

  expect(violations).toEqual([]);
});
```

Add a CSS contract:

```ts
it('defines a reduced-motion fallback', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');
  expect(css).toContain('@media (prefers-reduced-motion: reduce)');
});
```

- [ ] **Step 2: Run governance tests and capture all failures**

Run:

```bash
cd apps/dsa-web
npm run test -- tests/ui_governance.test.ts
```

Expected: FAIL with a finite list of remaining legacy class consumers and missing reduced-motion CSS.

- [ ] **Step 3: Remove remaining source consumers and dead exports**

Run:

```bash
rg -n "glass-panel|terminal-card|bg-primary-gradient|shadow-glow-|ParticleBackground" apps/dsa-web/src
```

For each reported JSX class, map it to the Task 2 neutral equivalent. Remove the `ParticleBackground` export from `components/common/index.ts`, delete its source file, and verify no imports remain.

- [ ] **Step 4: Add the reduced-motion rule and delete dead CSS blocks**

Add:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Use `rg` to identify definitions with no remaining source consumers. Delete only confirmed-dead blocks for login tokens, glass panels, terminal cards, home glows/gradients, settings glow/surface aliases, and particle/keyframe effects. Retain active markdown, chart, gauge, drawer, alert, and semantic state selectors.

Remove the retired `gradient-*`, `primary-gradient`, `glow-*`, and cyan shadow extensions from `tailwind.config.js` after `rg` confirms no consumers. Keep token-backed color aliases that active report, chart, or semantic status components still consume.

- [ ] **Step 5: Run governance and all component/page tests**

Run:

```bash
npm run test -- tests/ui_governance.test.ts
npm run test
```

Expected: PASS with no legacy-source violations and no behavioral regressions.

- [ ] **Step 6: Check stylesheet and source consistency**

Run:

```bash
rg -n "login-accent|login-grid|settings-glow|home-panel-gradient|terminal-card|glass-panel|ParticleBackground" apps/dsa-web/src apps/dsa-web/tests
```

Expected: no matches, except an intentionally retained compatibility selector must be documented in the plan execution notes before proceeding.

- [ ] **Step 7: Optional approved commit checkpoint**

If explicit commit approval has been granted:

```bash
git add apps/dsa-web/src apps/dsa-web/tests
git commit -m "refactor(web): retire legacy visual effects"
```

Otherwise skip this step.

---

### Task 11: Add responsive E2E checks, document the change, and run full verification

**Files:**
- Modify: `apps/dsa-web/e2e/smoke.spec.ts`
- Modify: `docs/CHANGELOG.md`

**Interfaces:**
- Consumes: completed Web redesign.
- Produces: deterministic shell/theme/mobile smoke coverage and the required changelog entry.

- [ ] **Step 1: Add E2E checks for desktop, mobile, light, and dark shell states**

Update the `login(page)` helper and login-page smoke assertions from the removed cyber branding to the new copy. The helper must use:

```ts
const submitButton = page.getByRole('button', { name: /登录|完成设置并登录/ });
```

The login-page test must assert visible text `每日股票分析`, `投研工作台`, and the submit name `/登录|完成设置并登录/`.

Add tests using the existing authenticated `login(page)` helper in `smoke.spec.ts`:

```ts
test('renders the light-first desktop shell and supports dark mode', async ({ page }) => {
  await login(page);
  await page.evaluate(() => localStorage.removeItem('theme'));
  await page.goto('/discover');
  await expect(page.locator('html')).toHaveClass(/light/);
  await expect(page.locator('[data-slot="app-sidebar"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: '股票发现' })).toBeVisible();

  await page.getByRole('button', { name: '切换主题' }).click();
  await page.getByRole('menuitemradio', { name: '深色' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('uses drawer navigation on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole('link', { name: '发现' }).click();
  await expect(page.locator('[data-slot="app-sidebar"]')).toBeHidden();
  await page.getByRole('button', { name: '打开导航菜单' }).click();
  await expect(page.getByRole('dialog', { name: '导航菜单' })).toBeVisible();
  await expect(page.getByRole('link', { name: '候选' })).toBeVisible();
});
```

- [ ] **Step 2: Run the E2E smoke suite and verify new checks pass**

Run:

```bash
cd apps/dsa-web
DSA_WEB_SMOKE_PASSWORD="$DSA_WEB_SMOKE_PASSWORD" npm run test:smoke
```

Expected: PASS with `DSA_WEB_SMOKE_PASSWORD` already set in the environment. If it is not set, authenticated tests will SKIP and the final delivery must list authenticated E2E coverage as unverified rather than claiming a full pass.

- [ ] **Step 3: Perform screenshot review at required viewports**

Start the app and use the repository Playwright workflow to capture the eight primary routes in both themes at 1440×1000 and 390×844:

```bash
npm run dev -- --host 127.0.0.1
```

Review `/`, `/discover`, `/candidates`, `/chat`, `/portfolio`, `/backtest`, `/settings`, and `/login`. Confirm:

- no horizontal page overflow outside intended table scrollers;
- sidebar expanded/collapsed and Drawer states are usable;
- focus rings are visible;
- errors, empty states, loading states, dialogs, and long tables remain readable;
- light and dark themes use the same hierarchy;
- browser console has no new errors.

- [ ] **Step 4: Add the changelog entry**

Append exactly one flat entry to `[Unreleased]` in `docs/CHANGELOG.md`:

```markdown
- [改进] Web 全站采用 shadcn/ui 风格的浅色优先设计体系，统一侧栏、通用组件、登录页、数据工作台、响应式布局与深色主题。
```

- [ ] **Step 5: Run final deterministic verification**

Run:

```bash
cd apps/dsa-web
npm run test
npm run lint
npm run build
```

Expected:

- Vitest: all tests PASS.
- ESLint: exit code 0 with no errors.
- TypeScript/Vite build: exit code 0 and production assets emitted under `apps/dsa-web/dist/`.

- [ ] **Step 6: Inspect the final diff and changed-file scope**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; changed files remain within `apps/dsa-web/`, `docs/CHANGELOG.md`, and `docs/superpowers/`; no backend, API, Schema, workflow, Docker, or desktop files changed.

- [ ] **Step 7: Optional approved final commit checkpoint**

If explicit commit approval has been granted:

```bash
git add apps/dsa-web docs/CHANGELOG.md docs/superpowers
git commit -m "feat(web): refresh the application interface"
```

Otherwise skip this step and report the uncommitted working tree.

---

## Final Acceptance Checklist

- [ ] A new user with no theme preference sees the light theme without a dark flash.
- [ ] Existing stored light, dark, and system preferences continue to work.
- [ ] Desktop uses a 240px grouped sidebar and can collapse to approximately 72px.
- [ ] Mobile uses a labeled Drawer and does not render the desktop sidebar.
- [ ] Login, home, discovery, candidates, chat, portfolio, backtest, and settings share one visual language.
- [ ] Shared cards, controls, alerts, metrics, tables, dialogs, and empty states use neutral tokens and visible focus rings.
- [ ] Red/green stock semantics and all status/fallback distinctions remain correct.
- [ ] No API, state, route, authentication, polling, SSE, caching, or fallback behavior changed.
- [ ] All component/page tests, lint, build, and Playwright smoke checks pass.
- [ ] `docs/CHANGELOG.md` uses the required flat `[Unreleased]` format.
- [ ] No commit, tag, or push occurs without explicit confirmation.

---

### Task 12: Home Workspace on Ultrawide Displays

**Files:**
- Modify: `apps/dsa-web/src/pages/HomePage.tsx`
- Test: `apps/dsa-web/src/pages/__tests__/HomePage.test.tsx`

**Interfaces:**
- Consumes: the existing `data-layout="report-workspace"`, `history-pane`, and `report-pane` layout contracts.
- Produces: a centered homepage workspace capped at 2160px, while retaining the existing 1440px breakpoint behavior and fixed history-pane width.

- [ ] **Step 1: Write the failing layout-contract test**

Add assertions to the existing workspace layout test:

```tsx
expect(workspace).toHaveClass('max-w-[2160px]');
expect(workspace).toHaveClass('2xl:px-6');
expect(screen.getByTestId('home-report-content')).toHaveClass('2xl:max-w-[1800px]');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd apps/dsa-web
npm run test -- src/pages/__tests__/HomePage.test.tsx
```

Expected: FAIL because the homepage still uses `max-w-[1440px]` and has no ultrawide report-content contract.

- [ ] **Step 3: Implement the adaptive width constraints**

In `HomePage.tsx`:

```tsx
<div
  data-testid="home-workspace-frame"
  className="mx-auto flex min-h-0 w-full max-w-[2160px] flex-1 flex-col 2xl:px-6"
>
```

Add `data-testid="home-report-content"` to the report content wrapper and cap only the readable report composition at `2xl:max-w-[1800px]`, leaving scroll behavior and the 288px history pane unchanged.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
cd apps/dsa-web
npm run test -- src/pages/__tests__/HomePage.test.tsx src/components/report src/components/history
```

Expected: all focused homepage, report, and history tests PASS.

- [ ] **Step 5: Verify production checks**

Run:

```bash
cd apps/dsa-web
npm run lint
npm run build
```

Expected: ESLint and TypeScript/Vite build exit with code 0.

- [ ] **Step 6: Inspect diff scope**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and no files outside the approved Web/design documentation scope.

---

### Task 13: Discovery Data Pages on Ultrawide Displays

**Files:**
- Modify: `apps/dsa-web/src/pages/DiscoverPage.tsx`
- Modify: `apps/dsa-web/src/pages/CandidatePoolPage.tsx`
- Test: `apps/dsa-web/src/pages/__tests__/DiscoverPage.test.tsx`
- Test: `apps/dsa-web/src/pages/__tests__/CandidatePoolPage.test.tsx`

**Interfaces:**
- Consumes: `AppPage`'s `className` override and the existing `discover-stock-table-scroll` / `candidate-table-scroll` data-table contracts.
- Produces: page-local `max-w-[2160px]` layouts and capped `2xl:max-w-[720px]` search-field containers without changing shared page defaults.

- [ ] **Step 1: Write failing page-width contract tests**

Add a stable page test id and assert the ultrawide classes:

```tsx
expect(screen.getByTestId('discover-page')).toHaveClass('max-w-[2160px]');
expect(screen.getByTestId('discover-search-field')).toHaveClass('2xl:max-w-[720px]');
expect(screen.getByTestId('candidate-page')).toHaveClass('max-w-[2160px]');
expect(screen.getByTestId('candidate-search-field')).toHaveClass('2xl:max-w-[720px]');
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd apps/dsa-web
npm run test -- src/pages/__tests__/DiscoverPage.test.tsx src/pages/__tests__/CandidatePoolPage.test.tsx
```

Expected: FAIL because neither page has page/search test ids or ultrawide width overrides.

- [ ] **Step 3: Implement page-local ultrawide sizing**

Apply these page roots:

```tsx
<AppPage data-testid="discover-page" className="max-w-[2160px] space-y-4">
<AppPage data-testid="candidate-page" className="max-w-[2160px] space-y-4">
```

Because `AppPage` does not currently forward DOM attributes, first extend its props from `React.HTMLAttributes<HTMLElement>` and spread remaining props onto `<main>`. Wrap each keyword `Input` in a `w-full 2xl:max-w-[720px]` container with the matching page-specific test id. Preserve all existing filtering, pagination, ranking and table behavior.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
cd apps/dsa-web
npm run test -- src/pages/__tests__/DiscoverPage.test.tsx src/pages/__tests__/CandidatePoolPage.test.tsx src/components/common/__tests__/DesignPrimitives.test.tsx
```

Expected: all discovery, candidate and shared primitive tests PASS.

- [ ] **Step 5: Run production verification**

Run:

```bash
cd apps/dsa-web
npm run lint
npm run build
```

Expected: ESLint and TypeScript/Vite build exit with code 0.

- [ ] **Step 6: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; no backend, API, Schema, workflow, Docker or desktop files changed.
