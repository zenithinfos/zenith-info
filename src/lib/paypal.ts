/**
 * Client PayPal REST minimal (Orders v2).
 * Aucune dépendance : fetch natif + OAuth client_credentials.
 *
 * Variables d'environnement :
 *   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV=sandbox|live
 */

type Env = "sandbox" | "live";

const BASES: Record<Env, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

export interface PayPalOrder {
  id: string;
  status: string;
  links?: { href: string; rel: string; method?: string }[];
}

export function paypalConfigured(): boolean {
  return Boolean(
    process.env.PAYPAL_CLIENT_ID?.trim() &&
      process.env.PAYPAL_CLIENT_SECRET?.trim(),
  );
}

function env(): Env {
  return process.env.PAYPAL_ENV === "live" ? "live" : "sandbox";
}

export function baseUrl(): string {
  return BASES[env()];
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }
  if (!paypalConfigured()) {
    throw new Error(
      "PayPal non configuré : renseignez PAYPAL_CLIENT_ID et PAYPAL_CLIENT_SECRET.",
    );
  }

  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
  ).toString("base64");

  const response = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`PayPal OAuth ${response.status} : ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    value: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };
  return cachedToken.value;
}

async function call<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const token = await accessToken();
  const { json, ...rest } = init;
  const response = await fetch(`${baseUrl()}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    body: json === undefined ? init.body : JSON.stringify(json),
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`PayPal ${path} ${response.status} : ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export interface CreateOrderInput {
  reference: string;
  amountCents: number;
  currency: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
}

export async function createOrder(input: CreateOrderInput): Promise<PayPalOrder> {
  return call<PayPalOrder>("/v2/checkout/orders", {
    method: "POST",
    headers: { "PayPal-Request-Id": input.reference },
    json: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.reference,
          custom_id: input.reference,
          description: input.description.slice(0, 127),
          amount: {
            currency_code: input.currency,
            value: (input.amountCents / 100).toFixed(2),
          },
        },
      ],
      application_context: {
        brand_name: "Minkébé",
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    },
  });
}

export async function captureOrder(orderId: string): Promise<PayPalOrder> {
  return call<PayPalOrder>(`/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: { "PayPal-Request-Id": `capture-${orderId}` },
    json: {},
  });
}

export async function getOrder(orderId: string): Promise<PayPalOrder> {
  return call<PayPalOrder>(`/v2/checkout/orders/${orderId}`);
}

export function approvalLink(order: PayPalOrder): string | null {
  return order.links?.find((l) => l.rel === "approve")?.href ?? null;
}

/**
 * Vérification de webhook. En production, utilisez /v1/notifications/verify-webhook-signature
 * avec l'identifiant de webhook créé dans le tableau de bord PayPal.
 * Ici : présence des en-têtes obligatoires + jeton optionnel partagé.
 */
export function verifyWebhookHeaders(headers: Headers): {
  ok: boolean;
  reason?: string;
} {
  const required = [
    "paypal-transmission-id",
    "paypal-transmission-time",
    "paypal-cert-url",
    "paypal-auth-algo",
    "paypal-transmission-sig",
  ];
  for (const key of required) {
    if (!headers.get(key)) return { ok: false, reason: `en-tête manquant : ${key}` };
  }

  const secret = process.env.PAYPAL_WEBHOOK_TOKEN?.trim();
  if (secret) {
    const provided = headers.get("x-webhook-token");
    if (provided !== secret) return { ok: false, reason: "jeton webhook invalide" };
  }
  return { ok: true };
}
