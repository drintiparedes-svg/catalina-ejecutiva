// Arranque local: escucha en un puerto y abre el navegador.
//
// Todo lo que hace el servidor —rutas, herramientas, firma de sesiones— vive en
// app.mjs, y desde ahí lo usan por igual este arranque y el de Vercel
// (api/index.mjs). Aquí sólo queda lo que es propio de correr en tu equipo:
// escuchar en 127.0.0.1 y decir por dónde.
import { createServer } from "node:http";
import { atender, VERSION } from "./app.mjs";

const port = Number(process.env.PORT || 4173);

createServer(atender).listen(port, "127.0.0.1", () => {
  console.log(`Catalina ${VERSION} está disponible en http://127.0.0.1:${port}`);
});
