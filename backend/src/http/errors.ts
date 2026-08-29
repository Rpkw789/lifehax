import type { Context } from "hono";

/** The statuses this API actually returns. Keeps the error shape honest. */
export type ErrorStatus = 400 | 404 | 409 | 422 | 500;

/** Errors are JSON with the class carried by the status. Never a 200 with an error body. */
export function jsonError(
  c: Context,
  status: ErrorStatus,
  code: string,
  message: string,
  details?: unknown,
) {
  return c.json({ error: { code, message, ...(details ? { details } : {}) } }, status);
}
