"use client";

import { useState } from "react";
import { PLANS, formatPrice, type Plan } from "@/lib/plans";

/**
 * Formules et paiement. En mode simulation, le parcours est complet mais aucun
 * débit n'est effectué ; en mode live, PayPal et Mobile Money sont appelés.
 */

type Provider = "paypal" | "airtel" | "moov";

const PROVIDERS: { id: Provider; label: string; icon: string; note: string }[] = [
  { id: "paypal", label: "PayPal", icon: "🅿️", note: "Carte bancaire international" },
  { id: "airtel", label: "Airtel Money", icon: "📱", note: "Gabon · XAF" },
  { id: "moov", label: "Moov Money", icon: "📲", note: "Gabon · XAF" },
];

export default function Pricing() {
  const [plan, setPlan] = useState<Plan>(PLANS[1] ?? PLANS[0]);
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

      if (!response.ok) throw new Error(data.error ?? `Erreur ${response.status}`);

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
            ? `Paiement simulé confirmé. Référence ${data.reference}.`
            : `Paiement en attente : ${confirmed.error ?? "suivez les instructions de votre opérateur."}`,
        );
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Paiement indisponible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
      <div className="space-y-4">
        <div>
          <p className="eyebrow">Soutenir le projet</p>
          <h2 className="display mt-1 text-3xl text-parchment">
            Une forêt qui se joue, une forêt qui se protège.
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-mist/65">
            10 % des recettes « Mécène » sont reversés à des programmes de surveillance de la
            réserve. Paiement par carte (PayPal) ou Mobile Money au Gabon.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {PLANS.map((candidate) => {
            const active = candidate.id === plan.id;
            return (
              <button
                key={candidate.id}
                type="button"
                onClick={() => setPlan(candidate)}
                className={`relative rounded-xl border p-4 text-left transition ${
                  active
                    ? "border-amber-glow/70 bg-canopy-800"
                    : "border-mist/12 hover:border-moss-300/50"
                }`}
                aria-pressed={active}
              >
                {candidate.recommended && (
                  <span className="absolute right-3 top-3 rounded-full bg-amber-glow/20 px-2 py-0.5 text-[0.55rem] uppercase tracking-wider text-amber-glow">
                    conseillé
                  </span>
                )}
                <p className="text-sm font-semibold text-parchment">{candidate.label}</p>
                <p className="display mt-1 text-2xl text-parchment">
                  {formatPrice(candidate.amountCents, candidate.currency)}
                </p>
                <p className="mt-0.5 text-[0.62rem] text-mist/50">{candidate.tagline}</p>
                <ul className="mt-2 space-y-1 text-[0.66rem] text-mist/65">
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
          <p className="eyebrow">Paiement</p>
          <p className="text-sm font-semibold text-parchment">
            {plan.label} · {formatPrice(plan.amountCents, plan.currency)}
          </p>
        </div>

        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-[0.62rem] uppercase tracking-[0.18em] text-mist/45">
            Moyen de paiement
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
                <span className="block font-semibold text-parchment">{item.label}</span>
                <span className="block text-[0.6rem] text-mist/50">{item.note}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {provider === "paypal" ? (
          <label className="block text-[0.65rem] text-mist/60">
            E-mail du reçu
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="vous@exemple.ga"
              className="mt-1 w-full rounded-lg border border-mist/20 bg-canopy-950/60 px-3 py-2 text-sm text-parchment placeholder:text-mist/30 focus:border-moss-300 focus:outline-none"
            />
          </label>
        ) : (
          <label className="block text-[0.65rem] text-mist/60">
            Numéro Mobile Money
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+241 06 00 00 00"
              className="mt-1 w-full rounded-lg border border-mist/20 bg-canopy-950/60 px-3 py-2 text-sm text-parchment placeholder:text-mist/30 focus:border-moss-300 focus:outline-none"
            />
          </label>
        )}

        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? "Traitement…" : `Payer ${formatPrice(plan.amountCents, plan.currency)}`}
        </button>

        <p className="text-[0.6rem] leading-relaxed text-mist/40">
          Mode démonstration : aucun débit réel n&apos;est effectué tant que{" "}
          <code className="rounded bg-canopy-900 px-1">PAYMENT_MODE</code> vaut{" "}
          <code className="rounded bg-canopy-900 px-1">simulation</code>. Écrivez à
          support@zenith-info.example pour toute question.
        </p>

        {status && (
          <p className="rounded-lg border border-moss-300/30 bg-moss-400/10 px-3 py-2 text-[0.7rem] text-parchment">
            {status}
          </p>
        )}
        {reference && (
          <p className="text-[0.6rem] text-mist/45">
            Conservez la référence <strong className="text-parchment">{reference}</strong>.
          </p>
        )}
      </form>
    </div>
  );
}
