// Punto de entrada en Vercel.
//
// Allí no se arranca ningún servidor: la plataforma llama a esta función con
// cada petición ya construida. Las claves tampoco vienen de un .env sino de las
// variables del despliegue, que desde el código es lo mismo: process.env.
//
// La carga de app.mjs se hace aquí dentro, y no con un import de arriba, por un
// motivo concreto: si el módulo falla al cargarse —una dependencia que no viajó
// en el paquete, una versión de Node sin alguna función— un import normal mata
// el proceso antes de que exista nadie a quien contárselo, y Vercel devuelve su
// «This Serverless Function has crashed», que no dice cuál fue el fallo.
//
// Cargándolo aquí, ese fallo se puede atrapar y contestar. Cuesta una
// comprobación por petición y a cambio el error llega a quien puede arreglarlo.
let cargado = null;

export default async function (req, res) {
  try {
    cargado ??= await import("../app.mjs");
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({
      error: "El servidor no pudo arrancar.",
      code: "ARRANQUE_FALLIDO",
      // El rastro no lleva claves —son variables de entorno, no aparecen en una
      // traza— pero sí nombres de archivo, que es justo lo que hace falta.
      detalle: String(error?.stack || error).slice(0, 1800)
    }));
  }

  return cargado.atender(req, res);
}
