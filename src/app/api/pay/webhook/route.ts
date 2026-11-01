import { NextResponse } from "next/server";
import { z } from "zod";
import { getPayment, updatePayment } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * Webhook Mobile Money (Airtel / Moov) : la passerelle notifie le résultat
 * d'une collecte. Sécurisé par un jeton partagé (`x-webhook-token`) comparé à
 * MOBILE_MONEY_WEBHOOK_TOKEN.
 */

const BodySchema = z.object({
  reference: z.string().min(3),
  transactionId: z.string().optional(),
  status: z.enum(["SUCCESS", "PENDING", "FAILED", "CANCELLED"]),
  amount: z.number().optional(),
  operator: z.string().optional(),
});

export async function POST(request: Request) {
  const expected = process.env.MOBILE_MONEY_WEBHOOK_TOKEN?.trim();
  if (expected) {
    const token = request.headers.get("x-webhook-token");
    if (token !== expected) {
      return NextResponse.json({ error: "Jeton de webhook invalide" }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Notification invalide", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { reference, transactionId, status, amount } = parsed.data;
  const payment = await getPayment(reference);
  if (!payment) {
    // On répond 200 pour éviter les rejeux infinis de la passerelle.
    return NextResponse.json({ received: true, known: false }, { status: 200 });
  }

  if (amount !== undefined && amount !== payment.amountCents) {
    return NextResponse.json({ received: true, error: "Montant incohérent" }, { status: 200 });
  }

  const mapped =
    status === "SUCCESS" ? "paid" : status === "PENDING" ? "pending" : "failed";

  await updatePayment(reference, {
    status: mapped,
    providerRef: transactionId ?? payment.providerRef,
    metadata: {
      ...(payment.metadata ?? {}),
      webhook: { status, receivedAt: new Date().toISOString() },
    },
  });

  return NextResponse.json({ received: true, reference, status: mapped });
}
