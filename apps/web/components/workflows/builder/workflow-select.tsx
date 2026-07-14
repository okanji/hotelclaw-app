"use client";

import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

/**
 * Workflow-builder select — a thin wrapper over the house `NativeSelect`
 * that keeps the builder's taller h-9 metric and this file's historical
 * API (`ariaLabel`, wrapper-level `className`). New code should use
 * `ui/native-select` directly.
 */
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
    <NativeSelect
      aria-label={ariaLabel}
      value={value}
      onChange={onChange}
      disabled={disabled}
      wrapperClassName={cn(disabled && "opacity-60", className)}
      className="h-9"
    >
      {children}
    </NativeSelect>
  );
}
