import { useState } from "react";
import { useNavigate } from "react-router";
import { Plus } from "lucide-react";
import { useProfile } from "@/state/hooks";
import { useInstalledModules } from "@/modules/registry";
import { cls } from "@/lib/format";
import { Button } from "@/components/ui";

/** "+ Neu": create anything the installed modules offer (project, time entry, offer, product …). */
export function QuickCreate({ wide }: { wide?: boolean }) {
  const modules = useInstalledModules();
  const profile = useProfile();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const actions = modules.flatMap((m) => (m.quickActions ?? []).filter((a) => !a.modes || a.modes.includes(profile.mode)));
  if (!actions.length) return null;
  return (
    <div className={cls("relative", wide && "flex-1")}>
      <Button variant={wide ? "primary" : "outline"} size={wide ? "md" : "icon"} className={cls(wide ? "w-full justify-center" : "h-10 w-10 rounded-xl")} onClick={() => setOpen((o) => !o)} aria-label="Neu anlegen" title="Neu anlegen">
        <Plus className="h-4 w-4" />
        {wide ? "Neu" : null}
      </Button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="glass-strong animate-pop-in absolute left-0 z-40 mt-2 w-60 overflow-hidden rounded-2xl p-1.5 shadow-pop">
            {actions.map((a) => {
              const Icon = a.icon;
              return (
                <button key={a.to} type="button" onClick={() => { setOpen(false); navigate(a.to); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-(--sidebar-hover)">
                  <Icon className="h-4 w-4 text-(--text-muted)" />
                  {a.label}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
