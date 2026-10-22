import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { History, MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import type { AtlasChat } from "@ordo/core";
import { Badge, Button, ConfirmDialog, Input, Menu, Modal } from "@/components/ui";
import { cls, fmtRelative } from "@/lib/format";
import { useSession } from "@/state/session";
import { ChatView, AtlasMark, modelBadge } from "./Chat";
import { deleteChat, pinChat, renameChat } from "./engine";
import { useAtlasChats, useAtlasRun } from "./hooks";

/** /atlas and /atlas/:chatId – the chat with Atlas. */
export default function AtlasPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const chats = useAtlasChats();
  const chat = useSession((s) => (chatId ? s.vault?.atlasChats.find((c) => c.id === chatId && !c.deletedAt) : undefined));
  const run = useAtlasRun(chatId);
  const [listOpen, setListOpen] = useState(false);
  const [renaming, setRenaming] = useState<AtlasChat | null>(null);
  const [deleting, setDeleting] = useState<AtlasChat | null>(null);
  const missing = !!chatId && !chat;
  const badge = modelBadge(chat, run);

  const list = (
    <ChatList
      chats={chats}
      activeId={chatId}
      onPick={(id) => {
        setListOpen(false);
        navigate(`/atlas/${id}`);
      }}
      onNew={() => {
        setListOpen(false);
        navigate("/atlas");
      }}
      onRename={setRenaming}
      onDelete={setDeleting}
    />
  );

  return (
    <div className="flex h-full min-h-[420px] gap-5">
      <aside className="surface hidden w-64 shrink-0 flex-col overflow-hidden lg:flex">{list}</aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-10 shrink-0 items-center gap-2 pb-2">
          <button type="button" className="rounded-lg p-2 text-(--text-muted) hover:bg-(--surface-2) lg:hidden" onClick={() => setListOpen(true)} aria-label="Verlauf" title="Verlauf">
            <History className="h-5 w-5" />
          </button>
          <AtlasMark size="sm" className="hidden sm:inline-flex" />
          <h1 className="min-w-0 truncate text-[17px] font-semibold tracking-tight">{chat?.title ?? "Atlas"}</h1>
          {badge ? <Badge className="hidden sm:inline-flex">{badge}</Badge> : null}
          <div className="ml-auto flex items-center gap-1">
            {chat ? (
              <Menu
                trigger={
                  <Button variant="ghost" size="icon" aria-label="Gespräch" title="Gespräch">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                }
                items={[
                  { label: "Umbenennen", icon: <Pencil className="h-4 w-4" />, onClick: () => setRenaming(chat) },
                  { label: chat.pinned ? "Nicht mehr anheften" : "Anheften", icon: chat.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />, onClick: () => pinChat(chat.id, !chat.pinned) },
                  { label: "Löschen", icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => setDeleting(chat) },
                ]}
              />
            ) : null}
            <Button variant="outline" size="sm" onClick={() => navigate("/atlas")} disabled={!chatId}>
              <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Neues Gespräch</span>
            </Button>
          </div>
        </header>
        {badge ? <div className="-mt-1 mb-1 sm:hidden"><Badge>{badge}</Badge></div> : null}
        <div className="min-h-0 flex-1">
          {missing ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="text-sm text-(--text-muted)">Dieses Gespräch gibt es nicht mehr.</p>
              <Button className="mt-3" onClick={() => navigate("/atlas")}>Neues Gespräch</Button>
            </div>
          ) : (
            <ChatView key={chatId ?? "new"} chatId={chatId} onChatCreated={(id) => navigate(`/atlas/${id}`, { replace: true })} />
          )}
        </div>
      </section>

      <Modal open={listOpen} onClose={() => setListOpen(false)} title="Gespräche" size="sm">
        <div className="-mx-3 -my-2">{list}</div>
      </Modal>
      <RenameDialog chat={renaming} onClose={() => setRenaming(null)} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        danger
        title="Gespräch löschen?"
        body={`„${deleting?.title ?? ""}“ wird gelöscht. Die Daten, die Atlas darin angelegt oder geändert hat, bleiben.`}
        confirmLabel="Löschen"
        onConfirm={() => {
          if (!deleting) return;
          deleteChat(deleting.id);
          if (deleting.id === chatId) navigate("/atlas", { replace: true });
        }}
      />
    </div>
  );
}

function ChatList({ chats, activeId, onPick, onNew, onRename, onDelete }: { chats: AtlasChat[]; activeId?: string; onPick: (id: string) => void; onNew: () => void; onRename: (c: AtlasChat) => void; onDelete: (c: AtlasChat) => void }) {
  const pinned = chats.filter((c) => c.pinned);
  const rest = chats.filter((c) => !c.pinned);
  const item = (c: AtlasChat) => (
    <div key={c.id} className={cls("group flex items-center gap-1 rounded-xl pr-1 transition-colors", c.id === activeId ? "bg-(--sidebar-active) shadow-[0_1px_2px_rgb(0_0_0/0.06)]" : "hover:bg-(--sidebar-hover)")}>
      <button type="button" onClick={() => onPick(c.id)} className="min-w-0 flex-1 px-3 py-2 text-left">
        <div className={cls("truncate text-[13.5px]", c.id === activeId ? "font-medium" : "")}>{c.title}</div>
        <div className="text-[11.5px] text-(--text-muted)">{fmtRelative(c.updatedAt)}</div>
      </button>
      <Menu
        trigger={
          <button type="button" className="rounded-lg p-1.5 text-(--text-muted) opacity-100 hover:bg-(--surface-2) lg:opacity-0 lg:group-hover:opacity-100" aria-label="Optionen">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        }
        items={[
          { label: "Umbenennen", icon: <Pencil className="h-4 w-4" />, onClick: () => onRename(c) },
          { label: c.pinned ? "Nicht mehr anheften" : "Anheften", icon: c.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />, onClick: () => pinChat(c.id, !c.pinned) },
          { label: "Löschen", icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => onDelete(c) },
        ]}
      />
    </div>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-2">
        <Button className="w-full justify-center" onClick={onNew}>
          <Plus className="h-4 w-4" /> Neues Gespräch
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!chats.length ? <p className="px-3 py-6 text-center text-[13px] text-(--text-muted)">Noch keine Gespräche. Frag Atlas etwas – das Gespräch erscheint dann hier.</p> : null}
        {pinned.length ? (
          <>
            <div className="px-3 pt-2 pb-1 text-[11.5px] font-medium text-(--text-muted)">Angeheftet</div>
            {pinned.map(item)}
          </>
        ) : null}
        {rest.length ? (
          <>
            {pinned.length ? <div className="px-3 pt-3 pb-1 text-[11.5px] font-medium text-(--text-muted)">Verlauf</div> : null}
            {rest.map(item)}
          </>
        ) : null}
      </div>
      <div className="border-t border-(--glass-border) px-4 py-2.5 text-[11.5px] text-(--text-muted)">
        <Link to="/einstellungen/atlas" className="hover:text-(--text)">Atlas-Einstellungen</Link>
      </div>
    </div>
  );
}

function RenameDialog({ chat, onClose }: { chat: AtlasChat | null; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [last, setLast] = useState<string | null>(null);
  if (chat && last !== chat.id) {
    setLast(chat.id);
    setTitle(chat.title);
  }
  const save = () => {
    if (chat && title.trim()) renameChat(chat.id, title);
    setLast(null);
    onClose();
  };
  return (
    <Modal
      open={!!chat}
      onClose={() => { setLast(null); onClose(); }}
      title="Gespräch umbenennen"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => { setLast(null); onClose(); }}>Abbrechen</Button>
          <Button onClick={save} disabled={!title.trim()}>Speichern</Button>
        </>
      }
    >
      <Input value={title} autoFocus onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} maxLength={80} />
    </Modal>
  );
}
