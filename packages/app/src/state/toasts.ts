import { create } from "zustand";

export interface Toast {
  id: number;
  kind: "success" | "error" | "info" | "warning";
  title: string;
  body?: string;
  timeout?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: Toast[];
  push(t: Omit<Toast, "id">): number;
  dismiss(id: number): void;
}

let counter = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(t) {
    const id = counter++;
    const toast: Toast = { timeout: t.kind === "error" ? 9000 : 4500, ...t, id };
    set({ toasts: [...get().toasts, toast] });
    if (toast.timeout && toast.timeout > 0) setTimeout(() => get().dismiss(id), toast.timeout);
    return id;
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export const toast = {
  success: (title: string, body?: string) => useToasts.getState().push({ kind: "success", title, body }),
  error: (title: string, body?: string) => useToasts.getState().push({ kind: "error", title, body }),
  info: (title: string, body?: string) => useToasts.getState().push({ kind: "info", title, body }),
  warning: (title: string, body?: string) => useToasts.getState().push({ kind: "warning", title, body }),
};
