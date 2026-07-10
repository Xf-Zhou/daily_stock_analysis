import type React from 'react';
import { cn } from '../../utils/cn';

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  eyebrow,
  title,
  description,
  actions,
  className = '',
}) => {
  return (
    <header data-slot="page-header" className={cn('flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between', className)}>
      <div className="min-w-0 flex-1">
        {eyebrow ? <span className="text-xs font-medium text-muted-foreground">{eyebrow}</span> : null}
        <h1 className={cn('text-2xl font-semibold tracking-tight text-foreground md:text-3xl', eyebrow ? 'mt-1' : '')}>{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
};
