import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Lang } from './messages';
import { MESSAGES } from './messages';

export type { Lang };

const STORAGE_KEY = 'usage-console-lang';

function detect(): Lang {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    // Storage can be blocked; fall through to the browser language.
  }
  return (navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

let currentLang: Lang = detect();

/** For code outside React (API calls, error boundary). */
export function getLang(): Lang {
  return currentLang;
}

export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const template = MESSAGES[lang][key] ?? MESSAGES.zh[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => (name in params ? String(params[name]) : `{${name}}`));
}

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  /** BCP 47 tag for Intl / toLocale* calls. */
  locale: string;
}

const I18nContext = createContext<I18nValue | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(currentLang);

  const setLang = useCallback((next: Lang) => {
    currentLang = next;
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisted; the choice still applies for this session.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = translate(lang, 'app.title');
  }, [lang]);

  const value = useMemo<I18nValue>(() => ({
    lang,
    setLang,
    t: (key, params) => translate(lang, key, params),
    locale: lang === 'zh' ? 'zh-CN' : 'en-US',
  }), [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
