/**
 * Hiding customer contact details and money from crew.
 *
 * Cleaners see the activity feed, but the app never shows them a customer's
 * phone number or what a job is worth — that stays between the office and the
 * customer. Activity messages are free text written for dispatch, so anything
 * that reads as a phone number or a dollar figure is masked on the way out
 * rather than the messages being rewritten at every call site.
 */

export const HIDDEN = "(hidden)";

/** `$150`, `$1,250.00`, `$ 80.50`. */
const MONEY = /\$\s?\d[\d,]*(?:\.\d+)?/g;

/**
 * A run of digits with the usual phone punctuation: `+15551234567`,
 * `(555) 123-4567`, `555-123-4567`. Deliberately loose, then filtered by digit
 * count below so dates like `2026-08-06` and job numbers survive intact.
 */
const PHONE_SHAPED = /\+?\(?\d[\d\s().-]{7,}\d/g;

/** North American numbers have 10 digits; with a country code, 11. */
const MIN_PHONE_DIGITS = 10;

function digitCount(value: string): number {
  return (value.match(/\d/g) ?? []).length;
}

/**
 * Mask phone numbers and dollar amounts in a message meant for a cleaner.
 * Money first: once it is masked there are no digits left for the phone pass
 * to trip over.
 */
export function redactForCrew(message: string): string {
  return message
    .replace(MONEY, HIDDEN)
    .replace(PHONE_SHAPED, (match) =>
      digitCount(match) >= MIN_PHONE_DIGITS ? HIDDEN : match,
    );
}
