import React from 'react';
import { cn } from '../../utils/cn';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'history';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  glow?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'border-border bg-muted text-muted-foreground',
  success: 'border-success/20 bg-success/10 text-success',
  warning: 'border-warning/20 bg-warning/10 text-warning',
  danger: 'border-danger/20 bg-danger/10 text-danger',
  info: 'border-border bg-muted text-foreground',
  history: 'border-border bg-muted text-foreground',
};

const glowStyles: Record<BadgeVariant, string> = {
  default: 'ring-border/40',
  success: 'ring-success/30',
  warning: 'ring-warning/30',
  danger: 'ring-danger/30',
  info: 'ring-border/40',
  history: 'ring-border/40',
};

/**
 * Badge component with multiple variants and optional glow styling.
 */
export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'sm',
  glow = false,
  className = '',
  style,
  ...rest
}) => {
  const sizeStyles = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';

  return (
    <span
      {...rest}
      data-slot="badge"
      style={style}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border font-medium',
        sizeStyles,
        variantStyles[variant],
        glow && `ring-1 ${glowStyles[variant]}`,
        className,
      )}
    >
      {children}
    </span>
  );
};
