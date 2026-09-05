import { z } from "zod";

// Every payload here mirrors Backend Schema §4 exactly. Extra/malformed
// fields should reject the event before it ever reaches handler logic
// (step 1.8 of the implementation plan) — hence `.strict()` throughout.

export const schemas = {
  "host:create-room": z.object({}).strict(),

  "viewer:join-room": z
    .object({
      code: z.string().length(9).regex(/^\d{9}$/),
    })
    .strict(),

  "host:accept": z
    .object({
      viewerSocketId: z.string().min(1),
    })
    .strict(),

  "host:reject": z
    .object({
      viewerSocketId: z.string().min(1),
    })
    .strict(),

  "viewer:cancel-request": z.object({}).strict(),

  "signal:offer": z
    .object({
      sdp: z.object({ type: z.string(), sdp: z.string() }),
    })
    .strict(),

  "signal:answer": z
    .object({
      sdp: z.object({ type: z.string(), sdp: z.string() }),
    })
    .strict(),

  "signal:ice-candidate": z
    .object({
      candidate: z.object({
        candidate: z.string(),
        sdpMid: z.string().nullable(),
        sdpMLineIndex: z.number().nullable(),
      }),
    })
    .strict(),

  "session:end": z
    .object({
      reason: z.enum(["user_ended", "host_ended", "timeout", "error"]),
    })
    .strict(),
};

/**
 * Validates `payload` against the schema registered for `eventName`.
 * Returns { ok: true, data } or { ok: false }. Unknown event names are
 * treated as a validation failure — there's no schema, so nothing is trusted.
 */
export function validate(eventName, payload) {
  const schema = schemas[eventName];
  if (!schema) return { ok: false };
  const result = schema.safeParse(payload ?? {});
  if (!result.success) return { ok: false, issues: result.error.issues };
  return { ok: true, data: result.data };
}
