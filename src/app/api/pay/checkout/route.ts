import { NextResponse } from "next/server";
import { z } from "zod";
import { PLANS, createPayment, currencyFor, paymentMode, priceFor } from "@/lib/payments";
import { approvalLink, createOrder, paypalConfigured } from "@/lib/paypal";
import { GAME_URL } from "@/lib/version";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  planId: z.string().min(1),
  provider: z.enum(["paypal", "airtel", "moov"]),
  email: z.string().email().optional(),
  phone: z.string().min(6).max(24).optional(),
});

/**
 * Création d'un paiement.
 * - PayPal : crée un ordre et renvoie l'URL d'approbation.
 * - Mobile Money : renvoie une référence et les instructions de l'opérateur.
 * - Mode simulation : renvoie une référence confirmable via /api/pay/confirm.
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

  const { planId, provider, email, phone } = parsed.data;
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) {
    return NextResponse.json(
      { error: "Formule inconnue", available: PLANS.map((p) => p.id) },
      { status: 404 },
    );
  }

  if ((provider === "airtel" || provider === "moov") && !phone) {
    return NextResponse.json(
      { error: "Numéro Mobile Money requis pour ce moyen de paiement" },
      { status: 422 },
    );
  }

  const mode = paymentMode();
  const payment = await createPayment({
    planId,
    provider: mode === "simulation" ? "simulation" : provider,
    email: email ?? null,
    phone: phone ?? null,
    metadata: { requestedProvider: provider, mode },
  });

  const amount = priceFor(plan, provider);
  const currency = currencyFor(plan, provider);

  // ------------------------------------------------------------------
  // PayPal réel
  // ------------------------------------------------------------------
  if (provider === "paypal" && mode === "live") {
    if (!paypalConfigured()) {
      return NextResponse.json(
        {
          error:
            "PayPal n'est pas configuré sur ce serveur (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET).",
          reference: payment.reference,
        },
        { status: 503 },
      );
    }

    try {
      const order = await createOrder({
        reference: payment.reference,
        amountCents: amount,
        currency,
        description: `Minkébé — ${plan.label}`,
        returnUrl: `${GAME_URL}/api/pay/verify?reference=${payment.reference}&status=retour`,
        cancelUrl: `${GAME_URL}/?paiement=annule`,
      });

      return NextResponse.json({
        reference: payment.reference,
        provider,
        amount,
        currency,
        orderId: order.id,
        approvalUrl: approvalLink(order),
        simulated: false,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "PayPal indisponible",
          reference: payment.reference,
        },
        { status: 502 },
      );
    }
  }

  // ------------------------------------------------------------------
  // Mobile Money réel : la passerelle opérateur est appelée plus tard
  // ------------------------------------------------------------------
  if ((provider === "airtel" || provider === "moov") && mode === "live") {
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
          operator: provider,
          amount,
          currency,
          reference: payment.reference,
          phone,
          callback: `${GAME_URL}/api/pay/webhook`,
        }),
        cache: "no-store",
      });

      if (!response.ok) throw new Error(`Passerelle ${response.status}`);
      const data = (await response.json()) as { transactionId?: string; instructions?: string };

      return NextResponse.json({
        reference: payment.reference,
        provider,
        amount,
        currency,
        transactionId: data.transactionId,
        instructions:
          data.instructions ??
          "Validez la demande de paiement reçue sur votre téléphone (code USSD).",
        simulated: false,
      });
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

  // ------------------------------------------------------------------
  // Simulation
  // ------------------------------------------------------------------
  return NextResponse.json({
    reference: payment.reference,
    provider: "simulation",
    requestedProvider: provider,
    amount,
    currency,
    simulated: true,
    instructions:
      provider === "paypal"
        ? "Mode simulation : confirmez avec POST /api/pay/confirm pour valider le parcours."
        : "Mode simulation : aucun débit, validez avec POST /api/pay/confirm.",
  });
}
