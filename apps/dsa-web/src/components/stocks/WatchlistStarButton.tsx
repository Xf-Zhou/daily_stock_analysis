import type React from 'react';
import { Loader2, Star } from 'lucide-react';
import { Tooltip } from '../common';
import { cn } from '../../utils/cn';

type WatchlistStarButtonProps = {
  stockName: string;
  isStarred: boolean;
  disabled: boolean;
  isSaving: boolean;
  size?: 'sm' | 'xsm';
  onClick: () => void;
};

export const WatchlistStarButton: React.FC<WatchlistStarButtonProps> = ({
  stockName,
  isStarred,
  disabled,
  isSaving,
  size = 'sm',
  onClick,
}) => {
  const label = isStarred ? `从自选移除 ${stockName}` : `加入自选 ${stockName}`;
  const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-3.5 w-3.5';
  const buttonSize = size === 'sm' ? 'h-9 w-9 rounded-lg' : 'h-6 w-6 rounded-lg';

  return (
    <Tooltip content={isStarred ? '移出自选' : '加入自选'}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'inline-flex shrink-0 items-center justify-center border transition-all',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan/15',
          'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
          buttonSize,
          isStarred
            ? 'border-warning/30 bg-warning/12 text-warning hover:bg-warning/18'
            : 'border-transparent bg-transparent text-secondary-text hover:bg-hover hover:text-foreground',
        )}
      >
        {isSaving ? (
          <Loader2 className={cn(iconSize, 'animate-spin')} />
        ) : (
          <Star className={iconSize} fill={isStarred ? 'currentColor' : 'none'} />
        )}
      </button>
    </Tooltip>
  );
};
