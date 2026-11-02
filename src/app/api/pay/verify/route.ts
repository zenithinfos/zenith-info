import { NextResponse } from "next/server";
import { getPayment, getPlan } from "@/lib/payments";
import { getOrder } from "@/lib/paypal";

export const dynamic = "force-dynamic";

/**
 * Vérification d'un paiement.
 * Appelée par la page de retour PayPal et par le client après un paiement
 * Mobile Money. Avec `?status=retour` et un orderId, on rafraîchit l'état
 * auprès de PayPal avant de répondre.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const reference = url.searchParams.get("reference");
  const orderId = url.searchParams.get("token") ?? url.searchParams.get("orderId");

  if (!reference) {
    return NextResponse.json({ error: "reference requise" }, { status: 400 });
  }

  const payment = await getPayment(reference);
  if (!payment) {
    return NextResponse.json({ error: "Référence inconnue" }, { status: 404 });
  }

  // Retour depuis PayPal : on interroge PayPal pour connaître l'état réel.
  if (url.searchParams.get("status") === "retour" && orderId && payment.provider === "paypal") {
    try {
      const order = await getOrder(orderId);
      if (order.status === "COMPLETED" && payment.status !== "paid") {
        const { updatePayment } = await import("@/lib/payments");
        await updatePayment(reference, {
          status: "paid",
          providerRef: orderId,
          metadata: { ...(payment.metadata ?? {}), verifiedFrom: "paypal-return" },
        });
        payment.status = "paid";
      }
    } catch {
      /* on répond avec l'état connu */
    }
  }

  const plan = getPlan(payment.planId);

  // Si un navigateur arrive ici en HTML, on redirige vers la page d'accueil.
  const accepts = request.headers.get("accept") ?? "";
  if (accepts.includes("text/html")) {
    return NextResponse.redirect(
      new URL(`/?paiement=${payment.status}&reference=${payment.reference}`, url.origin),
    );
  }

  return NextResponse.json(
    {
      reference: payment.reference,
      status: payment.status,
      plan: plan ? { id: plan.id, label: plan.label } : null,
      amount: payment.amountCents,
      currency: payment.currency,
      provider: payment.provider,
      paidAt: payment.status === "paid" ? payment.updatedAt : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
