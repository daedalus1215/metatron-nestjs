import { createContext, useState, type ReactNode } from 'react';

type SidebarValue = { open: boolean; toggle: () => void };

export const SidebarContext = createContext<SidebarValue | null>(null);

export const SidebarProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  return (
    <SidebarContext.Provider value={{ open, toggle: () => setOpen(!open) }}>
      {children}
    </SidebarContext.Provider>
  );
};
