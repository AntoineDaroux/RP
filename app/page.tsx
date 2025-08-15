"use client";
import React, { useMemo, useState } from "react";

/* -------------------- Types -------------------- */
type Company = {
  id: string;
  name: string;
  apiUrl: string;
  payUrl: string;
  enabled: boolean;
  country: string;
  simulatedLatencyMs?: number;
};

type DebugInfo = {
  httpStatus: number;
  durationMs: number;
  requestUrl: string;
  message?: string;
  screenshots?: { before?: string; after?: string; error?: string };
  raw?: any;
};

type SearchResult =
  | { companyId: string; status: "pending"; checkedAt: string; debug?: DebugInfo }
  | {
      companyId: string;
      status: "ok" | "none" | "error";
      amountDue?: number;
      currency?: string;
      resultUrl?: string;
      payUrl?: string;
      message?: string;
      checkedAt: string;
      debug?: DebugInfo;
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

/* --------- Simulation de secours --------- */
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

/* -------------------- App Dev -------------------- */
export default function DevPage() {
  const [plate, setPlate] = useState("");
  const [country, setCountry] = useState("FR");
  const [companies, setCompanies] = useState<Company[]>(companiesCatalog);
  const [results, setResults] = useState<Record<string, SearchResult | undefined>>({});
  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState(0);
  const [snapToView, setSnapToView] = useState<string | null>(null);

  const enabledCompanies = useMemo(() => companies.filter((c) => c.enabled), [companies]);
  const plateValid = useMemo(() => {
    const p = normalizePlate(plate);
    const re = plateFormats[country];
    return re ? re.test(p) : p.length >= 4;
  }, [plate, country]);

  function toggleCompany(id: string, enabled: boolean) {
    setCompanies((prev) => prev.map((c) => (c.id === id ? { ...c, enabled } : c)));
  }

  async function handleSearch() {
    const normalized = normalizePlate(plate);
    setIsSearching(true);
    setResults({});
    setProgress(0);

    let completed = 0;
    const total = enabledCompanies.length || 1;

    await Promise.all(
      enabledCompanies.map(async (c) => {
        setResults((prev) => ({
          ...prev,
          [c.id]: { companyId: c.id, status: "pending", checkedAt: new Date().toISOString() },
        }));

        try {
  // --- 1) appel API
  const start = Date.now();
  const reqUrl = `${c.apiUrl}?plate=${encodeURIComponent(normalized)}`;
  const r = await fetch(reqUrl, { cache: "no-store" });

  let j: any = undefined;
  try { j = await r.json(); } catch {}

  const now = new Date().toISOString();
  const duration = Date.now() - start;

  // --- 2) debug info : NE PAS mettre "HTTP 200" en message
  const dbg: DebugInfo = {
  httpStatus: r.status,
  durationMs: duration,
  requestUrl: reqUrl,
  screenshots: j?.screenshots,
  message: j?.error ?? (r.ok ? undefined : `HTTP ${r.status}`), // <- keep undefined on 200
  raw: j,
};

  // --- 3) cas SANEF : ok:true => aucun dû
  if (c.id === "fr-sanef") {
    const none = j?.ok === true;   // ton /api/sanef renvoie ok:true

    if (none) {
      setResults((prev) => ({
        ...prev,
        [c.id]: {
          companyId: c.id,
          status: "none",
          message: "Aucun passage détecté pour le moment",
          checkedAt: now,
          debug: dbg,
        },
      }));
    } else {
      setResults((prev) => ({
        ...prev,
        [c.id]: {
          companyId: c.id,
          status: "error",
          message: dbg.message ?? "Réponse inattendue",
          checkedAt: now,
          debug: dbg,
        },
      }));
    }
    return; // <<< IMPORTANT : on sort ici pour ne pas passer au générique
  }

  // --- 4) générique (autres compagnies)
  if (r.ok && j?.hasDue === true && typeof j?.amountDue === "number") {
    setResults((prev) => ({
      ...prev,
      [c.id]: {
        companyId: c.id,
        status: "ok",
        amountDue: j.amountDue,
        currency: j.currency || "EUR",
        checkedAt: now,
        debug: dbg,
      },
    }));
  } else if (r.ok && (j?.ok === true || j?.hasDue === false)) {
    setResults((prev) => ({
      ...prev,
      [c.id]: {
        companyId: c.id,
        status: "none",
        checkedAt: now,
        debug: dbg,
      },
    }));
  } else {
    setResults((prev) => ({
      ...prev,
      [c.id]: {
        companyId: c.id,
        status: "error",
        message: dbg.message ?? "Réponse inattendue",
        checkedAt: now,
        debug: dbg,
      },
    }));
  }
} catch (e: any) {
  setResults((prev) => ({
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
      <header className="border-b bg-white/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-black text-white grid place-items-center font-bold">TP</div>
            <div className="font-semibold tracking-tight">Recherche de péages — Dev</div>
          </div>
          <div className="text-xs text-gray-500">Interface développeur</div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Form */}
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

        {/* Résultats + Debug */}
        <section className="rounded-2xl border shadow-sm bg-white/95 p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Résultats</h2>
            <div className="text-sm text-gray-700">
              Total dû : <span className="font-semibold">{formatMoney(totalDue)}</span>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border">
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
                  const dbg = r && "debug" in r ? r.debug : undefined;
                  return (
                    <tr key={c.id} className="border-t align-top">
                      <td className="p-3 w-[24%]">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-gray-500">{c.apiUrl}</div>
                      </td>
                      <td className="p-3 w-[12%]">
                        {!r ? <span className="text-gray-500">—</span> : (
                          r.status === "pending" ? <span className="badge bg-blue-100 text-blue-700">Interrogation…</span> :
                          r.status === "ok" ? <span className="badge bg-emerald-100 text-emerald-700">Dû trouvé</span> :
                          r.status === "none" ? <span className="badge bg-gray-100 text-gray-700">Aucun dû</span> :
                          <span className="badge bg-rose-100 text-rose-700">Erreur</span>
                        )}
                      </td>
                      <td className="p-3 w-[12%]">
                        {r?.status === "ok" ? formatMoney(r.amountDue, r.currency) : "—"}
                      </td>
                      <td className="p-3 w-[52%]">
                        {/* Actions */}
                        {r?.status === "ok" ? (
                          <div className="flex gap-2 mb-2">
                            {r.resultUrl && (
                              <a
                                className="text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50"
                                href={r.resultUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Voir détails
                              </a>
                            )}
                            <a
                              className="text-sm px-3 py-1.5 rounded-lg bg-black text-white hover:bg-black/85"
                              href={r.payUrl || c.payUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Payer
                            </a>
                          </div>
                        ) : <span className="text-gray-400">—</span>}

                        {/* Debug expandable */}
                        <details className="mt-1">
                          <summary className="text-sm text-gray-700 cursor-pointer select-none">
                            ▾ Voir debug
                          </summary>
                          <div className="text-xs text-gray-700 mt-2 space-y-1">
                            <div>Vérifié le : {r?.checkedAt ? new Date(r.checkedAt).toLocaleString() : "—"}</div>
                            <div>HTTP : {dbg?.httpStatus ?? "—"}</div>
                            <div>Durée : {dbg?.durationMs ? `${dbg.durationMs} ms` : "—"}</div>
                            <div>URL : <a className="underline" href={dbg?.requestUrl} target="_blank" rel="noreferrer">{dbg?.requestUrl || "—"}</a></div>
                            {dbg?.message && <div>Message : <span className="text-rose-700">{dbg.message}</span></div>}
                            {dbg?.screenshots && (
  <div className="flex gap-3">
    {dbg.screenshots.before && (
      <button
        type="button"
        className="underline"
        onClick={() => setSnapToView(dbg.screenshots!.before!)}
      >
        avant
      </button>
    )}
    {dbg.screenshots.after && (
      <button
        type="button"
        className="underline"
        onClick={() => setSnapToView(dbg.screenshots!.after!)}
      >
        après
      </button>
    )}
    {dbg.screenshots.error && (
      <button
        type="button"
        className="underline text-rose-700"
        onClick={() => setSnapToView(dbg.screenshots!.error!)}
      >
        erreur
      </button>
    )}
  </div>
)}

                            <pre className="bg-gray-50 rounded p-2 overflow-auto">{JSON.stringify(dbg?.raw ?? {}, null, 2)}</pre>
                          </div>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Dashboard dev */}
          <details className="mt-6">
            <summary className="font-medium cursor-pointer">Dashboard dev (activer/désactiver des compagnies)</summary>
            <div className="mt-3 grid gap-2">
              {companies.map((c) => (
                <label key={c.id} className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    onChange={(e) => toggleCompany(c.id, e.target.checked)}
                  />
                  <span className="w-52">{c.name}</span>
                  <span className="text-xs text-gray-500">{c.country}</span>
                </label>
              ))}
            </div>
          </details>
        </section>
      </main>

{/* Fenêtre d’aperçu pour la capture */}
{snapToView && (
  <div
    className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4"
    onClick={() => setSnapToView(null)}
  >
    <div
      className="bg-white rounded-xl p-2 max-w-5xl max-h-[90vh] shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <img
        src={snapToView}
        alt="Capture"
        className="max-h-[85vh] object-contain"
      />
      <div className="text-right mt-2">
        <button
          className="px-3 py-1 rounded bg-black text-white hover:bg-black/85"
          onClick={() => setSnapToView(null)}
        >
          Fermer
        </button>
      </div>
    </div>
  </div>
)}

      {/* Styles badges */}
      <style>{`
        .badge { display:inline-flex; align-items:center; padding:2px 8px; border-radius:9999px; font-size:12px; }
        .bg-muted { background:#f3f4f6; color:#6b7280; }
      `}</style>
    </div>
  );
}
