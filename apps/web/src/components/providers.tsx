'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Direction, Tooltip } from 'radix-ui';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api';

type Theme = 'light' | 'dark' | 'system';
const ThemeContext = React.createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({
  theme: 'system',
  setTheme: () => undefined,
});
export const useTheme = () => React.useContext(ThemeContext);

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** Runs before paint (inlined in <head>) to avoid a light flash in dark mode. */
export const themeInitScript = `try{var t=localStorage.getItem('karban-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}`;

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 20_000,
            refetchOnWindowFocus: false,
            retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
          },
        },
      }),
  );
  const [theme, setThemeState] = React.useState<Theme>('system');

  React.useEffect(() => {
    let stored: Theme = 'system';
    try {
      stored = (localStorage.getItem('karban-theme') as Theme) || 'system';
    } catch {
      /* storage unavailable */
    }
    setThemeState(stored);
    applyTheme(stored);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme((localStorage.getItem('karban-theme') as Theme) || 'system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = React.useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem('karban-theme', t);
    } catch {
      /* ignore */
    }
    applyTheme(t);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <QueryClientProvider client={client}>
        <Direction.Provider dir="rtl">
          <Tooltip.Provider>{children}</Tooltip.Provider>
        </Direction.Provider>
        <Toaster
          position="top-center"
          dir="rtl"
          richColors
          closeButton
          toastOptions={{ style: { fontFamily: 'inherit' } }}
        />
      </QueryClientProvider>
    </ThemeContext.Provider>
  );
}
