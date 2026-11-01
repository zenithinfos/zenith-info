import { eq } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { payments } from "@/db/schema";
import { currencyFor, getPlan, priceFor } from "./plans";
import type { PaymentProvider, PaymentStatus } from "./plans";

/**
 * Paiements : PayPal (international) et Mobile Money (Gabon).
 * PAYMENT_MODE=simulation (défaut) valide les paiements localement ;
 * PAYMENT_MODE=live appelle réellement les prestataires.
 */

export interface PaymentRow {
  id: string;
  reference: string;
  provider: PaymentProvider;
  planId: string;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  email: string | null;
  phone: string | null;
  providerRef: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

const memory = new Map<string, PaymentRow>();

export function paymentMode(): "simulation" | "live" {
  return process.env.PAYMENT_MODE === "live" ? "live" : "simulation";
}

/** Référence publique lisible : MK-8F3A2C. */
export function newReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `MK-${out}`;
}

function fromDb(row: typeof payments.$inferSelect): PaymentRow {
  return {
    ...row,
    provider: row.provider as PaymentProvider,
    status: row.status as PaymentStatus,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
  };
}

export interface CreatePaymentInput {
  planId: string;
  provider: PaymentProvider;
  email?: string | null;
  phone?: string | null;
  metadata?: Record<string, unknown>;
}

export async function createPayment(
  input: CreatePaymentInput,
): Promise<PaymentRow> {
  const plan = getPlan(input.planId);
  if (!plan) throw new Error(`Formule inconnue : ${input.planId}`);

  const reference = newReference();
  const amountCents = priceFor(plan, input.provider);
  const currency = currencyFor(plan, input.provider);

  if (!db || !hasDatabase()) {
    const row: PaymentRow = {
      id: crypto.randomUUID(),
      reference,
      provider: input.provider,
      planId: plan.id,
      amountCents,
      currency,
      status: "pending",
      email: input.email ?? null,
      phone: input.phone ?? null,
      providerRef: null,
      metadata: input.metadata ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memory.set(reference, row);
    return row;
  }

  const [row] = await db
    .insert(payments)
    .values({
      reference,
      provider: input.provider,
      planId: plan.id,
      amountCents,
      currency,
      status: "pending",
      email: input.email ?? null,
      phone: input.phone ?? null,
      metadata: input.metadata ?? null,
    })
    .returning();
  return fromDb(row);
}

export async function getPayment(reference: string): Promise<PaymentRow | null> {
  if (!db || !hasDatabase()) return memory.get(reference) ?? null;
  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.reference, reference))
    .limit(1);
  return rows[0] ? fromDb(rows[0]) : null;
}

export async function updatePayment(
  reference: string,
  patch: {
    status?: PaymentStatus;
    providerRef?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<PaymentRow | null> {
  const now = new Date();

  if (!db || !hasDatabase()) {
    const row = memory.get(reference);
    if (!row) return null;
    const next: PaymentRow = {
      ...row,
      status: patch.status ?? row.status,
      providerRef:
        patch.providerRef === undefined ? row.providerRef : patch.providerRef,
      metadata: patch.metadata ?? row.metadata,
      updatedAt: now,
    };
    memory.set(reference, next);
    return next;
  }

  const [row] = await db
    .update(payments)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.providerRef !== undefined
        ? { providerRef: patch.providerRef }
        : {}),
      ...(patch.metadata ? { metadata: patch.metadata } : {}),
      updatedAt: now,
    })
    .where(eq(payments.reference, reference))
    .returning();
  return row ? fromDb(row) : null;
}

export async function findPaymentByProviderRef(
  provider: PaymentProvider,
  providerRef: string,
): Promise<PaymentRow | null> {
  if (!db || !hasDatabase()) {
    return (
      [...memory.values()].find(
        (p) => p.provider === provider && p.providerRef === providerRef,
      ) ?? null
    );
  }
  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.providerRef, providerRef))
    .limit(1);
  return rows[0] ? fromDb(rows[0]) : null;
}

export async function paymentStats(): Promise<{
  total: number;
  paid: number;
  pending: number;
  revenueCents: number;
  byProvider: Record<string, number>;
}> {
  const rows: PaymentRow[] = !db || !hasDatabase()
    ? [...memory.values()]
    : (await db.select().from(payments)).map(fromDb);

  const byProvider: Record<string, number> = {};
  let revenueCents = 0;
  for (const row of rows) {
    byProvider[row.provider] = (byProvider[row.provider] ?? 0) + 1;
    if (row.status === "paid" && row.currency === "EUR") {
      revenueCents += row.amountCents;
    }
  }

  return {
    total: rows.length,
    paid: rows.filter((r) => r.status === "paid").length,
    pending: rows.filter((r) => r.status === "pending").length,
    revenueCents,
    byProvider,
  };
}

export {
  PLANS,
  MOBILE_MONEY_XAF,
  getPlan,
  priceFor,
  currencyFor,
  formatPrice,
} from "./plans";
export type { Plan, PaymentProvider, PaymentStatus } from "./plans";
