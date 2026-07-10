import type React from 'react';
import { Badge } from '../common';
import { getCategoryDescriptionZh, getCategoryTitleZh } from '../../utils/systemConfigI18n';
import type { SystemConfigCategorySchema, SystemConfigItem } from '../../types/systemConfig';
import { cn } from '../../utils/cn';

interface SettingsCategoryNavProps {
  categories: SystemConfigCategorySchema[];
  itemsByCategory: Record<string, SystemConfigItem[]>;
  activeCategory: string;
  onSelect: (category: string) => void;
}

export const SettingsCategoryNav: React.FC<SettingsCategoryNavProps> = ({
  categories,
  itemsByCategory,
  activeCategory,
  onSelect,
}) => {
  return (
    <nav data-slot="settings-nav" className="h-full rounded-lg border border-border bg-card p-3 shadow-sm" aria-label="配置分类">
      <div className="mb-4">
        <p className="text-sm font-semibold text-foreground">配置分类</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">按模块整理系统设置与认证能力。</p>
      </div>

      <div className="space-y-2.5">
        {categories.map((category) => {
          const isActive = category.category === activeCategory;
          const count = (itemsByCategory[category.category] || []).length;
          const title = getCategoryTitleZh(category.category, category.title);
          const description = getCategoryDescriptionZh(category.category, category.description);

          return (
            <button
              key={category.category}
              type="button"
              className={cn(
                'w-full rounded-md border px-3 py-3 text-left transition-colors duration-200',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-transparent bg-transparent hover:bg-accent',
              )}
              onClick={() => onSelect(category.category)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={cn('text-sm font-medium tracking-tight', isActive ? 'text-primary-foreground' : 'text-foreground')}>
                    {title}
                  </p>
                  {description ? (
                    <p className={cn('mt-1 line-clamp-2 text-xs leading-5', isActive ? 'text-primary-foreground/75' : 'text-muted-foreground')}>{description}</p>
                  ) : null}
                </div>
                <Badge
                  variant={isActive ? 'info' : 'default'}
                  size="sm"
                  className={isActive ? 'border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground' : 'border-border bg-muted text-muted-foreground'}
                >
                  {count}
                </Badge>
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
