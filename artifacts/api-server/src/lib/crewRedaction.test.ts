import { describe, it, expect } from "vitest";
import { redactForCrew, HIDDEN } from "./crewRedaction";

describe("redactForCrew", () => {
  it("masks a phone number in a quote message", () => {
    expect(redactForCrew("Quote texted to Jane Doe at +15551234567.")).toBe(
      `Quote texted to Jane Doe at ${HIDDEN}.`,
    );
  });

  it("masks phone numbers written with brackets and dashes", () => {
    expect(redactForCrew("Call from (555) 123-4567.")).toBe(
      `Call from ${HIDDEN}.`,
    );
    expect(redactForCrew("Call from 555-123-4567.")).toBe(
      `Call from ${HIDDEN}.`,
    );
  });

  it("masks dollar amounts", () => {
    expect(redactForCrew("Jane Doe paid $150.00 toward Deep Clean.")).toBe(
      `Jane Doe paid ${HIDDEN} toward Deep Clean.`,
    );
    expect(redactForCrew("Deposit of $1,250 received.")).toBe(
      `Deposit of ${HIDDEN} received.`,
    );
  });

  it("masks both in one message", () => {
    expect(
      redactForCrew("Texted Jane at +1 555 123 4567 about the $80 deposit."),
    ).toBe(`Texted Jane at ${HIDDEN} about the ${HIDDEN} deposit.`);
  });

  it("leaves the customer name and service alone", () => {
    const message = "Booking added by hand for Jane Doe — Deep Clean.";
    expect(redactForCrew(message)).toBe(message);
  });

  // The phone pattern is loose on purpose; these are the short digit runs it
  // must not swallow.
  it("leaves dates, times and short numbers intact", () => {
    for (const message of [
      "Rescheduled to 2026-08-06.",
      "New time texted to Jane Doe: Wed, Aug 12, 2:00 PM.",
      "Sona captured a 3 bed, 2 bath request.",
      "Jobber sync failed: HTTP 502 after 3 attempts.",
    ]) {
      expect(redactForCrew(message)).toBe(message);
    }
  });

  it("is a no-op on a message with nothing sensitive", () => {
    expect(redactForCrew("Jane Doe approved their quote.")).toBe(
      "Jane Doe approved their quote.",
    );
  });
});
