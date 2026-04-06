import type { ReactNode } from "react";

interface Props {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}

export function Card({ title, subtitle, children, className = "", action }: Props) {
  return (
    <div
      className={`bg-bg-card border border-border rounded-lg ${className}`}
    >
      {(title || action) && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
          <div>
            {title && (
              <h3 className="text-sm font-semibold text-text-primary">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>
            )}
          </div>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}
