import React from 'react';
import { cn } from '../../utils/cn';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'gradient' | 'danger' | 'danger-subtle' | 'settings-primary' | 'settings-secondary' | 'action-primary' | 'action-secondary' | 'home-action-ai' | 'home-action-report';
  size?: 'xsm' | 'sm' | 'md' | 'lg' | 'xl';
  isLoading?: boolean;
  /** Custom loading text. */
  loadingText?: string;
  glow?: boolean;
}

const BUTTON_SIZE_STYLES = {
  xsm: 'h-7 rounded-md px-2 text-xs',
  sm: 'h-9 rounded-md px-3 text-sm',
  md: 'h-10 rounded-md px-4 text-sm',
  lg: 'h-11 rounded-md px-5 text-sm',
  xl: 'h-12 rounded-md px-6 text-base',
} as const;

const PRIMARY_STYLES = 'border border-primary bg-primary text-primary-foreground hover:bg-primary/90';
const SECONDARY_STYLES = 'border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80';
const OUTLINE_STYLES = 'border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground';

const BUTTON_VARIANT_STYLES = {
  primary: PRIMARY_STYLES,
  secondary: SECONDARY_STYLES,
  'settings-primary': PRIMARY_STYLES,
  'settings-secondary': OUTLINE_STYLES,
  outline: OUTLINE_STYLES,
  ghost: 'border border-transparent bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
  gradient: PRIMARY_STYLES,
  danger: 'border border-danger bg-danger text-destructive-foreground hover:bg-danger/90',
  'danger-subtle': 'border border-danger/60 bg-danger/10 text-danger hover:bg-danger/15',
  'action-primary': PRIMARY_STYLES,
  'action-secondary': OUTLINE_STYLES,
  'home-action-ai': OUTLINE_STYLES,
  'home-action-report': OUTLINE_STYLES,
} as const;

/**
 * Button component with multiple variants and terminal-inspired styling.
 */
export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  loadingText = '处理中...',
  glow = false,
  className = '',
  disabled,
  type = 'button',
  ...props
}) => {
  const emphasisStyles = glow ? 'ring-1 ring-ring/20' : '';

  return (
    <button
      type={type}
      data-slot="button"
      aria-busy={isLoading || undefined}
      data-variant={variant}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-2 font-medium transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 disabled:transform-none',
        BUTTON_SIZE_STYLES[size],
        BUTTON_VARIANT_STYLES[variant],
        emphasisStyles,
        className,
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="flex items-center justify-center gap-2">
          <svg
            className="h-4 w-4 animate-spin text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          {loadingText}
        </span>
      ) : (
        children
      )}
    </button>
  );
};
