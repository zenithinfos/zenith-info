import { NextResponse } from "next/server";
import { findPaymentByProviderRef, updatePayment } from "@/lib/payments";
import { verifyWebhookHeaders } from "@/lib/paypal";

export const dynamic = "force-dynamic";

interface PayPalEvent {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    status?: string;
    custom_id?: string;
    purchase_units?: {
      custom_id?: string;
      reference_id?: string;
      payments?: { captures?: { id?: string; status?: string }[] };
    }[];
  };
}

const PAID_EVENTS = new Set([
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.CAPTURE.COMPLETED",
  "CHECKOUT.ORDER.COMPLETED",
]);

const FAILED_EVENTS = new Set([
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.REFUNDED",
  "CHECKOUT.ORDER.VOIDED",
]);

/**
 * Webhook PayPal. En production, activez la vérification de signature
 * (PAYPAL_WEBHOOK_ID) ; ici on contrôle les en-têtes de transmission et, si
 * PAYPAL_WEBHOOK_TOKEN est défini, un jeton partagé.
 */
export async function POST(request: Request) {
  const check = verifyWebhookHeaders(request.headers);
  if (!check.ok) {
    return NextResponse.json({ error: check.reason ?? "En-têtes invalides" }, { status: 401 });
  }

  let event: PayPalEvent;
  try {
    event = (await request.json()) as PayPalEvent;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const resource = event.resource ?? {};
  const customId =
    resource.custom_id ??
    resource.purchase_units?.[0]?.custom_id ??
    resource.purchase_units?.[0]?.reference_id;
  const orderId =
    resource.id ?? resource.purchase_units?.[0]?.payments?.captures?.[0]?.id;

  let reference = customId;
  if (!reference && orderId) {
    const found = await findPaymentByProviderRef("paypal", orderId);
    reference = found?.reference;
  }

  if (!reference) {
    return NextResponse.json({ received: true, matched: false }, { status: 200 });
  }

  const eventType = event.event_type ?? "";
  const status = PAID_EVENTS.has(eventType)
    ? "paid"
    : FAILED_EVENTS.has(eventType)
      ? "failed"
      : null;

  if (status) {
    await updatePayment(reference, {
      status,
      providerRef: orderId ?? null,
      metadata: {
        paypalEvent: eventType,
        paypalEventId: event.id,
        receivedAt: new Date().toISOString(),
      },
    });
  }

  return NextResponse.json({
    received: true,
    reference,
    event: eventType,
    applied: Boolean(status),
  });
}

/** PayPal peut vérifier l'URL du webhook avec un GET. */
export async function GET() {
  return NextResponse.json({ webhook: "paypal", ready: true });
}
