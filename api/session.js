// Vercel serverless function: intercambia SDP con OpenAI Realtime API.
// La clave vive en las variables de entorno de Vercel, nunca llega al navegador.

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || apiKey.length < 24 || apiKey.includes("reemplaza-esto")) {
    return res.status(503).json({
      error: "Falta OPENAI_API_KEY en las variables de entorno de Vercel",
      code: "API_KEY_MISSING"
    });
  }

  try {
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
        "OpenAI-Safety-Identifier": "catalina-vercel"
      },
      body: form
    });

    const responseBody = await upstream.text();
    if (!upstream.ok) {
      console.error("OpenAI Realtime:", upstream.status, responseBody);
      let upstreamError = {};
      try { upstreamError = JSON.parse(responseBody).error || {}; } catch {}

      if (upstream.status === 401 || upstream.status === 403) {
        return res.status(upstream.status).json({
          error: "OpenAI rechazó la OPENAI_API_KEY.",
          code: "API_KEY_INVALID"
        });
      }
      if (upstream.status === 429) {
        return res.status(429).json({
          error: "Límite de API o facturación.",
          code: "API_RATE_LIMIT"
        });
      }
      return res.status(upstream.status).json({
        error: upstreamError.message || "OpenAI rechazó la sesión",
        code: upstreamError.code || "OPENAI_SESSION_ERROR"
      });
    }

    res.setHeader("Content-Type", "application/sdp");
    res.status(200).send(responseBody);
  } catch (error) {
    console.error("session handler:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
