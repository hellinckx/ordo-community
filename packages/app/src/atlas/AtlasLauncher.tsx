import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { ArrowUpRight, Loader2, MessageCircleQuestion, Plus, X } from "lucide-react";
import { useAtlasActivity } from "./AtlasActivity";
import { Badge, Button, ConfirmDialog, Kbd } from "@/components/ui";
import { cls } from "@/lib/format";
import { isTauri } from "@/platform";
import { useSession } from "@/state/session";
import { AtlasMark, ChatView, modelBadge } from "./Chat";
import { bindNavigation, deleteChat } from "./engine";
import { useAtlasRun } from "./hooks";
import { NOT_IN_SCREENSHOT } from "./screenshot";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const NUDGE_OFF = "ordo.atlas.nudgeOff";
const nudgeOff = () => {
  try {
    return sessionStorage.getItem(NUDGE_OFF) === "1";
  } catch {
    return false;
  }
};

// On phones above the tab bar; on the web above the hosting badge that the free Netlify plan pins bottom-right.
const CORNER = cls("fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-30 lg:right-6", isTauri ? "lg:bottom-6" : "lg:bottom-[4.5rem]");

/** Atlas on every page: a button bottom-right that offers help, opening a small chat window (also Strg+J). */
export function AtlasLauncher() {
  const active = useAtlasActivity();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [chatId, setChatId] = useState<string | undefined>();
  const [nudge, setNudge] = useState(false);
  const onAtlasPage = location.pathname === "/atlas" || location.pathname.startsWith("/atlas/");

  // Atlas' open_page tool and the page context need the router – the launcher is the one place that always has it.
  useEffect(() => {
    bindNavigation((to) => navigate(to), location.pathname);
  }, [navigate, location.pathname]);

  // On each page Atlas briefly asks whether it can help; closing the question silences it for this session.
  useEffect(() => {
    setNudge(false);
    if (onAtlasPage || nudgeOff()) return;
    const show = setTimeout(() => setNudge(true), 1200);
    const hide = setTimeout(() => setNudge(false), 8000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [location.pathname, onAtlasPage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    // the "Atlas" button in the header opens the window through this event
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

  const openPanel = () => {
    setNudge(false);
    setOpen(true);
  };

  return (
    <>
      {!onAtlasPage && !open ? (
        <div className={CORNER} {...{ [NOT_IN_SCREENSHOT]: "" }}>
          {nudge ? (
            <div role="status" className="animate-pop-in glass-strong absolute right-[calc(100%+0.75rem)] bottom-1 flex w-max max-w-[min(17rem,calc(100vw-6rem))] items-start gap-1 rounded-2xl rounded-br-md py-2 pr-1.5 pl-3.5 shadow-[0_10px_30px_-12px_rgb(0_0_0/0.3)]">
              <button type="button" onClick={openPanel} className="min-w-0 text-left">
                <span className="block text-[14px] font-semibold">Brauchst du Hilfe?</span>
                <span className="block text-[12.5px] leading-snug text-(--text-muted)">Frag Atlas – oder zeig ihm einfach diese Seite.</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setNudge(false);
                  try {
                    sessionStorage.setItem(NUDGE_OFF, "1");
                  } catch {
                    /* then it simply asks again on the next page */
                  }
                }}
                className="rounded-lg p-1 text-(--text-muted) hover:bg-(--surface-2) hover:text-(--text)"
                aria-label="Nicht mehr fragen"
                title="Bis zum nächsten Start nicht mehr fragen"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={openPanel}
            title={`Atlas fragen (${isMac ? "⌘" : "Strg+"}J)`}
            aria-label="Atlas fragen"
            className="glass-strong inline-flex h-13 w-13 items-center justify-center rounded-full shadow-[0_8px_24px_-10px_rgb(0_0_0/0.35)] transition-transform hover:scale-105 active:scale-95"
          >
            {active.some(({ run }) => run.status === "running") ? <Loader2 className="h-6 w-6 animate-spin text-brand-700 motion-reduce:animate-none dark:text-brand-300" aria-label="Atlas arbeitet" /> : active.length ? <MessageCircleQuestion className="h-6 w-6 text-brand-700 dark:text-brand-300" aria-label="Atlas wartet auf dich" /> : <AtlasMark size="md" />}
          </button>
        </div>
      ) : null}
      {open ? <AtlasWindow chatId={chatId} setChatId={setChatId} onClose={() => setOpen(false)} onOpenFull={() => { setOpen(false); navigate(chatId ? `/atlas/${chatId}` : "/atlas"); }} /> : null}
    </>
  );
}

/** The small Atlas window: docked bottom-right next to the page (a sheet on phones), the page stays usable. */
function AtlasWindow({ chatId, setChatId, onClose, onOpenFull }: { chatId?: string; setChatId: (id: string | undefined) => void; onClose: () => void; onOpenFull: () => void }) {
  const chat = useSession((s) => (chatId ? s.vault?.atlasChats.find((c) => c.id === chatId) : undefined));
  const run = useAtlasRun(chatId);
  const badge = modelBadge(chat, run);
  const hasMessages = !!chat?.messages.length;
  // a chat in which Atlas has not answered anything yet: closing it asks whether to delete it
  const unanswered = !!chat && !run?.limit && (!run || run.status === "idle") && !chat.messages.some((m) => m.role === "assistant" && !(m.raw as { local?: boolean } | undefined)?.local);
  const [askDelete, setAskDelete] = useState(false);
  const close = () => (unanswered ? setAskDelete(true) : onClose());
  // on a phone the sheet covers the page, so a link Atlas offers closes it; next to the page it stays open
  const onNavigate = () => {
    if (window.innerWidth < 640) onClose();
  };
  return createPortal(<>
    <div className="fixed inset-0 z-40 bg-slate-950/25 sm:hidden" onMouseDown={close} {...{ [NOT_IN_SCREENSHOT]: "" }} />
    <div
      role="dialog"
      aria-label="Atlas"
      {...{ [NOT_IN_SCREENSHOT]: "" }}
      className="glass-strong animate-pop-in fixed inset-x-0 bottom-0 z-40 flex h-[85dvh] flex-col overflow-hidden rounded-t-[22px] shadow-pop sm:inset-x-auto sm:right-4 sm:bottom-4 sm:h-[min(680px,calc(100dvh-2rem))] sm:w-[420px] sm:rounded-[22px] lg:right-6 lg:bottom-6"
    >
      <header className="flex items-center gap-2 border-b border-(--glass-border) px-4 py-2.5">
        <AtlasMark size="sm" />
        <span className="text-[15px] font-semibold">Atlas</span>
        {badge ? <Badge className="truncate max-sm:hidden">{badge}</Badge> : null}
        <div className="ml-auto flex items-center gap-0.5">
          {hasMessages ? (
            <button type="button" onClick={() => setChatId(undefined)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] text-(--text-muted) hover:bg-(--surface-2) hover:text-(--text)" title="Neues Gespräch">
              <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Neu</span>
            </button>
          ) : null}
          <button type="button" onClick={onOpenFull} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] text-(--text-muted) hover:bg-(--surface-2) hover:text-(--text)" title="In Atlas weiterführen">
            <span className="hidden sm:inline">Groß öffnen</span> <ArrowUpRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={close} className="rounded-lg p-1.5 text-(--text-muted) hover:bg-(--surface-2)" aria-label="Schließen">
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <ChatView key={chatId ?? "new"} chatId={chatId} compact screenshot onChatCreated={setChatId} onNavigate={onNavigate} />
      </div>
      <footer className="hidden items-center justify-between border-t border-(--glass-border) px-4 py-1.5 text-[11px] text-(--text-muted) sm:flex">
        <span>Atlas kann sich irren – prüf wichtige Zahlen.</span>
        <span className="inline-flex items-center gap-1"><Kbd>{isMac ? "⌘" : "Strg"}</Kbd><Kbd>J</Kbd></span>
      </footer>
    </div>
    <ConfirmDialog
      open={askDelete}
      onClose={() => setAskDelete(false)}
      danger
      title="Leeres Gespräch löschen?"
      body={`Atlas hat in „${chat?.title ?? ""}“ noch nichts geantwortet. Soll das Gespräch gelöscht werden?`}
      confirmLabel="Löschen"
      extra={<Button variant="outline" onClick={() => { setAskDelete(false); onClose(); }}>Behalten</Button>}
      onConfirm={() => {
        if (chat) deleteChat(chat.id);
        setChatId(undefined);
        onClose();
      }}
    />
    </>,
    document.body,
  );
}
