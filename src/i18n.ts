import { en } from "./messages/en.js";
import { ko } from "./messages/ko.js";

export type Lang = "en" | "ko";
export type MessageKey = keyof typeof en;

const catalogs: Record<Lang, Record<MessageKey, string>> = { en, ko };

export const ENV_LANG = "GENAI_CODEMOD_LANG";

function fromValue(value: string | undefined): Lang | undefined {
  if (!value) return undefined;
  return value.toLowerCase().startsWith("ko") ? "ko" : "en";
}

/** Precedence: --lang flag > GENAI_CODEMOD_LANG > LC_ALL > LC_MESSAGES > LANG. Anything but ko is English. */
export function resolveLang(flag: string | undefined, env: Record<string, string | undefined>): Lang {
  return (
    fromValue(flag) ??
    fromValue(env[ENV_LANG]) ??
    fromValue(env["LC_ALL"]) ??
    fromValue(env["LC_MESSAGES"]) ??
    fromValue(env["LANG"]) ??
    "en"
  );
}

export function isLangFlag(value: string): value is Lang {
  return value === "en" || value === "ko";
}

export function messageKeys(lang: Lang): string[] {
  return Object.keys(catalogs[lang]).sort();
}

export type Vars = Record<string, string | number>;

export function t(lang: Lang, key: MessageKey, vars: Vars = {}): string {
  const template = catalogs[lang][key];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}
