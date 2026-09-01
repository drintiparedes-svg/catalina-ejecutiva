// Servidor de Catalina con un doble de Google delante. Sirve para recorrer el
// alta entera —consentimiento, canje, carpetas, subida— sin salir a internet.
const real = globalThis.fetch;
const CARPETAS = new Map([["carp-1", "Minutas"], ["carp-2", "Dirección médica"]]);
let creadas = 2;

globalThis.fetch = async (url, opciones = {}) => {
  const u = String(url);
  const responder = (cuerpo, estado = 200) =>
    new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });

  if (u.startsWith("https://oauth2.googleapis.com/token")) {
    const cuerpo = new URLSearchParams(opciones.body);
    if (cuerpo.get("grant_type") === "authorization_code") {
      return cuerpo.get("code") === "codigo-bueno"
        ? responder({ refresh_token: "permiso-de-inti", access_token: "acc", expires_in: 3600 })
        : responder({ error: "invalid_grant" }, 400);
    }
    return cuerpo.get("refresh_token") === "permiso-de-inti"
      ? responder({ access_token: "acc-" + Date.now(), expires_in: 3600 })
      : responder({ error: "invalid_grant" }, 400);
  }
  if (u.includes("/drive/v3/about")) {
    return responder({ user: { displayName: "Inti Paredes", emailAddress: "dr.intiparedes@gmail.com" } });
  }
  if (u.includes("/drive/v3/files") && (opciones.method ?? "GET") === "GET") {
    return responder({ files: [...CARPETAS].map(([id, name]) => ({ id, name })) });
  }
  if (u.includes("/upload/drive/v3/files")) {
    const cuerpoTexto = opciones.body.toString("latin1");
    const nombre = /"name":"([^"]+)"/.exec(cuerpoTexto)?.[1];
    const padre = /"parents":\["([^"]+)"\]/.exec(cuerpoTexto)?.[1] || "(raíz)";
    console.log(`   [Drive] sube «${nombre}» a ${padre} (${CARPETAS.get(padre) || "?"})`);
    return responder({ id: "f" + nombre, name: nombre, webViewLink: "https://drive.google.com/file/d/" + nombre });
  }
  if (u.includes("/drive/v3/files") && opciones.method === "POST") {
    const nombre = JSON.parse(opciones.body).name;
    const id = "carp-" + (++creadas);
    CARPETAS.set(id, nombre);
    return responder({ id, name: nombre });
  }
  return real(url, opciones);
};

process.env.GOOGLE_CLIENT_ID = "cliente.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "secreto";
process.env.PORT = process.env.QA_PUERTO || "4181";
await import(new URL("../server.mjs", import.meta.url).href);
