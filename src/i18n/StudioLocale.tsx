import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_STUDIO_LOCALE,
  isStudioLocale,
  STUDIO_LOCALES,
  STUDIO_LOCALE_STORAGE_KEY,
  translateStudioCommand,
  translateStudioMessage,
  type StudioLocale,
  type StudioMessageKey,
} from "./catalog";

interface StudioLocaleContextValue {
  locale: StudioLocale;
  setLocale: (locale: StudioLocale) => void;
  t: (key: StudioMessageKey, values?: Readonly<Record<string, string | number>>) => string;
  commandLabel: (commandId: string, fallback: string) => string;
}

const StudioLocaleContext = createContext<StudioLocaleContextValue | undefined>(undefined);

function storedLocale(): StudioLocale {
  try {
    const value = window.localStorage.getItem(STUDIO_LOCALE_STORAGE_KEY);
    return isStudioLocale(value) ? value : DEFAULT_STUDIO_LOCALE;
  } catch {
    return DEFAULT_STUDIO_LOCALE;
  }
}

export function StudioLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<StudioLocale>(storedLocale);
  const setLocale = useCallback((next: StudioLocale) => setLocaleState(next), []);

  useEffect(() => {
    document.documentElement.lang = STUDIO_LOCALES.find((candidate) => candidate.id === locale)?.htmlLang ?? locale;
    try {
      window.localStorage.setItem(STUDIO_LOCALE_STORAGE_KEY, locale);
    } catch {
      // Language remains active for this session when storage is unavailable.
    }
  }, [locale]);

  const value = useMemo<StudioLocaleContextValue>(() => ({
    locale,
    setLocale,
    t: (key, values) => translateStudioMessage(locale, key, values),
    commandLabel: (commandId, fallback) => translateStudioCommand(locale, commandId, fallback),
  }), [locale, setLocale]);

  return <StudioLocaleContext.Provider value={value}>{children}</StudioLocaleContext.Provider>;
}

export function useStudioLocale(): StudioLocaleContextValue {
  const value = useContext(StudioLocaleContext);
  if (!value) throw new Error("useStudioLocale must be used within StudioLocaleProvider.");
  return value;
}
