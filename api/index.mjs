// Punto de entrada en Vercel.
//
// Allí no se arranca ningún servidor: la plataforma llama a esta función con
// cada petición ya construida. Por eso app.mjs no escucha en un puerto y este
// archivo no hace más que exportarlo.
//
// Las claves no vienen de un .env sino de las variables del despliegue, que se
// ponen en el panel de Vercel. Es lo mismo desde el punto de vista del código:
// process.env.
import { atender } from "../app.mjs";

export default atender;
