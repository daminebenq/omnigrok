import type { ReactNode } from "react";
import { Icon, type IconName } from "../Icon";

export function PanelShell({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
          <p className="text-sm text-text-tertiary mt-1">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function PrimaryButton({
  onClick,
  icon,
  children,
  type = "button",
  disabled,
}: {
  onClick?: () => void;
  icon?: IconName;
  children: ReactNode;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-accent-purple text-white text-sm font-medium
        hover:bg-accent-purple/85 disabled:opacity-50 disabled:cursor-not-allowed transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60"
    >
      {icon && <Icon name={icon} size={14} />}
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-text-secondary mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-text-tertiary mt-1">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full px-3 py-2 rounded-lg bg-bg-tertiary border border-border-default text-sm text-text-primary " +
  "placeholder-text-tertiary outline-none focus:border-accent-purple/60 " +
  "focus-visible:ring-2 focus-visible:ring-accent-purple/40";

export function EmptyState({ icon, message }: { icon: IconName; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="w-10 h-10 rounded-xl bg-bg-tertiary border border-border-subtle flex items-center justify-center text-text-tertiary">
        <Icon name={icon} size={18} />
      </div>
      <p className="text-sm text-text-tertiary">{message}</p>
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-16 rounded-xl bg-bg-secondary border border-border-subtle motion-safe:animate-pulse" />
      ))}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-accent-red/10 border border-accent-red/30 mb-4">
      <Icon name="warning" size={14} className="text-accent-red mt-0.5 shrink-0" />
      <span className="text-sm text-text-secondary break-words">{message}</span>
    </div>
  );
}

export function DeleteButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="shrink-0 p-1.5 rounded-md text-text-tertiary hover:text-accent-red hover:bg-bg-hover transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple/60"
    >
      <Icon name="trash" size={14} />
    </button>
  );
}
