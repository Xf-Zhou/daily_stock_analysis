import type React from 'react';
import { useId, useState } from 'react';
import { Lock, Key } from 'lucide-react';
import { cn } from '../../utils/cn';
import { EyeToggleIcon } from './EyeToggleIcon';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  trailingAction?: React.ReactNode;
  /** Enables the built-in password visibility toggle. */
  allowTogglePassword?: boolean;
  /** Controls the leading icon style. */
  iconType?: 'password' | 'key' | 'none';
  /** Allows external visibility state control. */
  passwordVisible?: boolean;
  /** Notifies the parent when visibility changes in controlled mode. */
  onPasswordVisibleChange?: (visible: boolean) => void;
}

export const Input = ({ 
  label, 
  hint, 
  error, 
  className = '', 
  id, 
  trailingAction, 
  allowTogglePassword,
  iconType = 'none',
  passwordVisible,
  onPasswordVisibleChange,
  ...props 
}: InputProps) => {
  const generatedId = useId();
  const inputId = id ?? props.name ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [props['aria-describedby'], errorId ?? hintId].filter(Boolean).join(' ') || undefined;
  const ariaInvalid = props['aria-invalid'] ?? (error ? true : undefined);

  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const isPasswordInput = props.type === 'password';
  const isVisibilityControlled = typeof passwordVisible === 'boolean';
  const visible = isVisibilityControlled ? passwordVisible : isPasswordVisible;
  const effectiveType = isPasswordInput && allowTogglePassword && visible ? 'text' : props.type;

  const renderLeadingIcon = () => {
    if (iconType === 'password') {
      return (
        <Lock
          className="h-4 w-4 text-muted-foreground"
        />
      );
    }
    if (iconType === 'key') {
      return (
        <Key
          className="h-4 w-4 text-muted-foreground"
        />
      );
    }
    return null;
  };

  const leadingIcon = renderLeadingIcon();
  const defaultTrailingAction = isPasswordInput && allowTogglePassword ? (
    <button
      type="button"
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        visible ? 'bg-accent text-foreground' : 'hover:bg-accent hover:text-foreground',
      )}
      onClick={() => {
        const nextVisible = !visible;
        if (!isVisibilityControlled) {
          setIsPasswordVisible(nextVisible);
        }
        onPasswordVisibleChange?.(nextVisible);
      }}
      aria-label={visible ? '隐藏内容' : '显示内容'}
      tabIndex={-1}
    >
      <EyeToggleIcon visible={visible} />
    </button>
  ) : null;

  const finalTrailingAction = trailingAction || defaultTrailingAction;

  return (
    <div className="flex flex-col">
      {label ? (
        <label
          htmlFor={inputId}
          className={cn(
            'mb-2 text-sm font-medium',
            'text-foreground'
          )}
        >
          {label}
        </label>
      ) : null}
      <div className="relative flex items-center">
        {leadingIcon && (
          <div className="absolute left-3.5 z-10 pointer-events-none">
            {leadingIcon}
          </div>
        )}
        <input
          id={inputId}
          data-slot="input"
          aria-describedby={describedBy}
          aria-invalid={ariaInvalid}
          style={props.style}
          className={cn(
            'h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm transition-colors duration-200',
            'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            error ? 'border-danger/30' : '',
            leadingIcon ? 'pl-10' : '',
            finalTrailingAction ? 'pr-12' : '',
            'disabled:cursor-not-allowed disabled:opacity-60',
            className,
          )}
          {...props}
          type={effectiveType}
        />
        {finalTrailingAction ? (
          <div className="absolute inset-y-0 right-2 flex items-center">
            {finalTrailingAction}
          </div>
        ) : null}
      </div>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className={cn(
            'mt-2 text-xs',
            'text-danger'
          )}
        >
          {error}
        </p>
      ) : hint ? (
        <p
          id={hintId}
          className={cn(
            'mt-2 text-xs',
            'text-muted-foreground'
          )}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
};
