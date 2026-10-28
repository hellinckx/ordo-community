import { FileUp } from "lucide-react";
import type { ReactNode } from "react";
import { cls } from "@/lib/format";

/** A persistent affordance, visible before the person starts dragging a file. */
export function FileDropHint({ children = "Dateien hierher ziehen oder auswählen", onChoose, disabled, className }: {
  children?: ReactNode; onChoose: () => void; disabled?: boolean; className?: string;
}) {
  return <button type="button" onClick={onChoose} disabled={disabled} className={cls("flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-(--border) px-3 py-3 text-left text-sm text-(--text-muted) transition-colors hover:border-brand-500 hover:bg-(--surface-2) hover:text-(--text) focus-visible:focus-ring disabled:opacity-60", className)}>
    <FileUp className="h-5 w-5 shrink-0" aria-hidden="true" /><span>{children}</span>
  </button>;
}
