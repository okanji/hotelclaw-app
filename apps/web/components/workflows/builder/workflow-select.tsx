"use client";

import { cn } from "@/lib/utils";

/** Native select with a centered chevron (browser default arrows misalign with custom height). */
export function WorkflowSelect({
  ariaLabel,
  value,
  onChange,
  disabled,
  className,
  children,
}: {
  ariaLabel: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "inline-grid h-9 w-full grid-cols-[1fr_--spacing(7)] items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring",
        disabled && "opacity-60",
        className,
      )}
    >
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="col-span-full row-start-1 appearance-none truncate bg-transparent py-2 pr-7 pl-3 text-sm text-foreground focus:outline-none"
      >
        {children}
      </select>
      <svg
        viewBox="0 0 8 5"
        width="9"
        height="6"
        fill="none"
        aria-hidden
        className="pointer-events-none col-start-2 row-start-1 place-self-center text-muted-foreground"
      >
        <path d="M.5.5 4 4 7.5.5" stroke="currentColor" strokeWidth="1" />
      </svg>
    </div>
  );
}
