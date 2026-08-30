// Literatura científica, de varias fuentes a la vez.
//
// Antes se buscaba sólo en PubMed. PubMed es excelente en medicina y salud
// pública, pero no ve finanzas, innovación ni buena parte de la salud digital,
// que viven en revistas de economía, ingeniería o informática. Este módulo
// consulta nueve fuentes abiertas en paralelo y funde los resultados:
//
//   · OpenAlex  — todo campo del conocimiento, con conteo de citas y si es de
//                 acceso abierto. Es la de mejor cobertura para finanzas e
//                 innovación, y de ella sale el factor de impacto de la revista.
//   · Crossref  — el registro universal de DOIs; complementa a las demás.
//   · Europe PMC— biomédico y preprints; refuerza salud digital y salud pública.
//   · PubMed    — la de siempre, con su filtro de estudios en humanos.
//   · Semantic Scholar — ciencia de la computación e IA; cobertura de preprints.
//   · arXiv     — preprints de informática, física y estadística.
//   · ClinicalTrials.gov — registros de ensayos clínicos, con su estado.
//   · LILACS/SciELO — literatura de América Latina, vía BVS.
//   · Epistemonikos — revisiones sistemáticas (requiere clave).
//
// Unpaywall no es una fuente más: resuelve el PDF de acceso abierto de un DOI.
//
// «Validada» no quiere decir «verdadera»: quiere decir que se muestra lo que
// permite juzgarla —dónde se publicó, cuántas veces la han citado, si es una
// revisión o un preprint sin revisar—. Esa jerarquía se enseña, no se esconde:
// una revisión muy citada pesa más que un preprint reciente, y aquí se ordena
// así y se marca cuál es cuál.

const TIEMPO = 9_000;
const POR_FUENTE = 8;
const DEVUELVE = 20;
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
      sourceId: o.primary_location?.source?.id || null,   // para pedir su impacto
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

// ClinicalTrials.gov — ensayos clínicos registrados, publicados o no. Cierra el
// sesgo de publicación: un ensayo con resultado negativo que nunca se publicó
// igual está aquí. No es un artículo revisado por pares: es un registro, y se
// marca como tal para no confundirlo con evidencia publicada.
async function deClinicalTrials(consulta) {
  const url = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(consulta)}`
    + `&pageSize=${POR_FUENTE}&format=json`;
  const datos = await json(url);
  return (datos.studies ?? []).map(s => {
    const p = s.protocolSection ?? {};
    const id = p.identificationModule?.nctId || "";
    const fecha = p.statusModule?.startDateStruct?.date || p.statusModule?.primaryCompletionDateStruct?.date || "";
    return {
      titulo: p.identificationModule?.briefTitle || p.identificationModule?.officialTitle || "",
      autores: p.sponsorCollaboratorsModule?.leadSponsor?.name || "",
      anio: Number(String(fecha).slice(0, 4)) || null,
      revista: "ClinicalTrials.gov",
      tipo: "registro de ensayo",
      doi: null,
      enlace: id ? `https://clinicaltrials.gov/study/${id}` : "",
      citas: null,
      accesoAbierto: true,
      preprint: false,
      registro: true,             // ni artículo ni preprint: un ensayo registrado
      estado: p.statusModule?.overallStatus || "",
      fuente: "ClinicalTrials.gov"
    };
  });
}

// SciELO / LILACS a través de la Biblioteca Virtual en Salud (BVS). Cierra el
// sesgo geográfico: literatura latinoamericana y del Caribe que las grandes
// bases del norte apenas indexan. La BVS a veces responde JSON; si no, esta
// fuente falla sola y se declara como no consultada.
async function deBVS(consulta) {
  const url = `https://pesquisa.bvsalud.org/portal/?output=json&lang=es`
    + `&q=${encodeURIComponent(consulta)}&count=${POR_FUENTE}`;
  const datos = await json(url);
  const docs = datos.docs ?? datos.response?.docs ?? [];
  return docs.slice(0, POR_FUENTE).map(d => {
    const doi = (Array.isArray(d.doi) ? d.doi[0] : d.doi) || null;
    return {
      titulo: (Array.isArray(d.ti) ? d.ti[0] : d.ti) || d.title || "",
      autores: (Array.isArray(d.au) ? d.au.slice(0, 3).join(", ") : d.au) || "",
      anio: Number(String(d.da || d.publication_year || "").slice(0, 4)) || null,
      revista: (Array.isArray(d.ta) ? d.ta[0] : d.ta) || d.journal || "SciELO/LILACS",
      tipo: (Array.isArray(d.type) ? d.type[0] : d.type) || "",
      doi,
      enlace: doi ? `https://doi.org/${doi}` : (d.ur || d.fulltext_url || ""),
      citas: null,
      accesoAbierto: true,
      preprint: false,
      fuente: "SciELO/LILACS"
    };
  });
}

// Epistemonikos — base de revisiones sistemáticas y evidencia, nacida en Chile.
// Es de lo mejor para el criterio de evidencia: una revisión que ya sintetizó
// decenas de estudios pesa más que cualquier estudio suelto. Necesita una clave
// (EPISTEMONIKOS_API_KEY); sin ella, se declara como no consultada.
async function deEpistemonikos(consulta) {
  const clave = process.env.EPISTEMONIKOS_API_KEY?.trim();
  if (!clave) throw new Error("sin EPISTEMONIKOS_API_KEY");
  const url = `https://api.epistemonikos.org/v1/documents/search?q=${encodeURIComponent(consulta)}&size=${POR_FUENTE}`;
  const datos = await json(url, { headers: {
    "User-Agent": `Catalina/1.0 (mailto:${CORREO})`, Accept: "application/json", apikey: clave
  } });
  const docs = datos.documents ?? datos.results ?? datos.data ?? [];
  return docs.slice(0, POR_FUENTE).map(d => {
    const doi = d.doi || d.meta_doi || null;
    return {
      titulo: d.title || (d.titles?.[0]) || "",
      autores: Array.isArray(d.authors) ? d.authors.slice(0, 3).join(", ") : (d.authors || ""),
      anio: Number(d.publication_year || d.year) || null,
      revista: d.journal || d.source || "Epistemonikos",
      tipo: d.classification || d.publication_type || "revisión sistemática",
      doi,
      enlace: doi ? `https://doi.org/${doi}` : (d.url || (d.id ? `https://www.epistemonikos.org/documents/${d.id}` : "")),
      citas: null,
      accesoAbierto: null,
      preprint: false,
      fuente: "Epistemonikos"
    };
  });
}

// ── Fundir y ordenar ─────────────────────────────────────────────────────────

// Consensus. A diferencia de las demás, no es un índice bibliográfico sino un
// buscador construido para preguntas de investigación: devuelve los papeles
// ordenados por relevancia a la pregunta, no por coincidencia de palabras, y
// además dice el DISEÑO del estudio y el cuartil de la revista. Eso es justo lo
// que la persona necesita para declarar el nivel de evidencia, así que su tipo
// se conserva tal cual llega.
//
// Requiere clave (x-api-key). Sin ella se calla y las otras nueve siguen: es
// una fuente más, no un requisito.
async function deConsensus(consulta) {
  const clave = process.env.CONSENSUS_API_KEY?.trim();
  if (!clave) return [];

  const params = new URLSearchParams({
    query: consulta,
    page_size: String(POR_FUENTE)
  });
  const r = await fetch(`https://api.consensus.app/v1/search?${params}`, {
    headers: { "x-api-key": clave, Accept: "application/json" },
    signal: AbortSignal.timeout(TIEMPO)
  });
  if (!r.ok) throw new Error(`api.consensus.app → ${r.status}`);
  const datos = await r.json();

  return (datos.results ?? []).map(o => {
    const autores = Array.isArray(o.authors) ? o.authors : [];
    const revista = o.journal_name || "";
    // El diseño que declara Consensus (rct, meta-analysis, systematic review…)
    // entra como `tipo`: es lo que el puntaje usa para subir las revisiones y
    // lo que permite decir en voz alta qué clase de estudio es.
    const tipo = o.study_type || "";
    return {
      titulo: o.title || "",
      autores: autores.slice(0, 3).join(", ") + (autores.length > 3 ? " et al." : ""),
      anio: o.publish_year || null,
      revista,
      tipo,
      doi: o.doi || null,
      enlace: o.doi ? `https://doi.org/${o.doi}` : (o.url || ""),
      citas: o.citation_count ?? null,
      accesoAbierto: null,
      preprint: o.is_preprint === true || esPreprint(tipo, revista),
      // Señales propias de Consensus que las demás no dan.
      cuartil: Number.isFinite(o.sjr_best_quartile) ? o.sjr_best_quartile : null,
      muestra: Number.isFinite(o.sample_size) ? o.sample_size : null,
      resumenClave: o.takeaway || "",
      fuente: "Consensus"
    };
  });
}

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
    if (!previo.registro && item.registro) { previo.registro = true; previo.estado = item.estado; }
    if (!previo.enlace && item.enlace) previo.enlace = item.enlace;
    if (!previo.revista && item.revista) previo.revista = item.revista;
    if (!previo.sourceId && item.sourceId) previo.sourceId = item.sourceId;
    // Señales que hoy sólo trae Consensus —diseño del estudio, cuartil de la
    // revista, tamaño de muestra y el resumen en una frase—. Sin esto se
    // perdían en cuanto otra base había traído el mismo trabajo antes.
    if (!previo.tipo && item.tipo) previo.tipo = item.tipo;
    if (previo.cuartil == null && item.cuartil != null) previo.cuartil = item.cuartil;
    if (previo.muestra == null && item.muestra != null) previo.muestra = item.muestra;
    if (!previo.resumenClave && item.resumenClave) previo.resumenClave = item.resumenClave;
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
  if (r.registro) p += 400;                                     // ensayo registrado
  else if (!r.preprint) p += 1000;                              // revisado por pares
  if (/review|meta-?analysis|revisión|systematic/i.test(`${r.tipo} ${r.titulo}`)) p += 300;
  // Un ensayo aleatorizado pesa más que un observacional. Consensus lo declara
  // explícitamente («rct»), así que aquí deja de ser una adivinanza del título.
  else if (/\brct\b|randomi[sz]ed|aleatorizado/i.test(`${r.tipo} ${r.titulo}`)) p += 200;
  // Cuartil de la revista: 1 es el mejor. Sólo suma cuando se conoce.
  if (r.cuartil >= 1 && r.cuartil <= 4) p += (5 - r.cuartil) * 25;
  if (r.fuentes.length > 1) p += 50;                            // aparece en varias
  // Consensus va primero. No es preferencia de marca: es el único buscador de
  // los diez que ordena por relevancia a la PREGUNTA en vez de por coincidencia
  // de palabras, y el único que declara el diseño del estudio. Cuando un trabajo
  // viene de ahí, es porque responde a lo que se preguntó, así que encabeza.
  if (r.fuentes.includes("Consensus")) p += 600;
  p += Math.min(r.citas ?? 0, 2000) / 10;                       // citas, con techo
  if (r.anio) p += Math.max(0, 20 - (ESTE_ANIO - r.anio));      // recencia suave
  if (Number.isFinite(r.impacto)) p += Math.min(r.impacto, 50) * 2;  // impacto de la revista
  return p;
}

// Impacto de la revista. El «factor de impacto» de Clarivate es propietario y
// sin API legal; OpenAlex publica el mismo cálculo —citas promedio por trabajo
// en los dos años previos— sobre datos abiertos. Es eso lo que se muestra, y se
// etiqueta como aproximado para no hacerlo pasar por el JIF oficial.
async function ponerImpacto(refs) {
  const ids = [...new Set(refs.map(r => r.sourceId).filter(Boolean))]
    .map(u => u.replace(/^https?:\/\/openalex\.org\//, ""));
  if (!ids.length) return;
  try {
    const datos = await json(`https://api.openalex.org/sources?filter=ids.openalex:${ids.join("|")}`
      + `&per-page=${ids.length}&mailto=${encodeURIComponent(CORREO)}&select=id,summary_stats`);
    const por = new Map();
    for (const src of datos.results ?? []) por.set(src.id, src.summary_stats?.["2yr_mean_citedness"]);
    for (const r of refs) {
      const v = r.sourceId && por.get(r.sourceId);
      if (Number.isFinite(v)) r.impacto = Math.round(v * 10) / 10;
    }
  } catch (e) { console.error("impacto:", e.message); }
}

export const hayLiteratura = () => true;   // todas las fuentes son abiertas

export async function buscarLiteratura(consulta, opciones = {}) {
  const termino = String(consulta || "").trim();
  if (!termino) return { ok: false, error: "Falta el tema a buscar." };

  // Todas a la vez; que una fuente falle no tumba las demás.
  const intentos = await Promise.allSettled([
    deOpenAlex(termino), deCrossref(termino), deEuropePMC(termino), dePubMed(termino),
    deSemanticScholar(termino), deArxiv(termino),
    deClinicalTrials(termino), deBVS(termino), deEpistemonikos(termino), deConsensus(termino)
  ]);
  const nombres = ["OpenAlex", "Crossref", "Europe PMC", "PubMed", "Semantic Scholar", "arXiv",
    "ClinicalTrials.gov", "SciELO/LILACS", "Epistemonikos", "Consensus"];
  const listas = [];
  const fallaron = [];
  intentos.forEach((res, i) => {
    if (res.status === "fulfilled") listas.push(res.value);
    else { fallaron.push(nombres[i]); console.error("literatura", nombres[i] + ":", res.reason?.message || res.reason); }
  });

  if (!listas.some(l => l.length)) {
    return { ok: false, error: "Ninguna fuente devolvió resultados." };
  }

  const fundidas = fundir(listas).sort((a, b) => puntaje(b) - puntaje(a));
  const total = fundidas.length;              // cuántas distintas se encontraron
  const top = fundidas.slice(0, DEVUELVE);

  // Impacto de la revista (OpenAlex) y PDF legal (Unpaywall), en paralelo. Con
  // el impacto ya puesto se reordena: a igualdad de evidencia, primero la
  // revista de mayor impacto, que es justo lo que se pide al ampliar.
  await Promise.allSettled([
    ponerImpacto(top),
    ...top.map(async r => {
      if (r.pdf || !r.doi) return;
      const pdf = await pdfAbierto(r.doi);
      if (pdf) { r.pdf = pdf; if (r.accesoAbierto == null) r.accesoAbierto = true; }
    })
  ]);
  top.sort((a, b) => puntaje(b) - puntaje(a));

  const referencias = top
    .map(r => ({
      titulo: r.titulo,
      autores: r.autores,
      anio: r.anio,
      revista: r.revista,
      enlace: r.enlace,
      citas: r.citas,
      impacto: Number.isFinite(r.impacto) ? r.impacto : null,
      preprint: r.preprint,
      registro: r.registro || false,
      estado: r.estado || null,
      accesoAbierto: r.accesoAbierto,
      pdf: r.pdf || null,
      // Diseño del estudio y calidad de la revista: es lo que permite decir el
      // nivel de evidencia en vez de insinuarlo.
      tipo: r.tipo || null,
      cuartil: r.cuartil ?? null,
      muestra: r.muestra ?? null,
      resumenClave: r.resumenClave || null,
      // Las bases de las que salió, para que se vea que no es una sola.
      fuentes: r.fuentes
    }));

  return {
    ok: true,
    total,
    referencias,
    consultadas: nombres.filter(n => !fallaron.includes(n)),
    fallaron
  };
}


// Comprueba la clave de Consensus contra su API, con una búsqueda mínima. Dice
// qué pasa exactamente —clave ausente, rechazada, sin plan, cuota agotada— en
// vez de un «no funciona» que obliga a adivinar.
export async function probarConsensus() {
  const clave = process.env.CONSENSUS_API_KEY?.trim();
  if (!clave) {
    return { ok: false, code: "SIN_CLAVE",
      error: "No hay CONSENSUS_API_KEY en el servidor. Añádela en Vercel → Settings → Environment Variables y haz Redeploy." };
  }
  // Se dice cómo es la clave sin revelarla: sirve para detectar un copiado a
  // medias o con espacios, que es el fallo más común.
  const huella = { largo: clave.length, empieza: clave.slice(0, 4) + "…" };

  let r, crudo;
  try {
    const params = new URLSearchParams({ query: "test", page_size: "1" });
    r = await fetch(`https://api.consensus.app/v1/search?${params}`, {
      headers: { "x-api-key": clave, Accept: "application/json" },
      signal: AbortSignal.timeout(TIEMPO)
    });
    crudo = await r.text();
  } catch (error) {
    return { ok: false, code: "SIN_RED", huella,
      error: error.name === "TimeoutError" ? "Consensus tardó demasiado en responder." : "No se pudo contactar con Consensus." };
  }

  if (r.status === 401 || r.status === 403) {
    return { ok: false, code: "CLAVE_RECHAZADA", estado: r.status, huella,
      error: `Consensus rechazó la clave (${r.status}). Revisa que sea la clave completa de tu cuenta y que tu plan incluya API.`,
      detalle: crudo.slice(0, 200) };
  }
  if (r.status === 429) {
    return { ok: false, code: "CUOTA", estado: 429, huella,
      error: "La clave es válida pero se agotó la cuota o se superó el límite de peticiones." };
  }
  if (!r.ok) {
    return { ok: false, code: "ERROR", estado: r.status, huella,
      error: `Consensus respondió ${r.status}.`, detalle: crudo.slice(0, 200) };
  }

  let datos = {};
  try { datos = JSON.parse(crudo); } catch {}
  const cuantos = (datos.results ?? []).length;
  const ejemplo = (datos.results ?? [])[0];
  return {
    ok: true, estado: 200, huella,
    resultados: cuantos,
    // Una muestra real prueba que no sólo autentica: además devuelve datos.
    ejemplo: ejemplo ? { titulo: ejemplo.title, anio: ejemplo.publish_year, tipo: ejemplo.study_type || null } : null
  };
}
