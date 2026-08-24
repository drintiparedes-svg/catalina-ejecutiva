// Literatura científica, de varias fuentes a la vez.
//
// Antes se buscaba sólo en PubMed. PubMed es excelente en medicina y salud
// pública, pero no ve finanzas, innovación ni buena parte de la salud digital,
// que viven en revistas de economía, ingeniería o informática. Este módulo
// consulta cuatro fuentes abiertas en paralelo y funde los resultados:
//
//   · OpenAlex  — todo campo del conocimiento, con conteo de citas y si es de
//                 acceso abierto. Es la de mejor cobertura para finanzas e
//                 innovación.
//   · Crossref  — el registro universal de DOIs; complementa a las demás.
//   · Europe PMC— biomédico y preprints; refuerza salud digital y salud pública.
//   · PubMed    — la de siempre, con su filtro de estudios en humanos.
//
// «Validada» no quiere decir «verdadera»: quiere decir que se muestra lo que
// permite juzgarla —dónde se publicó, cuántas veces la han citado, si es una
// revisión o un preprint sin revisar—. Esa jerarquía se enseña, no se esconde:
// una revisión muy citada pesa más que un preprint reciente, y aquí se ordena
// así y se marca cuál es cuál.

const TIEMPO = 9_000;
const POR_FUENTE = 8;
const DEVUELVE = 8;
const CORREO = "catalina@local";   // OpenAlex y Crossref piden un contacto

// ── Cada fuente, normalizada a la misma forma ────────────────────────────────
//
// Todas devuelven: { titulo, autores, anio, revista, tipo, doi, enlace, citas,
// accesoAbierto, preprint, fuente }.

async function json(url, opciones = {}) {
  const r = await fetch(url, {
    headers: { "User-Agent": `Catalina/1.0 (mailto:${CORREO})`, Accept: "application/json" },
    signal: AbortSignal.timeout(TIEMPO),
    ...opciones
  });
  if (!r.ok) throw new Error(`${url.split("?")[0]} → ${r.status}`);
  return r.json();
}

function esPreprint(tipo, revista) {
  const t = `${tipo || ""} ${revista || ""}`.toLowerCase();
  return /preprint|posted-content|medrxiv|biorxiv|arxiv|ssrn|research square|preprints\.org/.test(t);
}

async function deOpenAlex(consulta) {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(consulta)}`
    + `&per-page=${POR_FUENTE}&mailto=${encodeURIComponent(CORREO)}`;
  const datos = await json(url);
  return (datos.results ?? []).map(o => {
    const revista = o.primary_location?.source?.display_name || "";
    const tipo = o.type || "";
    return {
      titulo: o.title || o.display_name || "",
      autores: (o.authorships ?? []).slice(0, 3).map(a => a.author?.display_name).filter(Boolean).join(", ")
        + ((o.authorships?.length ?? 0) > 3 ? " et al." : ""),
      anio: o.publication_year || null,
      revista,
      tipo,
      doi: (o.doi || "").replace(/^https?:\/\/doi\.org\//, "") || null,
      enlace: o.doi || o.id || "",
      citas: o.cited_by_count ?? null,
      accesoAbierto: o.open_access?.is_oa ?? null,
      preprint: tipo === "preprint" || esPreprint(tipo, revista),
      fuente: "OpenAlex"
    };
  });
}

async function deCrossref(consulta) {
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(consulta)}`
    + `&rows=${POR_FUENTE}&select=title,author,container-title,issued,DOI,type,is-referenced-by-count,URL`
    + `&mailto=${encodeURIComponent(CORREO)}`;
  const datos = await json(url);
  return (datos.message?.items ?? []).map(c => {
    const revista = (c["container-title"] ?? [])[0] || "";
    const tipo = c.type || "";
    return {
      titulo: (c.title ?? [])[0] || "",
      autores: (c.author ?? []).slice(0, 3).map(a => [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean).join(", ")
        + ((c.author?.length ?? 0) > 3 ? " et al." : ""),
      anio: c.issued?.["date-parts"]?.[0]?.[0] || null,
      revista,
      tipo,
      doi: c.DOI || null,
      enlace: c.URL || (c.DOI ? `https://doi.org/${c.DOI}` : ""),
      citas: c["is-referenced-by-count"] ?? null,
      accesoAbierto: null,
      preprint: tipo === "posted-content" || esPreprint(tipo, revista),
      fuente: "Crossref"
    };
  });
}

async function deEuropePMC(consulta) {
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(consulta)}`
    + `&format=json&pageSize=${POR_FUENTE}&resultType=core`;
  const datos = await json(url);
  return (datos.resultList?.result ?? []).map(e => {
    const revista = e.journalInfo?.journal?.title || e.journalTitle || e.bookOrReportDetails?.publisher || "";
    const tipo = e.pubType || "";
    const doi = e.doi || null;
    const enlace = doi ? `https://doi.org/${doi}`
      : (e.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${e.pmid}/`
      : (e.id && e.source ? `https://europepmc.org/article/${e.source}/${e.id}` : ""));
    return {
      titulo: e.title || "",
      autores: e.authorString || "",
      anio: Number(e.pubYear) || null,
      revista,
      tipo,
      doi,
      enlace,
      citas: e.citedByCount ?? null,
      accesoAbierto: e.isOpenAccess === "Y",
      preprint: esPreprint(tipo, revista) || e.source === "PPR",
      fuente: "Europe PMC"
    };
  });
}

async function dePubMed(consulta) {
  const base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
  const comunes = { db: "pubmed", retmode: "json", tool: "catalina", email: CORREO };
  const esearch = await json(`${base}/esearch.fcgi?` + new URLSearchParams({
    ...comunes, term: consulta, retmax: String(POR_FUENTE), sort: "relevance"
  }));
  const ids = esearch?.esearchresult?.idlist ?? [];
  if (!ids.length) return [];
  const resumen = await json(`${base}/esummary.fcgi?` + new URLSearchParams({ ...comunes, id: ids.join(",") }));
  const r = resumen?.result ?? {};
  return ids.map(id => r[id]).filter(Boolean).map(item => {
    const doi = (item.articleids ?? []).find(a => a.idtype === "doi")?.value || null;
    return {
      titulo: item.title || "",
      autores: (item.authors ?? []).slice(0, 3).map(a => a.name).filter(Boolean).join(", ")
        + ((item.authors?.length ?? 0) > 3 ? " et al." : ""),
      anio: Number((item.pubdate || "").slice(0, 4)) || null,
      revista: item.fulljournalname || item.source || "",
      tipo: (item.pubtype ?? []).join(", "),
      doi,
      enlace: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${item.uid}/`,
      citas: null,
      accesoAbierto: null,
      preprint: false,
      fuente: "PubMed"
    };
  });
}

async function deSemanticScholar(consulta) {
  const campos = "title,year,venue,citationCount,externalIds,authors,publicationTypes,openAccessPdf";
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(consulta)}`
    + `&limit=${POR_FUENTE}&fields=${campos}`;
  const datos = await json(url);
  return (datos.data ?? []).map(p => {
    const doi = p.externalIds?.DOI || null;
    const esArxiv = !doi && Boolean(p.externalIds?.ArXiv);
    const tipos = (p.publicationTypes ?? []).join(", ");
    return {
      titulo: p.title || "",
      autores: (p.authors ?? []).slice(0, 3).map(a => a.name).filter(Boolean).join(", ")
        + ((p.authors?.length ?? 0) > 3 ? " et al." : ""),
      anio: p.year || null,
      revista: p.venue || (esArxiv ? "arXiv" : ""),
      tipo: tipos,
      doi,
      enlace: doi ? `https://doi.org/${doi}`
        : (esArxiv ? `https://arxiv.org/abs/${p.externalIds.ArXiv}` : ""),
      citas: p.citationCount ?? null,
      accesoAbierto: p.openAccessPdf?.url ? true : null,
      pdf: p.openAccessPdf?.url || null,
      preprint: esArxiv || esPreprint(tipos, p.venue),
      fuente: "Semantic Scholar"
    };
  });
}

// arXiv devuelve Atom (XML), no JSON. Se extrae con expresiones regulares: son
// preprints de IA, computación y estadística, y su papel es justo ése —lo que
// aún no está publicado—, así que siempre van marcados como preprint.
async function deArxiv(consulta) {
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent("all:" + consulta)}`
    + `&max_results=${POR_FUENTE}&sortBy=relevance`;
  const r = await fetch(url, { headers: { "User-Agent": `Catalina/1.0 (mailto:${CORREO})` }, signal: AbortSignal.timeout(TIEMPO) });
  if (!r.ok) throw new Error(`arxiv → ${r.status}`);
  const xml = await r.text();
  const entradas = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  const et = (bloque, etiqueta) => (bloque.match(new RegExp(`<${etiqueta}[^>]*>([\\s\\S]*?)<\\/${etiqueta}>`)) || [,""])[1]
    .replace(/\s+/g, " ").trim();
  return entradas.map(e => {
    const doi = et(e, "arxiv:doi") || null;
    const id = et(e, "id");
    const autores = (e.match(/<name>([\s\S]*?)<\/name>/g) ?? []).map(a => a.replace(/<\/?name>/g, "").trim());
    return {
      titulo: et(e, "title"),
      autores: autores.slice(0, 3).join(", ") + (autores.length > 3 ? " et al." : ""),
      anio: Number((et(e, "published") || "").slice(0, 4)) || null,
      revista: "arXiv",
      tipo: "preprint",
      doi,
      enlace: doi ? `https://doi.org/${doi}` : id,
      citas: null,
      accesoAbierto: true,          // arXiv es abierto por definición
      pdf: id ? id.replace("/abs/", "/pdf/") : null,
      preprint: true,
      fuente: "arXiv"
    };
  });
}

// Unpaywall no busca: resuelve. Dado un DOI, dice si hay un PDF legal y gratuito
// y dónde. Se usa para enriquecer las que ya se encontraron, no para buscar.
async function pdfAbierto(doi) {
  try {
    const datos = await json(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(CORREO)}`);
    if (!datos?.is_oa) return null;
    return datos.best_oa_location?.url_for_pdf || datos.best_oa_location?.url || null;
  } catch { return null; }
}

// ── Fundir y ordenar ─────────────────────────────────────────────────────────
// ── Fundir y ordenar ─────────────────────────────────────────────────────────

function normalizarTitulo(t) {
  return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// La misma referencia llega por varias fuentes. Se funden por DOI, y si no hay,
// por título normalizado. Se conserva la versión con más información: más citas
// conocidas, o la que traiga acceso abierto.
function fundir(listas) {
  const por = new Map();
  for (const item of listas.flat()) {
    if (!item.titulo) continue;
    const clave = item.doi ? `doi:${item.doi.toLowerCase()}` : `t:${normalizarTitulo(item.titulo)}`;
    const previo = por.get(clave);
    if (!previo) { por.set(clave, { ...item, fuentes: [item.fuente] }); continue; }
    previo.fuentes = [...new Set([...previo.fuentes, item.fuente])];
    if ((item.citas ?? -1) > (previo.citas ?? -1)) previo.citas = item.citas;
    if (previo.accesoAbierto == null && item.accesoAbierto != null) previo.accesoAbierto = item.accesoAbierto;
    if (!previo.pdf && item.pdf) previo.pdf = item.pdf;
    if (!previo.enlace && item.enlace) previo.enlace = item.enlace;
    if (!previo.revista && item.revista) previo.revista = item.revista;
  }
  return [...por.values()];
}

const ESTE_ANIO = new Date().getFullYear();

// Puntaje de validación. No es la verdad del estudio —eso lo juzga quien lo
// lee—, es cuánto respaldo trae: revisado por pares antes que preprint, una
// revisión o metaanálisis por encima de un artículo suelto, más citas y más
// reciente como desempate. El modelo recibe estas señales y las cuenta al hablar.
function puntaje(r) {
  let p = 0;
  if (!r.preprint) p += 1000;                                   // revisado por pares
  if (/review|meta-?analysis|revisión|systematic/i.test(`${r.tipo} ${r.titulo}`)) p += 300;
  if (r.fuentes.length > 1) p += 50;                            // aparece en varias
  p += Math.min(r.citas ?? 0, 2000) / 10;                       // citas, con techo
  if (r.anio) p += Math.max(0, 20 - (ESTE_ANIO - r.anio));      // recencia suave
  return p;
}

export const hayLiteratura = () => true;   // todas las fuentes son abiertas

export async function buscarLiteratura(consulta, opciones = {}) {
  const termino = String(consulta || "").trim();
  if (!termino) return { ok: false, error: "Falta el tema a buscar." };

  // Todas a la vez; que una fuente falle no tumba las demás.
  const intentos = await Promise.allSettled([
    deOpenAlex(termino), deCrossref(termino), deEuropePMC(termino), dePubMed(termino),
    deSemanticScholar(termino), deArxiv(termino)
  ]);
  const nombres = ["OpenAlex", "Crossref", "Europe PMC", "PubMed", "Semantic Scholar", "arXiv"];
  const listas = [];
  const fallaron = [];
  intentos.forEach((res, i) => {
    if (res.status === "fulfilled") listas.push(res.value);
    else { fallaron.push(nombres[i]); console.error("literatura", nombres[i] + ":", res.reason?.message || res.reason); }
  });

  if (!listas.some(l => l.length)) {
    return { ok: false, error: "Ninguna fuente devolvió resultados." };
  }

  const top = fundir(listas)
    .sort((a, b) => puntaje(b) - puntaje(a))
    .slice(0, DEVUELVE);

  // Unpaywall resuelve el PDF legal de las que tengan DOI y aún no lo traigan.
  // Todas a la vez, y un fallo no estorba: es un extra, no un requisito.
  await Promise.allSettled(top.map(async r => {
    if (r.pdf || !r.doi) return;
    const pdf = await pdfAbierto(r.doi);
    if (pdf) { r.pdf = pdf; if (r.accesoAbierto == null) r.accesoAbierto = true; }
  }));

  const referencias = top
    .map(r => ({
      titulo: r.titulo,
      autores: r.autores,
      anio: r.anio,
      revista: r.revista,
      enlace: r.enlace,
      citas: r.citas,
      preprint: r.preprint,
      accesoAbierto: r.accesoAbierto,
      pdf: r.pdf || null,
      // Las bases de las que salió, para que se vea que no es una sola.
      fuentes: r.fuentes
    }));

  return {
    ok: true,
    referencias,
    consultadas: nombres.filter(n => !fallaron.includes(n)),
    fallaron
  };
}
