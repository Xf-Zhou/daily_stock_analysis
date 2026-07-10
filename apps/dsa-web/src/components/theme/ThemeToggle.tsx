import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '../../utils/cn';
import { Tooltip } from '../common/Tooltip';

type ThemeOption = 'light' | 'dark' | 'system';
type ThemeToggleVariant = 'default' | 'nav';

const THEME_OPTIONS: Array<{
  value: ThemeOption;
  label: string;
  icon: typeof Sun;
}> = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
];

function resolveThemeLabel(theme: string | undefined) {
  switch (theme) {
    case 'light':
      return '浅色';
    case 'dark':
      return '深色';
    default:
      return '跟随系统';
  }
}

interface ThemeToggleProps {
  variant?: ThemeToggleVariant;
  collapsed?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  variant = 'default',
  collapsed = false,
}) => {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open]);

  const activeTheme = (theme as ThemeOption | undefined) ?? 'system';
  const visualTheme = resolvedTheme ?? 'dark';
  const TriggerIcon = visualTheme === 'light' ? Sun : Moon;
  const isNavVariant = variant === 'nav';
  const trigger = (
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      data-state={open ? 'open' : 'closed'}
      className={cn(
        isNavVariant
          ? 'group relative flex h-10 w-full select-none items-center gap-3 rounded-md border border-transparent px-3 text-sm text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground'
          : 'inline-flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-accent-foreground',
        isNavVariant && collapsed ? 'justify-center px-2' : ''
      )}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label="切换主题"
    >
      <TriggerIcon className={cn('shrink-0', isNavVariant ? 'h-5 w-5' : 'h-4 w-4')} />
      {isNavVariant ? (
        collapsed ? null : <span className="truncate font-medium">主题</span>
      ) : (
        <span className="hidden sm:inline">{resolveThemeLabel(activeTheme)}</span>
      )}
    </button>
  );

  return (
    <div className="relative" ref={containerRef}>
      {isNavVariant && collapsed ? (
        <Tooltip content={open ? null : '主题'} side="right" className="w-full">
          {trigger}
        </Tooltip>
      ) : trigger}

      {open ? (
        <div
          role="menu"
          aria-label="主题模式"
          className={cn(
            'z-[100] min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md',
            isNavVariant
              ? 'absolute bottom-full left-0 mb-2 w-max min-w-[9rem]'
              : 'absolute right-0 mt-2'
          )}
        >
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
            const isActive = activeTheme === value;
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => {
                  setTheme(value);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  {label}
                </span>
                {isActive ? <Check className="h-4 w-4" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
