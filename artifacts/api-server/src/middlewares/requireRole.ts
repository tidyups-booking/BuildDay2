import type { Request, RequestHandler } from "express";
import { resolveCaller, type Caller, type CallerRole } from "../lib/callerRole";

declare global {
  namespace Express {
    interface Request {
      caller?: Caller;
    }
  }
}

/**
 * Resolve the caller once per request. Handlers and nested middleware share
 * the result rather than each re-querying.
 */
export async function getCaller(req: Request): Promise<Caller> {
  if (!req.caller) {
    req.caller = await resolveCaller(req.userId!);
  }
  return req.caller;
}

/**
 * State which roles a route accepts. Default-deny: a route without this
 * middleware is reachable by any signed-in member of the company, which is
 * only ever correct for things the whole crew may see.
 *
 * Must be mounted after `requireAuth`.
 */
export function requireRole(...allowed: CallerRole[]): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      try {
        const caller = await getCaller(req);
        if (!allowed.includes(caller.role)) {
          res
            .status(403)
            .json({ error: "You don't have access to do that here" });
          return;
        }
        next();
      } catch (err) {
        next(err);
      }
    })();
  };
}
