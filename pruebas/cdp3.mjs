// Como cdp2, pero puede inyectar un guion ANTES de que la página cargue sus
// módulos. Hace falta porque escucha.js captura window.SpeechRecognition al
// cargarse: un doble instalado después ya no lo ve.
const PUERTO = 9334;

export async function conducir(url, guion, previo = "", espera = 30000) {
  const nueva = await fetch(`http://127.0.0.1:${PUERTO}/json/new?about:blank`, { method: "PUT" });
  const ws = new WebSocket((await nueva.json()).webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));

  let id = 0;
  const pendientes = new Map();
  ws.addEventListener("message", ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pendientes.has(m.id)) { pendientes.get(m.id)(m); pendientes.delete(m.id); }
  });
  const enviar = (method, params) => new Promise(res => {
    const propio = ++id;
    pendientes.set(propio, res);
    ws.send(JSON.stringify({ id: propio, method, params }));
  });

  await enviar("Page.enable", {});
  if (previo) await enviar("Page.addScriptToEvaluateOnNewDocument", { source: previo });
  await enviar("Page.navigate", { url });
  await new Promise(r => setTimeout(r, 2500));

  const salida = await enviar("Runtime.evaluate", {
    expression: guion, awaitPromise: true, returnByValue: true, timeout: espera
  });
  ws.close();
  return salida.result?.result?.value ?? salida.result?.exceptionDetails?.exception?.description ?? JSON.stringify(salida);
}
