import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface HelpStore {
  open: boolean;
  minimized: boolean;
  currentArticleId: string;
  position: { x: number; y: number };
  search: string;
  openHelp: (articleId?: string) => void;
  closeHelp: () => void;
  toggleMinimize: () => void;
  setArticle: (id: string) => void;
  setPosition: (p: { x: number; y: number }) => void;
  setSearch: (s: string) => void;
  clearSearch: () => void;
}

export const useHelpStore = create<HelpStore>()(
  persist(
    (set) => ({
      open: false,
      minimized: false,
      currentArticleId: "first-time-guide",
      position: { x: 80, y: 80 },
      search: "",
      openHelp: (articleId) =>
        set((s) => ({
          open: true,
          minimized: articleId ? false : s.minimized,
          currentArticleId: articleId ?? s.currentArticleId,
          search: "",
        })),
      closeHelp: () => set({ open: false, search: "" }),
      toggleMinimize: () => set((s) => ({ minimized: !s.minimized })),
      setArticle: (id) => set({ currentArticleId: id }),
      clearSearch: () => set({ search: "" }),
      setPosition: (p) => set({ position: p }),
      setSearch: (s) => set({ search: s }),
    }),
    {
      name: "bathyscan-help-window",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        minimized: s.minimized,
        currentArticleId: s.currentArticleId,
        position: s.position,
      }),
    },
  ),
);
