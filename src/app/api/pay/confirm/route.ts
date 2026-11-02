import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlan, paymentMode, updatePayment } from "@/lib/payments";
import { getPayment } from "@/lib/payments";
import { captureOrder, getOrder } from "@/lib/paypal";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  reference: z.string().min(3),
  /** Identifiant d'ordre PayPal à capturer (mode live). */
  orderId: z.string().optional(),
});

/**
 * Confirmation d'un paiement.
 * - simulation : marque le paiement comme payé (parcours de démonstration).
 * - live + PayPal : capture l'ordre puis vérifie son statut.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Référence manquante", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const payment = await getPayment(parsed.data.reference);
  if (!payment) {
    return NextResponse.json({ error: "Référence inconnue" }, { status: 404 });
  }
  if (payment.status === "paid") {
    return NextResponse.json({ reference: payment.reference, status: "paid", already: true });
  }

  const plan = getPlan(payment.planId);

  if (paymentMode() === "simulation") {
    const updated = await updatePayment(payment.reference, {
      status: "paid",
      providerRef: `sim_${Date.now()}`,
      metadata: { ...(payment.metadata ?? {}), confirmedAt: new Date().toISOString(), simulated: true },
    });
    return NextResponse.json({
      reference: updated?.reference,
      status: updated?.status,
      plan: plan?.label,
      simulated: true,
    });
  }

  if (payment.provider === "paypal") {
    const orderId = parsed.data.orderId ?? payment.providerRef;
    if (!orderId) {
      return NextResponse.json(
        { error: "orderId PayPal requis pour confirmer ce paiement" },
        { status: 422 },
      );
    }

    try {
      let status = "COMPLETED";
      try {
        const captured = await captureOrder(orderId);
        status = captured.status;
      } catch {
        // Peut déjà être capturé : on relit l'ordre.
        const existing = await getOrder(orderId);
        status = existing.status;
      }

      const paid = status === "COMPLETED" || status === "APPROVED";
      const updated = await updatePayment(payment.reference, {
        status: paid ? "paid" : "failed",
        providerRef: orderId,
        metadata: { ...(payment.metadata ?? {}), paypalStatus: status },
      });

      return NextResponse.json(
        {
          reference: updated?.reference,
          status: updated?.status,
          paypalStatus: status,
          simulated: false,
        },
        { status: paid ? 200 : 402 },
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Capture impossible" },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(
    {
      error:
        "Ce paiement attend la confirmation de l'opérateur Mobile Money. Réessayez via /api/pay/verify.",
      reference: payment.reference,
      status: payment.status,
    },
    { status: 202 },
  );
}
