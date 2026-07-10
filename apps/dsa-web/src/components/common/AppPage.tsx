import type React from 'react';
import { cn } from '../../utils/cn';

interface AppPageProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
}

export const AppPage: React.FC<AppPageProps> = ({ children, className = '', ...props }) => {
  return (
    <main
      {...props}
      className={cn('mx-auto min-h-full w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8', className)}
    >
      {children}
    </main>
  );
};
