import type { Booking, Company } from "@workspace/db";
import {
  computeQuoteTotals as computeTotals,
  formatMoney,
  formatRate,
  lineItemTotal,
  type QuoteLineItem,
  type QuotePricing,
  type QuoteRates,
  type QuoteTotals,
} from "@workspace/pricing";

/**
 * Customer-facing quote text.
 *
 * The message is only ever a starting point — the dispatcher sees it and can
 * edit it before it sends, and whatever they actually send is stored on the
 * booking. Keep it short: this goes out as an SMS.
 *
 * The arithmetic itself lives in @workspace/pricing so the dashboard's live
 * preview and this text cannot drift apart.
 */

export { formatMoney, type QuoteTotals };

/** The company's rates and policy, in the shape pricing expects. */
export function companyQuoteRates(company: Company): QuoteRates {
  return {
    rateSolo: company.quoteRateSolo,
    rateTeam: company.quoteRateTeam,
    fuelSurcharge: company.quoteFuelSurcharge,
    taxLabel: company.quoteTaxLabel,
    taxRate: company.quoteTaxRate,
    feesLabel: company.quoteFeesLabel,
    feesRate: company.quoteFeesRate,
    depositAmount: company.quoteDepositAmount,
    depositEmail: company.quoteDepositEmail,
  };
}

/**
 * Derived, never stored: a company that changes its tax rate must not end up
 * with old quotes whose parts no longer add up to their own total.
 */
export function computeQuoteTotals(
  company: Company,
  booking: QuotePricing & Pick<Booking, "service">,
): QuoteTotals {
  return computeTotals(companyQuoteRates(company), booking, booking.service);
}

function customerGreetingName(fullName: string): string {
  const name = fullName.trim();
  // Calls often land with a placeholder name; "Hey there" beats "Hey Unknown".
  if (!name || /^(unknown|caller|customer)$/i.test(name)) return "there";
  return name;
}

export function formatAppointment(when: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
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
      timeZoneName: "short",
      timeZone: "UTC",
    }).format(when);
  }
}

/** "3 x $105.00 = $315.00", or just the total when the quantity is 1. */
function formatLineItem(item: QuoteLineItem): string {
  const total = formatMoney(lineItemTotal(item));
  if (item.quantity === 1) return `${item.name}: ${total}`;
  return `${item.name}: ${item.quantity} x ${formatMoney(item.unitPrice)} = ${total}`;
}

export function buildQuoteMessage(company: Company, booking: Booking): string {
  const totals = computeQuoteTotals(company, booking);
  const items = totals.lineItems;
  const lines: string[] = [];

  lines.push(`Hey ${customerGreetingName(booking.customerName)}!`);
  lines.push(`\u2728Quote From: ${company.name}\u2728`);
  lines.push("");

  if (items.length) {
    for (const item of items) lines.push(formatLineItem(item));
    lines.push("");
  } else {
    lines.push(booking.service);
    lines.push("");
  }

  lines.push(`Subtotal: ${formatMoney(totals.subtotal)}`);
  // A zero rate means the company doesn't charge it — printing "0%" on a
  // customer's quote invites a question nobody wants to answer.
  if (totals.taxRate > 0) {
    lines.push(
      `${totals.taxLabel} (${formatRate(totals.taxRate)}): ${formatMoney(totals.taxAmount)}`,
    );
  }
  if (totals.feesRate > 0) {
    lines.push(
      `${totals.feesLabel} (${formatRate(totals.feesRate)}): ${formatMoney(totals.feesAmount)}`,
    );
  }
  lines.push(`Total: ${formatMoney(totals.total)}`);

  if (totals.deposit > 0) {
    lines.push("");
    const where = totals.depositEmail
      ? ` You can send to: ${totals.depositEmail}`
      : "";
    lines.push(
      `Your deposit amount: ${formatMoney(totals.deposit)}.${where}`,
    );
  }

  lines.push("");
  lines.push(
    `Proposed time: ${formatAppointment(booking.scheduledFor, company.timezone)}`,
  );
  if (booking.customerAddress) {
    lines.push(`Address: ${booking.customerAddress}`);
  }

  if (booking.quoteNotes?.trim()) {
    lines.push("");
    lines.push(booking.quoteNotes.trim());
  }

  lines.push("");
  lines.push("Reply YES to lock this in, or let us know a time that suits you better.");

  return lines.join("\n");
}
