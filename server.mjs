import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./public", import.meta.url));
await loadEnv(fileURLToPath(new URL("./.env", import.meta.url)));
const port = Number(process.env.PORT || 4173);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ok: true, apiKeyConfigured: hasApiKey() });
    }

    if (req.method === "POST" && req.url === "/session") {
      return await createRealtimeSession(req, res);
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return json(res, 405, { error: "Método no permitido" });
    }

    const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
    const requested = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.slice(1));
    const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
    const body = await readFile(join(root, safePath));
    res.writeHead(200, {
      "Content-Type": mime[extname(safePath)] || "application/octet-stream",
      "Cache-Control": [".html", ".js", ".css"].includes(extname(safePath)) ? "no-cache" : "public, max-age=3600"
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch (error) {
    if (error.code === "ENOENT") return json(res, 404, { error: "No encontrado" });
    console.error(error);
    json(res, 500, { error: "Error interno" });
  }
});

async function createRealtimeSession(req, res) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!hasApiKey()) {
    return json(res, 503, { error: "Falta OPENAI_API_KEY en el archivo .env", code: "API_KEY_MISSING" });
  }

  const sdp = await readBody(req);
  const form = new FormData();
  form.set("sdp", sdp);
  form.set("session", JSON.stringify({
    type: "realtime",
    model: "gpt-realtime-2.1",
    output_modalities: ["audio"],
    instructions: [
      "Tu nombre es Catalina. Eres una asistente conversacional cálida, clara y profesional.",
      "Habla en español latinoamericano salvo que la persona use otro idioma.",
      "Responde siempre mediante voz, con un tono femenino neutro latinoamericano, natural, sereno y expresivo.",
      "Usa pausas humanas breves, ritmo conversacional y pronunciación clara. Evita sonar como locutora o robot.",
      "Tus respuestas orales deben ser naturales y concisas. No digas que eres ChatGPT; preséntate como Catalina.",
      "Puedes ser interrumpida y debes escuchar con atención."
    ].join(" "),
    audio: {
      input: { turn_detection: { type: "server_vad", create_response: true, interrupt_response: true } },
      output: { voice: "marin" }
    }
  }));

  const upstream = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Safety-Identifier": "catalina-local-owner"
    },
    body: form
  });
  const responseBody = await upstream.text();
  if (!upstream.ok) {
    console.error("OpenAI Realtime:", upstream.status, responseBody);
    let upstreamError = {};
    try { upstreamError = JSON.parse(responseBody).error || {}; } catch {}
    if (upstream.status === 401 || upstream.status === 403) {
      return json(res, upstream.status, {
        error: "OpenAI rechazó la OPENAI_API_KEY. Genera o pega una clave válida de la API, no la contraseña de ChatGPT.",
        code: "API_KEY_INVALID"
      });
    }
    if (upstream.status === 429) {
      return json(res, upstream.status, {
        error: "La API alcanzó un límite de uso o necesita facturación activa.",
        code: "API_RATE_LIMIT"
      });
    }
    return json(res, upstream.status, {
      error: upstreamError.message || "OpenAI rechazó la sesión",
      code: upstreamError.code || "OPENAI_SESSION_ERROR"
    });
  }
  res.writeHead(200, { "Content-Type": "application/sdp" });
  res.end(responseBody);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function hasApiKey() {
  const key = process.env.OPENAI_API_KEY?.trim() || "";
  return key.length > 24 && !key.includes("reemplaza-esto");
}

async function loadEnv(path) {
  try {
    const text = await readFile(path, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const equals = line.indexOf("=");
      if (equals < 1) continue;
      const key = line.slice(0, equals).trim();
      let value = line.slice(equals + 1).trim();
      value = value.replace(/^(['"])(.*)\1$/, "$2");
      if (!(key in process.env) || !process.env[key]) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

server.listen(port, "127.0.0.1", () => {
  console.log(`Catalina está disponible en http://127.0.0.1:${port}`);
});
