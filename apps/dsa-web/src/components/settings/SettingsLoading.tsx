import type React from 'react';

export const SettingsLoading: React.FC = () => {
  return (
    <div className="space-y-4 animate-fade-in">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="settings-skeleton-strong h-3 w-32 rounded" />
          <div className="settings-skeleton-soft mt-3 h-10 rounded-lg" />
        </div>
      ))}
    </div>
  );
};
