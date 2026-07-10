import type React from 'react';
import { cn } from '../../utils/cn';

interface CardProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  variant?: 'default' | 'bordered' | 'gradient';
  hoverable?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

/** Shared bordered surface with optional hover styling. */
export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  children,
  className = '',
  style,
  variant = 'default',
  hoverable = false,
  padding = 'md',
}) => {
  const paddingStyles = {
    none: '',
    sm: 'p-4',
    md: 'p-5',
    lg: 'p-6',
  };

  return (
    <div
      style={style}
      data-slot="card"
      data-variant={variant}
      className={cn(
        'rounded-lg border border-border bg-card text-card-foreground shadow-sm',
        hoverable ? 'cursor-pointer transition-colors hover:bg-accent/40' : '',
        paddingStyles[padding],
        className,
      )}
    >
      {(title || subtitle) && (
        <div className="mb-3">
          {subtitle ? <span className="text-xs font-medium text-muted-foreground">{subtitle}</span> : null}
          {title ? <h3 className="mt-1 text-lg font-semibold text-foreground">{title}</h3> : null}
        </div>
      )}
      {children}
    </div>
  );
};
