/**
 * Formules et tarification — module pur, importable côté client.
 * Aucun accès base de données ici : voir lib/payments.ts pour la persistance.
 */

export type PaymentProvider = "paypal" | "airtel" | "moov" | "simulation";
export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export interface Plan {
  id: string;
  label: string;
  tagline: string;
  amountCents: number;
  currency: "EUR" | "XAF";
  perks: string[];
  recommended?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: "expedition",
    label: "Expédition",
    tagline: "Le solo complet, sans limite de temps",
    amountCents: 499,
    currency: "EUR",
    perks: [
      "Forêt de Minkébé intégrale (8 zones)",
      "Faune et gadgets débloqués",
      "3 emplacements de sauvegarde locale",
    ],
  },
  {
    id: "sentinelle",
    label: "Sentinelle",
    tagline: "Multijoueur, sauvegardes cloud et mises à jour",
    amountCents: 999,
    currency: "EUR",
    recommended: true,
    perks: [
      "Tout « Expédition »",
      "Multijoueur jusqu'à 8 joueurs",
      "Sauvegardes cloud PostgreSQL",
      "Accès anticipé aux nouvelles zones",
    ],
  },
  {
    id: "mecene",
    label: "Mécène",
    tagline: "Soutenir la conservation et la recherche",
    amountCents: 2499,
    currency: "EUR",
    perks: [
      "Tout « Sentinelle »",
      "Nom dans les crédits",
      "Part reversée à l'ANPN (10 %)",
      "Carnet de terrain PDF mensuel",
    ],
  },
];

export const MOBILE_MONEY_XAF: Record<"airtel" | "moov", number> = {
  airtel: 3300,
  moov: 3300,
};

export function getPlan(planId: string): Plan | undefined {
  return PLANS.find((p) => p.id === planId);
}

export function priceFor(plan: Plan, provider: PaymentProvider): number {
  if (provider === "airtel" || provider === "moov") {
    // Tarif Mobile Money exprimé en XAF (entier, pas de centimes).
    return Math.round((plan.amountCents / 100) * 660);
  }
  return plan.amountCents;
}

export function currencyFor(
  plan: Plan,
  provider: PaymentProvider,
): "EUR" | "XAF" {
  return provider === "airtel" || provider === "moov" ? "XAF" : plan.currency;
}

export function formatPrice(amountCents: number, currency: string): string {
  if (currency === "XAF") {
    return `${new Intl.NumberFormat("fr-FR").format(amountCents)} FCFA`;
  }
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: currency || "EUR",
  }).format(amountCents / 100);
}
