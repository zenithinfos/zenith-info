import { NextResponse } from "next/server";
import { z } from "zod";
import { PLANS, createPayment, priceFor, paymentMode } from "@/lib/payments";
import { GAME_URL } from "@/lib/version";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  planId: z.string().min(1),
  operator: z.enum(["airtel", "moov"]),
  phone: z
    .string()
    .min(6)
    .max(24)
    .regex(/^[+0-9 ()-]+$/, "Numéro invalide"),
});

/**
 * Démarrage d'un paiement Mobile Money (Airtel / Moov).
 * En simulation, renvoie les instructions USSD sans contacter d'opérateur.
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
      { error: "Données invalides", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { planId, operator, phone } = parsed.data;
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) return NextResponse.json({ error: "Formule inconnue" }, { status: 404 });

  const mode = paymentMode();
  const amount = priceFor(plan, operator);

  const payment = await createPayment({
    planId,
    provider: mode === "simulation" ? "simulation" : operator,
    phone,
    metadata: { operator, requestedAt: new Date().toISOString() },
  });

  if (mode === "simulation") {
    return NextResponse.json(
      {
        reference: payment.reference,
        operator,
        amount,
        currency: "XAF",
        simulated: true,
        instructions:
          operator === "airtel"
            ? "Simulation : composez #150# puis validez avec POST /api/pay/confirm."
            : "Simulation : composez *555# puis validez avec POST /api/pay/confirm.",
      },
      { status: 201 },
    );
  }

  const gateway = process.env.MOBILE_MONEY_API_URL?.trim();
  if (!gateway) {
    return NextResponse.json(
      {
        error: "Passerelle Mobile Money non configurée (MOBILE_MONEY_API_URL).",
        reference: payment.reference,
      },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(`${gateway.replace(/\/$/, "")}/collections`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.MOBILE_MONEY_API_KEY ?? ""}`,
      },
      body: JSON.stringify({
        merchant: process.env.MOBILE_MONEY_MERCHANT_ID,
        operator,
        phone,
        amount,
        currency: "XAF",
        reference: payment.reference,
        callback: `${GAME_URL}/api/pay/webhook`,
      }),
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`Passerelle ${response.status}`);
    const data = (await response.json()) as { transactionId?: string };

    return NextResponse.json(
      {
        reference: payment.reference,
        operator,
        amount,
        currency: "XAF",
        transactionId: data.transactionId,
        simulated: false,
        instructions: "Validez la demande reçue sur votre téléphone.",
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Mobile Money indisponible",
        reference: payment.reference,
      },
      { status: 502 },
    );
  }
}

/** Statut d'une transaction Mobile Money. */
export async function GET(request: Request) {
  const reference = new URL(request.url).searchParams.get("reference");
  if (!reference) {
    return NextResponse.json({ error: "reference requise" }, { status: 400 });
  }
  const { getPayment } = await import("@/lib/payments");
  const payment = await getPayment(reference);
  if (!payment) return NextResponse.json({ error: "Référence inconnue" }, { status: 404 });

  return NextResponse.json({
    reference: payment.reference,
    status: payment.status,
    amount: payment.amountCents,
    currency: payment.currency,
    updatedAt: payment.updatedAt,
  });
}
