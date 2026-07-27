import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export interface CommandPaletteCommand {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  shortcut?: string;
  run: () => void;
}

const CommandPaletteContext = createContext<{
  scopedCommands: CommandPaletteCommand[];
  setScopedCommands: (commands: CommandPaletteCommand[]) => void;
}>({
  scopedCommands: [],
  setScopedCommands: () => undefined,
});

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [scopedCommands, setScopedCommands] = useState<CommandPaletteCommand[]>([]);
  return <CommandPaletteContext.Provider value={{ scopedCommands, setScopedCommands }}>{children}</CommandPaletteContext.Provider>;
}

export function useCommandPaletteState() {
  return useContext(CommandPaletteContext);
}

export function useCommandPaletteScope(commands: CommandPaletteCommand[]) {
  const { setScopedCommands } = useCommandPaletteState();
  useEffect(() => {
    setScopedCommands(commands);
    return () => setScopedCommands([]);
  }, [commands, setScopedCommands]);
}
