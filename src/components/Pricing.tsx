"use client";

import { useMemo, useState } from "react";
import { PLANS, formatPrice, type Plan } from "@/lib/plans";
import { plansFor } from "@/i18n/catalogue";
import { useI18n } from "@/i18n/LocaleProvider";

/**
 * Formules et paiement. En mode simulation, le parcours est complet mais aucun
 * débit n'est effectué ; en mode live, PayPal et Mobile Money sont appelés.
 */

type Provider = "paypal" | "airtel" | "moov";

const PROVIDERS: { id: Provider; label: string; icon: string; note: string }[] = [
  { id: "paypal", label: "PayPal", icon: "🅿️", note: "" },
  { id: "airtel", label: "Airtel Money", icon: "📱", note: "Gabon · XAF" },
  { id: "moov", label: "Moov Money", icon: "📲", note: "Gabon · XAF" },
];

export default function Pricing() {
  const { locale, t } = useI18n();
  const plans = useMemo(() => plansFor(locale), [locale]);
  const [planId, setPlanId] = useState<string>((PLANS[1] ?? PLANS[0]).id);
  const plan: Plan = plans.find((candidate) => candidate.id === planId) ?? plans[0];
  const [provider, setProvider] = useState<Provider>("paypal");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    setReference(null);

    try {
      const response = await fetch("/api/pay/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
          provider,
          email: email || undefined,
          phone: phone || undefined,
        }),
      });

      const data = (await response.json()) as {
        reference?: string;
        approvalUrl?: string;
        simulated?: boolean;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? `${t("pricing.error")} ${response.status}`);
      }

      if (data.approvalUrl) {
        window.location.href = data.approvalUrl;
        return;
      }

      if (data.reference) {
        setReference(data.reference);
        // En simulation, on confirme immédiatement pour démontrer le parcours.
        const confirm = await fetch("/api/pay/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference: data.reference }),
        });
        const confirmed = (await confirm.json()) as { status?: string; error?: string };
        setStatus(
          confirmed.status === "paid"
            ? `${t("pricing.simulated")} ${data.reference}.`
            : `${t("pricing.pending")} ${confirmed.error ?? t("pricing.operator")}`,
        );
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("pricing.unavailable"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
      <div className="space-y-4">
        <div>
          <p className="eyebrow">{t("support.kicker")}</p>
          <h2 className="display mt-1 text-3xl text-ink">{t("pricing.title")}</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">{t("pricing.lede")}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {plans.map((candidate) => {
            const active = candidate.id === plan.id;
            return (
              <button
                key={candidate.id}
                type="button"
                onClick={() => setPlanId(candidate.id)}
                className={`relative rounded-xl border p-4 text-left transition ${
                  active
                    ? "border-amber-glow/70 bg-canopy-800"
                    : "border-mist/12 hover:border-moss-300/50"
                }`}
                aria-pressed={active}
              >
                {candidate.recommended && (
                  <span className="absolute right-3 top-3 rounded-full bg-amber-glow/20 px-2 py-0.5 text-micro uppercase tracking-wider text-amber-glow">
                    {t("pricing.recommended")}
                  </span>
                )}
                <p className="text-sm font-semibold text-ink">{candidate.label}</p>
                <p className="display mt-1 text-2xl text-ink">
                  {formatPrice(candidate.amountCents, candidate.currency)}
                </p>
                <p className="mt-0.5 text-caption text-ink-muted">{candidate.tagline}</p>
                <ul className="mt-2 space-y-1 text-caption text-ink-muted">
                  {candidate.perks.map((perk) => (
                    <li key={perk}>· {perk}</li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>
      </div>

      <form onSubmit={submit} className="panel space-y-3 p-5">
        <div>
          <p className="eyebrow">{t("pricing.payment")}</p>
          <p className="text-sm font-semibold text-ink">
            {plan.label} · {formatPrice(plan.amountCents, plan.currency)}
          </p>
        </div>

        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-caption uppercase tracking-[0.18em] text-ink-muted">
            {t("pricing.provider")}
          </legend>
          {PROVIDERS.map((item) => (
            <label
              key={item.id}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-xs transition ${
                provider === item.id
                  ? "border-moss-300/60 bg-moss-400/10"
                  : "border-mist/12 hover:border-moss-300/40"
              }`}
            >
              <input
                type="radio"
                name="provider"
                value={item.id}
                checked={provider === item.id}
                onChange={() => setProvider(item.id)}
                className="accent-amber-glow"
              />
              <span className="text-base">{item.icon}</span>
              <span className="flex-1">
                <span className="block font-semibold text-ink">{item.label}</span>
                <span className="block text-micro text-ink-muted">
                  {item.id === "paypal" ? t("pricing.provider.card") : item.note}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {provider === "paypal" ? (
          <label className="block text-caption text-ink-muted">
            {t("pricing.email")}
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="vous@exemple.ga"
              className="mt-1 w-full rounded-lg border border-mist/20 bg-canopy-950/60 px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-moss-300 focus:outline-none"
            />
          </label>
        ) : (
          <label className="block text-caption text-ink-muted">
            {t("pricing.phone")}
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+241 06 00 00 00"
              className="mt-1 w-full rounded-lg border border-mist/20 bg-canopy-950/60 px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-moss-300 focus:outline-none"
            />
          </label>
        )}

        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy
            ? t("pricing.processing")
            : `${t("pricing.pay")} ${formatPrice(plan.amountCents, plan.currency)}`}
        </button>

        <p className="text-micro leading-relaxed text-ink-muted">{t("pricing.demo")}</p>

        {status && (
          <p className="rounded-lg border border-moss-300/30 bg-moss-400/10 px-3 py-2 text-caption text-ink">
            {status}
          </p>
        )}
        {reference && (
          <p className="text-micro text-ink-muted">
            {t("pricing.reference")} <strong className="text-ink">{reference}</strong>.
          </p>
        )}
      </form>
    </div>
  );
}
