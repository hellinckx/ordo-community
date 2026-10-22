import { Hammer } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";

/** Temporary page while a module screen is being built. */
export function Placeholder({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />
      <EmptyState icon={<Hammer className="h-8 w-8" />} title="Kommt gleich" body="Dieser Bereich wird gerade gebaut." />
    </div>
  );
}
