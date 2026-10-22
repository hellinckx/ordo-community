import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { ArrowUpRight, Plus, X } from "lucide-react";
import { Badge, Kbd } from "@/components/ui";
import { cls } from "@/lib/format";
import { useSession } from "@/state/session";
import { AtlasMark, ChatView, modelBadge } from "./Chat";
import { bindNavigation } from "./engine";
import { useAtlasRun } from "./hooks";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Global quick access to Atlas (shortcut + floating button). Mounted once in the AppShell. */
export function AtlasLauncher() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [chatId, setChatId] = useState<string | undefined>();
  const onAtlasPage = location.pathname === "/atlas" || location.pathname.startsWith("/atlas/");

  // Atlas' open_page tool and the page context need the router – the launcher is the one place that always has it.
  useEffect(() => {
    bindNavigation((to) => navigate(to), location.pathname);
  }, [navigate, location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    // the "Atlas" button in the header opens the quick panel through this event
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("ordo:atlas-open", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("ordo:atlas-open", onOpen);
    };
  }, []);

  // A chat that was deleted elsewhere starts fresh.
  const exists = useSession((s) => !!chatId && !!s.vault?.atlasChats.some((c) => c.id === chatId && !c.deletedAt));
  useEffect(() => {
    if (chatId && !exists) setChatId(undefined);
  }, [chatId, exists]);

  return (
    <>
      {!onAtlasPage && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={`Atlas fragen (${isMac ? "⌘" : "Strg+"}J)`}
          aria-label="Atlas fragen"
          // bottom-left: the bottom-right corner belongs to the hosting badge; on phones it sits above the tab bar
          className="glass-strong fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] left-4 z-30 inline-flex h-13 w-13 items-center justify-center rounded-full shadow-[0_8px_24px_-10px_rgb(0_0_0/0.35)] transition-transform hover:scale-105 active:scale-95 lg:hidden"
        >
          <AtlasMark size="md" />
        </button>
      ) : null}
      {open ? <QuickPanel chatId={chatId} setChatId={setChatId} onClose={() => setOpen(false)} onOpenFull={() => { setOpen(false); navigate(chatId ? `/atlas/${chatId}` : "/atlas"); }} /> : null}
    </>
  );
}

function QuickPanel({ chatId, setChatId, onClose, onOpenFull }: { chatId?: string; setChatId: (id: string | undefined) => void; onClose: () => void; onOpenFull: () => void }) {
  const chat = useSession((s) => (chatId ? s.vault?.atlasChats.find((c) => c.id === chatId) : undefined));
  const run = useAtlasRun(chatId);
  const badge = modelBadge(chat, run);
  const hasMessages = !!chat?.messages.length;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/25 backdrop-blur-[2px] sm:items-start sm:p-4 sm:pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal aria-label="Atlas">
      <div className={cls("glass-strong animate-pop-in flex w-full max-w-2xl flex-col overflow-hidden rounded-t-[22px] shadow-pop sm:rounded-[22px]", hasMessages ? "h-[78dvh] sm:h-[70vh]" : "max-h-[85dvh]")}>
        <header className="flex items-center gap-2 border-b border-(--glass-border) px-4 py-2.5">
          <AtlasMark size="sm" />
          <span className="text-[15px] font-semibold">Atlas</span>
          {badge ? <Badge className="hidden truncate sm:inline-flex">{badge}</Badge> : null}
          <div className="ml-auto flex items-center gap-0.5">
            {hasMessages ? (
              <button type="button" onClick={() => setChatId(undefined)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] text-(--text-muted) hover:bg-(--surface-2) hover:text-(--text)" title="Neues Gespräch">
                <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Neu</span>
              </button>
            ) : null}
            <button type="button" onClick={onOpenFull} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] text-(--text-muted) hover:bg-(--surface-2) hover:text-(--text)" title="In Atlas weiterführen">
              <span className="hidden sm:inline">In Atlas öffnen</span> <ArrowUpRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-(--text-muted) hover:bg-(--surface-2)" aria-label="Schließen">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div className={cls("min-h-0", hasMessages ? "flex-1" : "")}>
          <ChatView key={chatId ?? "new"} chatId={chatId} compact onChatCreated={setChatId} onNavigate={onClose} />
        </div>
        <footer className="hidden items-center justify-between border-t border-(--glass-border) px-4 py-1.5 text-[11px] text-(--text-muted) sm:flex">
          <span>Atlas kann sich irren – prüf wichtige Zahlen.</span>
          <span className="inline-flex items-center gap-1"><Kbd>{isMac ? "⌘" : "Strg"}</Kbd><Kbd>J</Kbd> öffnet und schließt</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
