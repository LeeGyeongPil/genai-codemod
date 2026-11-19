import type { MessageKey, Vars } from "../i18n.js";

/** A problem the user can fix; carries a message key so it prints in the selected language. */
export class VerifyError extends Error {
  constructor(
    readonly key: MessageKey,
    readonly vars: Vars = {},
  ) {
    super(key);
    this.name = "VerifyError";
  }
}
