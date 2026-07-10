import type React from 'react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/cn';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: TooltipSide;
  focusable?: boolean;
  className?: string;
  contentClassName?: string;
}

type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

type TooltipStyle = {
  top: number;
  left: number;
};

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  side = 'top',
  focusable = false,
  className = '',
  contentClassName = '',
}) => {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const [resolvedSide, setResolvedSide] = useState<TooltipSide>(side);
  const [style, setStyle] = useState<TooltipStyle>({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gap = 10;
    const margin = 8;

    const getPosition = (positionSide: TooltipSide) => {
      if (positionSide === 'left' || positionSide === 'right') {
        return {
          top: triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2,
          left: positionSide === 'left'
            ? triggerRect.left - tooltipRect.width - gap
            : triggerRect.right + gap,
        };
      }

      return {
        top: positionSide === 'top'
          ? triggerRect.top - tooltipRect.height - gap
          : triggerRect.bottom + gap,
        left: triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2,
      };
    };

    let nextSide = side;
    let { top, left } = getPosition(nextSide);

    if (side === 'top' && top < margin) {
      nextSide = 'bottom';
    } else if (side === 'bottom' && top + tooltipRect.height > viewportHeight - margin) {
      nextSide = 'top';
    } else if (side === 'left' && left < margin) {
      nextSide = 'right';
    } else if (side === 'right' && left + tooltipRect.width > viewportWidth - margin) {
      nextSide = 'left';
    }

    if (nextSide !== side) {
      ({ top, left } = getPosition(nextSide));
    }

    left = Math.max(margin, Math.min(left, viewportWidth - tooltipRect.width - margin));
    top = Math.max(margin, Math.min(top, viewportHeight - tooltipRect.height - margin));

    setResolvedSide(nextSide);
    setStyle({ top, left });
  }, [side]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      updatePosition();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [open, content, updatePosition]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleViewportChange = () => updatePosition();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, updatePosition]);

  if (!content) {
    return <>{children}</>;
  }

  return (
    <>
      <span
        ref={triggerRef}
        className={cn('inline-flex', className)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        tabIndex={focusable ? 0 : undefined}
        aria-describedby={open ? tooltipId : undefined}
      >
        {children}
      </span>

      {typeof document !== 'undefined' && open
        ? createPortal(
            <span
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              style={{
                position: 'fixed',
                top: style.top,
                left: style.left,
              }}
              className={cn(
                'pointer-events-none z-[120] min-w-max max-w-[18rem] rounded-xl border border-border/70 bg-elevated/95 px-3 py-1.5 text-xs leading-5 text-foreground shadow-[0_16px_40px_rgba(3,8,20,0.18)] backdrop-blur-xl',
                resolvedSide === 'top' && 'origin-bottom',
                resolvedSide === 'bottom' && 'origin-top',
                resolvedSide === 'left' && 'origin-right',
                resolvedSide === 'right' && 'origin-left',
                contentClassName,
              )}
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </>
  );
};
