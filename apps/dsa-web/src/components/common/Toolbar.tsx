import type React from 'react';
import { cn } from '../../utils/cn';

interface ToolbarProps {
  left?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}

export const Toolbar: React.FC<ToolbarProps> = ({ left, right, className = '' }) => {
  return (
    <div data-slot="toolbar" className={cn('flex flex-col gap-3 rounded-lg border border-border bg-card p-3 md:flex-row md:items-center md:justify-between', className)}>
      <div className="flex flex-wrap items-center gap-2">{left}</div>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">{right}</div>
    </div>
  );
};
