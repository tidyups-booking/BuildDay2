import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * setQuoNeedsReauth must claim the healthy → needs-reauth transition with a
 * conditional UPDATE so that when the hourly health check and a webhook flag
 * the same company concurrently, exactly one caller sends the owner
 * notification — and clearing the flag re-arms it for the next outage.
 *
 * The db mock emulates Postgres's atomicity: the conditional UPDATE's
 * check-and-set happens in one synchronous step against a shared row store,
 * so concurrent claims can never both succeed — mirroring the row-level
 * guarantee the real query relies on.
 */

type CompanyRow = { id: number; quoNeedsReauth: boolean };

let store: Map<number, CompanyRow>;

vi.mock("@workspace/db", () => {
  const companiesTable = {
    id: { __col: "id" },
    quoNeedsReauth: { __col: "quoNeedsReauth" },
  };
  const db = {
    update: () => ({
      set: (values: { quoNeedsReauth: boolean }) => ({
        where: (cond: { and: Array<{ eq: [{ __col: string }, unknown] }> }) => {
          // Atomic conditional update: check + write in one step.
          const exec = () => {
            const idCond = cond.and.find((c) => c.eq[0].__col === "id")!;
            const flagCond = cond.and.find(
              (c) => c.eq[0].__col === "quoNeedsReauth",
            )!;
            const row = store.get(idCond.eq[1] as number);
            if (!row || row.quoNeedsReauth !== flagCond.eq[1]) return [];
            row.quoNeedsReauth = values.quoNeedsReauth;
            return [{ id: row.id }];
          };
          // Like drizzle, the update is awaitable directly (claim release)
          // or via .returning() (claim attempt).
          return {
            returning: async () => exec(),
            then: (
              resolve: (rows: Array<{ id: number }>) => void,
              _reject?: unknown,
            ) => resolve(exec()),
          };
        },
      }),
    }),
    select: () => {
      throw new Error("not used in these tests");
    },
  };
  return { db, companiesTable, teamMembersTable: {} };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
}));

vi.mock("./quo", () => ({
  QuoError: class QuoError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  listPhoneNumbers: vi.fn(),
}));

vi.mock("./secretBox", () => ({ decryptQuoKey: vi.fn(() => null) }));

const notifyOwnerQuoKeyDead = vi.fn(async (): Promise<string> => "sent");
const notifyOwnerQuoRestored = vi.fn(async (): Promise<string> => "sent");
vi.mock("./ownerNotify", () => ({
  notifyOwnerQuoKeyDead: (...args: unknown[]) =>
    notifyOwnerQuoKeyDead(...(args as [])),
  notifyOwnerQuoRestored: (...args: unknown[]) =>
    notifyOwnerQuoRestored(...(args as [])),
}));

import { setQuoNeedsReauth } from "./company";
import type { Company } from "@workspace/db";

/**
 * Each caller (health check, webhook) holds its own in-memory snapshot of the
 * company row, both still believing the key is healthy — that is exactly the
 * racy situation the conditional update must resolve.
 */
const snapshot = (id: number, quoNeedsReauth = false): Company =>
  ({ id, quoNeedsReauth }) as unknown as Company;

beforeEach(() => {
  store = new Map([[1, { id: 1, quoNeedsReauth: false }]]);
  notifyOwnerQuoKeyDead.mockClear();
  notifyOwnerQuoKeyDead.mockImplementation(async () => "sent");
  notifyOwnerQuoRestored.mockClear();
  notifyOwnerQuoRestored.mockImplementation(async () => "sent");
});

describe("setQuoNeedsReauth", () => {
  it("notifies the owner exactly once when two callers flag the same outage concurrently", async () => {
    const healthCheckView = snapshot(1);
    const webhookView = snapshot(1);
    await Promise.all([
      setQuoNeedsReauth(healthCheckView, true),
      setQuoNeedsReauth(webhookView, true),
    ]);
    expect(notifyOwnerQuoKeyDead).toHaveBeenCalledTimes(1);
    expect(store.get(1)!.quoNeedsReauth).toBe(true);
    // Both callers' snapshots reflect the new state either way.
    expect(healthCheckView.quoNeedsReauth).toBe(true);
    expect(webhookView.quoNeedsReauth).toBe(true);
  });

  it("does not notify again on repeated flagging of an already-dead key", async () => {
    await setQuoNeedsReauth(snapshot(1), true);
    // Later hourly checks see the flag already set in the DB (and often in
    // their own snapshot too — cover both paths).
    await setQuoNeedsReauth(snapshot(1, true), true); // in-memory short-circuit
    await setQuoNeedsReauth(snapshot(1, false), true); // stale snapshot, DB claim fails
    expect(notifyOwnerQuoKeyDead).toHaveBeenCalledTimes(1);
  });

  it("re-arms after the flag is cleared: a second outage notifies again", async () => {
    await setQuoNeedsReauth(snapshot(1), true);
    // Key fixed — flag cleared (restored notification, not a dead-key one).
    await setQuoNeedsReauth(snapshot(1, true), false);
    expect(notifyOwnerQuoKeyDead).toHaveBeenCalledTimes(1);
    expect(notifyOwnerQuoRestored).toHaveBeenCalledTimes(1);
    expect(store.get(1)!.quoNeedsReauth).toBe(false);
    // Key dies a second time.
    await setQuoNeedsReauth(snapshot(1), true);
    expect(notifyOwnerQuoKeyDead).toHaveBeenCalledTimes(2);
  });

  it("notifies the restored text exactly once when clearing the flag", async () => {
    store.get(1)!.quoNeedsReauth = true;
    await setQuoNeedsReauth(snapshot(1, true), false);
    // Repeated clears (in-memory short-circuit and stale-snapshot claim miss)
    // stay silent.
    await setQuoNeedsReauth(snapshot(1, false), false); // in-memory short-circuit
    await setQuoNeedsReauth(snapshot(1, true), false); // stale snapshot, DB claim fails
    expect(notifyOwnerQuoKeyDead).not.toHaveBeenCalled();
    expect(notifyOwnerQuoRestored).toHaveBeenCalledTimes(1);
  });

  it("releases the claim when the dead-key text fails to send, so the next check retries it", async () => {
    notifyOwnerQuoKeyDead.mockImplementationOnce(async () => "failed");
    await setQuoNeedsReauth(snapshot(1), true);
    expect(notifyOwnerQuoKeyDead).toHaveBeenCalledTimes(1);
    // Claim released: flag reverted so a later check re-runs the transition.
    expect(store.get(1)!.quoNeedsReauth).toBe(false);
    // Next hourly check finds the key still dead and retries the text.
    await setQuoNeedsReauth(snapshot(1), true);
    expect(notifyOwnerQuoKeyDead).toHaveBeenCalledTimes(2);
    expect(store.get(1)!.quoNeedsReauth).toBe(true);
  });

  it("releases the claim when the back-online text fails to send, so the next check retries it", async () => {
    store.get(1)!.quoNeedsReauth = true;
    notifyOwnerQuoRestored.mockImplementationOnce(async () => "failed");
    await setQuoNeedsReauth(snapshot(1, true), false);
    expect(notifyOwnerQuoRestored).toHaveBeenCalledTimes(1);
    expect(store.get(1)!.quoNeedsReauth).toBe(true);
    // Next healthy check retries the recovery text.
    await setQuoNeedsReauth(snapshot(1, true), false);
    expect(notifyOwnerQuoRestored).toHaveBeenCalledTimes(2);
    expect(store.get(1)!.quoNeedsReauth).toBe(false);
  });

  it("keeps the claim when the text was skipped for configuration reasons", async () => {
    // e.g. no ring-through number: retrying can't help, and the dashboard
    // flag must stay accurate.
    notifyOwnerQuoKeyDead.mockImplementation(async () => "skipped");
    await setQuoNeedsReauth(snapshot(1), true);
    expect(store.get(1)!.quoNeedsReauth).toBe(true);
    await setQuoNeedsReauth(snapshot(1, false), true); // stale snapshot, claim fails
    expect(notifyOwnerQuoKeyDead).toHaveBeenCalledTimes(1);
  });

  it("never notifies restored on routine healthy → healthy checks", async () => {
    await setQuoNeedsReauth(snapshot(1, false), false);
    await setQuoNeedsReauth(snapshot(1, false), false);
    expect(notifyOwnerQuoRestored).not.toHaveBeenCalled();
    expect(notifyOwnerQuoKeyDead).not.toHaveBeenCalled();
  });
});
