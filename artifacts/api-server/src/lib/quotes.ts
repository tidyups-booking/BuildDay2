import type { Booking, Company } from "@workspace/db";

/**
 * Customer-facing quote text.
 *
 * This is only ever a starting point — the dispatcher sees the message and can
 * edit it before it sends, and whatever they actually send is stored on the
 * booking. Keep it short: this goes out as an SMS.
 */

function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  // Calls often land with a placeholder name; "Hi there" beats "Hi Unknown".
  if (!first || /^(unknown|caller|customer)$/i.test(first)) return "there";
  return first;
}

export function formatMoney(amount: number): string {
  return Number.isInteger(amount)
    ? `$${amount.toFixed(0)}`
    : `$${amount.toFixed(2)}`;
}

export function formatAppointment(when: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(when);
  } catch {
    // An invalid stored zone must not stop a quote going out.
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(when);
  }
}

export function buildQuoteMessage(company: Company, booking: Booking): string {
  const lines: string[] = [];

  lines.push(`Hi ${firstName(booking.customerName)}, thanks for calling ${company.name}!`);
  lines.push("");

  if (booking.quotedAmount != null) {
    lines.push(`Your quote for ${booking.service}: ${formatMoney(booking.quotedAmount)}`);
  } else {
    lines.push(`Here are the details for your ${booking.service}:`);
  }

  if (booking.customerAddress) {
    lines.push(`Address: ${booking.customerAddress}`);
  }
  lines.push(
    `Proposed time: ${formatAppointment(booking.scheduledFor, company.timezone)}`,
  );

  if (booking.quoteNotes?.trim()) {
    lines.push("");
    lines.push(booking.quoteNotes.trim());
  }

  lines.push("");
  lines.push("Reply YES to lock this in, or let us know a time that suits you better.");
  lines.push(`— ${company.name}`);

  return lines.join("\n");
}
