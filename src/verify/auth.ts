import { createRequire } from "node:module";
import { VerifyError } from "./errors.js";

/** Which SDK a source file uses decides whose google-auth-library the fake client must come from. */
export function detectSdk(source: string): "@google-cloud/vertexai" | "@google/genai" | undefined {
  if (source.includes("@google-cloud/vertexai")) return "@google-cloud/vertexai";
  if (source.includes("@google/genai")) return "@google/genai";
  return undefined;
}

/**
 * A fake OAuth2Client with a pre-filled access token, built from the google-auth-library copy that
 * the file's own SDK uses (the SDKs ship different major versions; mixing them fails).
 */
export function createFakeAuthClient(file: string, source: string): unknown {
  const pkg = detectSdk(source);
  if (!pkg) return undefined;
  try {
    const fromFile = createRequire(file);
    const sdkEntry = fromFile.resolve(pkg);
    const lib = createRequire(sdkEntry)("google-auth-library") as { OAuth2Client: new () => { credentials: unknown } };
    const client = new lib.OAuth2Client();
    client.credentials = { access_token: "fake-token", expiry_date: Date.now() + 3_600_000 };
    return client;
  } catch {
    throw new VerifyError("err.authMissing", { pkg, file });
  }
}
