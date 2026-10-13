import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

export type Lang = 'zh' | 'en';

const current = new AsyncLocalStorage<Lang>();

/** The browser sends its UI language with every call, so messages raised while handling it match the UI. */
export const langMiddleware: RequestHandler = (req, _res, next) => {
  current.run(req.header('x-lang') === 'en' ? 'en' : 'zh', next);
};

/** Picks the message for the language of the request being handled (Chinese outside a request). */
export function L(zh: string, en: string): string {
  return current.getStore() === 'en' ? en : zh;
}
