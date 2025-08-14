"use client";
import React, { useMemo, useState } from "react";

/* -------------------- Types -------------------- */
type Company = {
  id: string;
  name: string;
  apiUrl: string;     // endpoint côté Next (/api/xxx)
  payUrl: string;     // lien officiel pour payer
  enabled: boolean;
  country: string;
  simulatedLatencyMs?: number;
};

type SearchResult =
  | { companyId: string; status: "pending"; checkedAt: string }
  | {
      companyId: string;
      status: "ok" | "none" | "error";
      amountDue?: number;     // en centimes
      currency?: string;      // "EUR"...
      resultUrl?: string;     // <- URL de la page résultat
      payUrl?: string;        // <- URL exacte du bouton Payer
      message?: string;
      checkedAt: string;
    };
/* -------------------- Données -------------------- */
const companiesCatalog: Company[] = [
  {
    id: "fr-sanef",
    name: "SANEF (FR)",
    apiUrl: "/api/sanef",
    payUrl: "https://www.sanef.com/client/index.html?lang=fr#basket",
    enabled: true,
    country: "FR",
    simulatedLatencyMs: 900,
  },
  {
    id: "fr-aliae",
    name: "Aliae / Eiffage (FR)",
    apiUrl: "/api/aliae",
    payUrl: "https://paiement.aliae.com/fr/form/payment",
    enabled: true,
    country: "FR",
    simulatedLatencyMs: 900,
  },
];

const plateFormats: Record<string, RegExp> = {
  FR: /^[A-Z]{2}-?[0-9]{3}-?[A-Z]{2}$/i,
  IT: /^[A-Z]{2}\s?[0-9]{3,4}\s?[A-Z]{2}$/i,
  ES: /^[0-9]{4}\s?[A-Z]{3}$/i,
  DE: /^[A-Z]{1,3}-[A-Z]{1,2}-[0-9]{1,4}$/i,
};

const normalizePlate = (plate: string) =>
  plate.toUpperCase().replace(/\s+/g, "").replace(/--+/g, "-");

function formatMoney(amountCents?: number, currency = "EUR") {
  if (amountCents == null) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountCents / 100);
}

/* --------- Simulation (fallback pour démos) --------- */
function simulateCompanyQuery(company: Company, plate: string): Promise<SearchResult> {
  const latency = company.simulatedLatencyMs ?? 800 + Math.random() * 600;
  return new Promise((resolve) => {
    setTimeout(() => {
      const seed = [...(plate + company.id)].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      const mod = seed % 7;
      const now = new Date().toISOString();
      if (mod === 0) {
        resolve({ companyId: company.id, status: "error", message: "Service indisponible", checkedAt: now });
      } else if (mod <= 2) {
        const amount = mod * 457 + 325;
        resolve({ companyId: company.id, status: "ok", amountDue: amount, currency: "EUR", checkedAt: now });
      } else {
        resolve({ companyId: company.id, status: "none", checkedAt: now });
      }
    }, latency);
  });
}

/* -------------------- App Client -------------------- */
export default function ClientPage() {
  const [plate, setPlate] = useState("");
  const [country, setCountry] = useState("FR");
  const [companies] = useState<Company[]>(companiesCatalog);
  const [results, setResults] = useState<Record<string, SearchResult | undefined>>({});
  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState(0);

  // Modale uniquement pour le cas "ok"
  const [detailFor, setDetailFor] =
    useState<Extract<SearchResult, { status: "ok" }> | null>(null);

  const enabledCompanies = useMemo(() => companies.filter((c) => c.enabled), [companies]);
  const plateValid = useMemo(() => {
    const p = normalizePlate(plate);
    const re = plateFormats[country];
    return re ? re.test(p) : p.length >= 4;
  }, [plate, country]);

  async function handleSearch() {
  const normalized = normalizePlate(plate);
  setIsSearching(true);
  setResults({});
  setProgress(0);

  let completed = 0;
  const total = enabledCompanies.length || 1;

  await Promise.all(
  enabledCompanies.map(async (c) => {
    // statut "pending" immédiat
    setResults(prev => ({
      ...prev,
      [c.id]: { companyId: c.id, status: "pending", checkedAt: new Date().toISOString() },
    }));

    try {
      const normalized = normalizePlate(plate);
      const reqUrl = `${c.apiUrl}?plate=${encodeURIComponent(normalized)}`;
      const r = await fetch(reqUrl, { cache: "no-store" });

      let j: any = undefined;
      try { j = await r.json(); } catch {} // au cas où pas de JSON
      const now = new Date().toISOString();

      // --- SANEF : ok:true => aucun dû (ne jamais marquer "erreur" si HTTP 200 et ok:true)
      if (c.id === "fr-sanef") {
        if (r.ok && j?.ok === true) {
          setResults(prev => ({
            ...prev,
            [c.id]: {
              companyId: c.id,
              status: "none",
              checkedAt: now,
            },
          }));
        } else {
          setResults(prev => ({
            ...prev,
            [c.id]: {
              companyId: c.id,
              status: "error",
              message: j?.error ?? (!r.ok ? `HTTP ${r.status}` : "Réponse inattendue"),
              checkedAt: now,
            },
          }));
        }
        return; // <== IMPORTANT : on ne passe pas au générique
      }

      // --- GÉNÉRIQUE (ALIAE & co)
      if (r.ok && j?.hasDue === true && typeof j?.amountDue === "number") {
        // dû trouvé : on expose les liens pour "Voir détails" et "Payer"
        setResults(prev => ({
          ...prev,
          [c.id]: {
            companyId: c.id,
            status: "ok",
            amountDue: j.amountDue,
            currency: j.currency || "EUR",
            resultUrl: j.resultUrl || undefined,   // "Voir détails"
            payUrl: j.payUrl || c.payUrl,          // "Payer"
            checkedAt: now,
          },
        }));
      } else if (r.ok && (j?.ok === true || j?.hasDue === false)) {
        // aucun dû
        setResults(prev => ({
          ...prev,
          [c.id]: {
            companyId: c.id,
            status: "none",
            checkedAt: now,
          },
        }));
      } else {
        // échec exploitable (message d'erreur de l'API ou code HTTP ≠ 200)
        setResults(prev => ({
          ...prev,
          [c.id]: {
            companyId: c.id,
            status: "error",
            message: j?.error ?? (!r.ok ? `HTTP ${r.status}` : "Réponse inattendue"),
            checkedAt: now,
          },
        }));
      }
    } catch (e: any) {
      setResults(prev => ({
        ...prev,
        [c.id]: {
          companyId: c.id,
          status: "error",
          message: e?.message || "Erreur inconnue",
          checkedAt: new Date().toISOString(),
        },
      }));
    } finally {
      completed += 1;
      setProgress(Math.round((completed / total) * 100));
    }
  })
);


  setIsSearching(false);
}

  const totalDue = useMemo(
    () =>
      Object.values(results).reduce(
        (sum, r) => (r && r.status === "ok" ? sum + (r.amountDue || 0) : sum),
        0
      ),
    [results]
  );

  const StatusBadge = ({ r }: { r?: SearchResult }) => {
    if (!r) return <span className="badge bg-muted">—</span>;
    if (r.status === "pending") return <span className="badge bg-blue-100 text-blue-700">Interrogation…</span>;
    if (r.status === "ok") return <span className="badge bg-emerald-100 text-emerald-700">Dû trouvé</span>;
    if (r.status === "none") return <span className="badge bg-gray-100 text-gray-700">Aucun dû</span>;
    return <span className="badge bg-rose-100 text-rose-700">Erreur</span>;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-black text-white grid place-items-center font-bold">TP</div>
            <div className="font-semibold tracking-tight">Vérification de péages</div>
          </div>
          <div className="text-xs text-gray-500">Interface client</div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Carte de recherche */}
        <section className="rounded-2xl border shadow-sm bg-white/95 p-5 sm:p-6">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <div>
              <label className="text-sm text-gray-700">Pays</label>
              <select
                className="mt-1 w-full border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black/10"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              >
                <option value="FR">France (FR)</option>
                <option value="IT">Italie (IT)</option>
                <option value="ES">Espagne (ES)</option>
                <option value="DE">Allemagne (DE)</option>
              </select>
            </div>

            <div className="md:col-span-4">
              <label className="text-sm text-gray-700">Plaque d'immatriculation</label>
              <input
                className="mt-1 w-full border rounded-xl px-3 py-2 tracking-widest focus:outline-none focus:ring-2 focus:ring-black/10"
                placeholder={country === "FR" ? "AA-123-AA" : country === "ES" ? "1234 ABC" : "Votre plaque"}
                value={plate}
                onChange={(e) => setPlate(e.target.value.toUpperCase())}
              />
              <div className="mt-1 text-xs">
                {!plate ? (
                  <span className="text-gray-400">Saisissez votre plaque</span>
                ) : plateValid ? (
                  <span className="text-green-600 font-medium">Format OK</span>
                ) : (
                  <span className="text-red-600">Format invalide</span>
                )}
              </div>
            </div>

            <div className="flex items-end">
              <button
                className="w-full bg-black text-white rounded-xl px-4 py-2 disabled:opacity-50 hover:bg-black/85 transition"
                onClick={handleSearch}
                disabled={!plateValid || isSearching || enabledCompanies.length === 0}
              >
                {isSearching ? "Recherche..." : "Rechercher"}
              </button>
            </div>
          </div>

          {/* Progress */}
          <div className="mt-5">
            <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
              <div className="h-2 bg-black/80 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="text-xs text-gray-500 mt-1">{progress}%</div>
          </div>
        </section>

        {/* Résultats */}
        <section className="rounded-2xl border shadow-sm bg-white/95 p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Résultats</h2>
            <div className="text-sm text-gray-700">
              Total dû : <span className="font-semibold">{formatMoney(totalDue)}</span>
            </div>
          </div>

          {/* Table desktop / cartes mobile */}
          <div className="hidden md:block overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-3 text-left">Compagnie</th>
                  <th className="p-3 text-left">Statut</th>
                  <th className="p-3 text-left">Montant</th>
                  <th className="p-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {enabledCompanies.map((c) => {
                  const r = results[c.id];
                  return (
                    <tr key={c.id} className="border-t">
                      <td className="p-3">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-gray-500">{c.country}</div>
                      </td>
                      <td className="p-3"><StatusBadge r={r} /></td>
                      <td className="p-3">{r?.status === "ok" ? formatMoney(r.amountDue, r.currency) : "—"}</td>
                      <td className="p-3">
                        {r?.status === "ok" ? (
                          <div className="flex gap-2">
                            {r.resultUrl && (
                              <a
                              className="text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50"
                              href={r.resultUrl}
                              target="_blank"
                              rel="noreferrer"
                              >
                                View details
                                </a>
                              )}
                              {r.payUrl && (
                                <a
                                className="text-sm px-3 py-1.5 rounded-lg bg-black text-white hover:bg-black/85"
                                href={r.payUrl}
                                target="_blank"
                                rel="noreferrer"
                                >
                                  Pay now
                                  </a>
                                )}
                                </div>
                                ) : (
                                <span className="text-gray-400">—</span>
                          )}

                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="grid gap-3 md:hidden">
            {enabledCompanies.map((c) => {
              const r = results[c.id];
              return (
                <div key={c.id} className="rounded-xl border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-gray-500">{c.country}</div>
                    </div>
                    <StatusBadge r={r} />
                  </div>
                  <div className="mt-2 text-sm text-gray-700">
                    Montant : <strong>{r?.status === "ok" ? formatMoney(r.amountDue, r.currency) : "—"}</strong>
                  </div>
                  {r?.status === "ok" && (
                    <div className="mt-3 flex gap-2">
                      <button
                        className="flex-1 text-sm px-3 py-2 rounded-lg border hover:bg-gray-50"
                        onClick={() => setDetailFor(r as Extract<SearchResult, { status: "ok" }>)}
                      >
                        Voir détails
                      </button>
                      <a
                        className="flex-1 text-center text-sm px-3 py-2 rounded-lg bg-black text-white hover:bg-black/85"
                        href={c.payUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Payer
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* Modale détails */}
      {detailFor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4" onClick={() => setDetailFor(null)}>
          <div className="bg-white w-full sm:max-w-md rounded-2xl shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-semibold">Détail du dû</div>
              <button className="text-gray-500 hover:text-gray-700" onClick={() => setDetailFor(null)}>✕</button>
            </div>
            <div className="space-y-2 text-sm">
              <div><span className="text-gray-500">Statut :</span> <strong>{detailFor.status}</strong></div>
              <div><span className="text-gray-500">Montant :</span> <strong>{formatMoney(detailFor.amountDue, detailFor.currency)}</strong></div>
              {detailFor.message && <div className="text-gray-500">{detailFor.message}</div>}
              <div className="text-gray-500">Paiement à effectuer sur la plateforme officielle.</div>
            </div>
            <div className="mt-4 flex justify-end">
              <button className="px-4 py-2 rounded-lg bg-black text-white hover:bg-black/85" onClick={() => setDetailFor(null)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mini styles utilitaires pour badges (facultatif si tu as Tailwind plugins) */}
      <style>{`
        .badge { display:inline-flex; align-items:center; padding:2px 8px; border-radius:9999px; font-size:12px; }
        .bg-muted { background:#f3f4f6; color:#6b7280; }
      `}</style>
    </div>
  );
}
