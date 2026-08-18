// Boca y mandíbula.
//
// El retrato es una sola fotografía, así que la única forma de conseguir un
// gesto anatómico es deformar la piel real en lugar de superponer dibujos.
// La capa hace tres cosas:
//
//   1. Deforma toda la mitad inferior del rostro con un campo de arrastre
//      continuo: el mentón baja lo máximo, la comisura una tercera parte y las
//      mejillas prácticamente nada. Es el giro de la mandíbula, no un bloque
//      que se traslada.
//   2. Levanta el labio superior con un campo propio: pertenece al maxilar, se
//      mueve mucho menos y se ancla en la base de la nariz.
//   3. Dibuja la cavidad exactamente entre ambos bordes deformados, así la
//      apertura nunca es una barra negra que llega a las comisuras.
//
// Todos los tramos comparten los mismos puntos de corte, por lo que los bordes
// coinciden y la piel no se rompe.

import { clamp, mix, smoothstep } from "../animation/math.js";
import { TUNING } from "../animation/tuning.js";
import { MOUTH } from "./rig.js";
import { Surface, createSurface } from "./surface.js";

// El recorrido del mentón y la eversión del labio viven en TUNING: son los dos
// valores que hay que ver en la cara para acertar, no calcular.
const CORNER_RATIO = .34;    // parte del recorrido mandibular que sigue la comisura
const SMILE_PULL = 5.0;      // recorrido de la comisura entre labios recogidos y estirados
const CURL_PULL = 9.0;       // recorrido de la comisura por expresión (sonrisa o desagrado)
const CAVITY_STEPS = 34;
// Altura de la corona de los incisivos superiores, en píxeles de imagen. Es
// constante por anatomía: los dientes cuelgan del maxilar y no se mueven con la
// mandíbula, así que al abrir más sólo crece la cavidad que queda debajo.
const CROWN_HEIGHT = 8.5;

// Arcada superior visible, de la línea media hacia fuera.
//
// Los anchos son los *aparentes*, no los reales. La arcada es una curva que se
// aleja del observador, así que cada pieza se ve girada un ángulo creciente y
// su cara vestibular queda escorzada: el ancho en pantalla es el real por el
// coseno de ese ángulo. Con anchos casi iguales la dentadura parece una valla;
// con el escorzo aplicado aparece la profundidad.
//
//   pieza      ancho real   ángulo   ancho aparente (central = 1)
//   central      8,5 mm       7°            1,00
//   lateral      6,5 mm      21°            0,74
//   canino       7,5 mm      38°            0,66
//   premolar 1   7,0 mm      55°            0,46
//   premolar 2   6,5 mm      70°            0,26
//
// `c` es el centro de la pieza y `w` su semiancho, en coordenadas normalizadas
// de la boca; `len` es su longitud relativa a la corona y `punta` marca el
// canino, que termina en vértice en lugar de en borde recto.
// `tono` es una variación mínima de brillo por pieza: una dentadura real nunca
// es uniforme, y esa irregularidad es buena parte de lo que la hace creíble.
const TEETH = [
  { c: .115, w: .111, len: 1.00, tono: 1.00 },              // incisivo central
  { c: .316, w: .0814, len: .86, tono: .94 },               // incisivo lateral
  { c: .478, w: .0722, len: .97, tono: .97, punta: true },  // canino
  { c: .607, w: .0491, len: .78, tono: .89 },               // primer premolar
  { c: .690, w: .0260, len: .66, tono: .84 }                // segundo premolar
].flatMap((pieza, indice) => [
  { ...pieza, tono: pieza.tono * (1 - indice * .012) },
  { ...pieza, c: -pieza.c, tono: pieza.tono * (1 + indice * .010) }
]);

// Perfil de apertura a lo largo de la boca: uno en el centro, cero exacto en
// las comisuras y con pendiente nula al llegar a ellas.
function envelope(u) {
  const a = Math.abs(u);
  if (a >= 1) return 0;
  return Math.cos(Math.PI / 2 * a) ** 1.25;
}

// El surco entre los labios no es horizontal: en la fotografía baja hasta
// y≈407 en el centro y sube a y≈402 en las comisuras. Si la cavidad se apoya en
// una recta, se come el bermellón por fuera y deja asomar el labio inferior por
// dentro. Toda la abertura se construye sobre esta curva.
function seamAt(u) {
  return 402 + 5 * Math.pow(Math.max(0, 1 - u * u), .9);
}

export class MouthLayer {
  constructor(createSurfaceImpl = createSurface) {
    this.surface = new Surface(createSurfaceImpl);
    this.columns = this.#buildColumns();
  }

  // Columnas más densas sobre la boca que sobre las mejillas: allí es donde la
  // curvatura del campo de arrastre cambia rápido.
  #buildColumns() {
    const { patch, centerX, halfWidth } = MOUTH;
    const mouthLeft = centerX - halfWidth * 1.8;
    const mouthRight = centerX + halfWidth * 1.8;
    const edges = [];
    for (let x = patch.x; x < mouthLeft; x += 18) edges.push(x);
    for (let x = mouthLeft; x < mouthRight; x += 9) edges.push(x);
    for (let x = mouthRight; x < patch.x + patch.width; x += 18) edges.push(x);
    edges.push(patch.x + patch.width);
    return edges;
  }

  // Estado geométrico del cuadro. Se calcula una sola vez y lo consultan la
  // deformación, la cavidad y el sombreado.
  buildField(mouth) {
    const open = clamp(mouth.open ?? 0);
    const spread = clamp(mouth.spread ?? .5);
    const round = clamp(mouth.round ?? 0);
    const press = clamp(mouth.press ?? 0);
    const jaw = clamp(mouth.jaw ?? 0);

    const cx = MOUTH.centerX;
    const seamY = MOUTH.seamY;
    const halfWidth = MOUTH.halfWidth;
    const jawShift = jaw * TUNING.jawTravel;
    const cornerDrop = jawShift * CORNER_RATIO;

    // Los labios se estiran al sonreír o al articular /i/ y se recogen al
    // redondear /o/ y /u/. El apretón labial ensancha un poco la línea.
    const widthScale = 1 + (spread - .5) * .30 - round * .22 + press * .04;

    // El labio superior sube poco: en un rostro real recorre menos de un
    // tercio de lo que baja el inferior.
    const lift = Math.max(-1.2, open * (5.4 + spread * 1.8 - round * 1.9) - press * 1.1);
    const evert = Math.max(-1, open * TUNING.lipEvert * (1 - round * .30) - press * 1.4);

    // Tracción de las comisuras. Al articular vocales anteriores el cigomático
    // tira de la comisura hacia arriba y al redondear la deja caer. Sin este
    // término la boca se abre y cierra como una ranura, por muy bien que se
    // muevan los labios.
    // `curl` es el sesgo que aporta la expresión: positivo sonríe, negativo
    // deja caer la comisura. Se suma al tirón que ya produce la articulación.
    const smile = (spread - .5) * SMILE_PULL + (mouth.curl ?? 0) * CURL_PULL;

    const field = {
      open, spread, round, press, jaw,
      cx, seamY, halfWidth, widthScale, jawShift, cornerDrop, lift, evert,
      active: open > .006 || jaw > .006 || press > .02 || Math.abs(widthScale - 1) > .004,

      u(x) { return (x - cx) / halfWidth; },

      // Desplazamiento horizontal: la comisura se aleja o se acerca al centro y
      // el efecto se disuelve sobre la mejilla.
      shiftX(x) {
        const t = Math.abs(x - cx) / halfWidth;
        const fade = t <= 1 ? 1 : 1 - smoothstep(1, 1.7, t);
        return (x - cx) * (widthScale - 1) * fade;
      },

      // Campo del maxilar (labio superior y filtrum).
      upperTravel(x, y) {
        const e = envelope(field.u(x));
        const outer = 1 - smoothstep(1, 1.75, Math.abs(field.u(x)));
        const full = (cornerDrop - smile) * (1 - e) * outer - lift * e;
        return full * smoothstep(356, seamY + 1, y);
      },

      // Campo de la mandíbula (labio inferior, mentón, línea mandibular).
      lowerTravel(x, y) {
        const e = envelope(field.u(x));
        const side = 1 - smoothstep(60, MOUTH.jawSpan, Math.abs(x - cx));
        const atSeam = .34 + .61 * e;
        const vertical = y <= seamY + 1
          ? atSeam * smoothstep(394, seamY + 1, y)
          : mix(atSeam, 1, smoothstep(seamY + 1, 478, y));
        const tail = 1 - smoothstep(540, 584, y);
        const nearLip = smoothstep(394, seamY + 1, y) * (1 - smoothstep(seamY + 1, 441, y));
        const lip = evert * e * nearLip;
        const corner = -smile * (1 - e) * side * nearLip;
        return jawShift * side * vertical * tail + lip + corner;
      },

      // La deformación horizontal sólo vive alrededor de los labios.
      upperShift(x, y) { return field.shiftX(x) * smoothstep(356, 400, y); },
      lowerShift(x, y) {
        return field.shiftX(x)
          * smoothstep(394, seamY, y)
          * (1 - smoothstep(seamY + 6, 446, y));
      },

      // Bordes de la abertura, en coordenadas de destino y sobre la curva real
      // del surco labial.
      upperEdge(u) {
        const x = cx + u * halfWidth;
        return seamAt(u) + field.upperTravel(x, seamY + 1);
      },
      lowerEdge(u) {
        const x = cx + u * halfWidth;
        return seamAt(u) + field.lowerTravel(x, seamY + 1);
      },
      edgeX(u) { return cx + u * halfWidth * widthScale; }
    };

    field.gap = u => Math.max(0, field.lowerEdge(u) - field.upperEdge(u));
    return field;
  }

  draw(ctx, image, view, mouth) {
    const field = this.buildField(mouth);
    if (!field.active) return;

    const { patch, mask } = MOUTH;
    const { scale, pixelRatio } = view;
    const cssWidth = patch.width * scale;
    const cssHeight = patch.height * scale;
    const layer = this.surface.acquire(cssWidth, cssHeight, pixelRatio);

    // Coordenadas locales del parche.
    const lx = x => (x - patch.x) * scale;
    const ly = y => (y - patch.y) * scale;

    // 1. Copia intacta de la región: garantiza que el borde de la máscara
    //    coincida píxel a píxel con el rostro que hay debajo.
    layer.drawImage(
      image,
      patch.x, patch.y, patch.width, patch.height,
      0, 0, cssWidth, cssHeight
    );

    // 2. Mitad inferior del rostro y 3. labio superior.
    this.#warp(layer, image, field, lx, ly, MOUTH.lowerBreaks, "lower");
    this.#warp(layer, image, field, lx, ly, MOUTH.upperBreaks, "upper");

    // 4. Cavidad: cubre además el borde escalonado de las columnas.
    this.#drawCavity(layer, field, lx, ly, scale);

    this.surface.feather(cssWidth, cssHeight, {
      centerX: (mask.centerX - patch.x) * scale,
      centerY: (mask.centerY - patch.y) * scale,
      radiusX: mask.radiusX * scale,
      radiusY: mask.radiusY * scale,
      solid: mask.solid
    });

    this.surface.blit(
      ctx,
      view.dx + patch.x * scale,
      view.dy + patch.y * scale,
      cssWidth,
      cssHeight
    );
  }

  // Redibuja una franja horizontal columna por columna. Cada tramo vertical se
  // estira entre dos puntos de corte, de modo que el desplazamiento varía de
  // forma continua y la piel no se corta en escalones.
  #warp(layer, image, field, lx, ly, breaks, kind) {
    const upper = kind === "upper";
    const travel = upper ? field.upperTravel : field.lowerTravel;
    const shift = upper ? field.upperShift : field.lowerShift;
    const columns = this.columns;
    const overlap = .35;

    for (let index = 0; index < columns.length - 1; index += 1) {
      const x0 = columns[index];
      const x1 = columns[index + 1];
      const xMid = (x0 + x1) / 2;
      const u = Math.abs(field.u(xMid));
      // Fuera del alcance del labio superior no hay nada que redibujar.
      if (upper && u > 1.9) continue;

      // Si la columna no se mueve, los píxeles de la copia intacta ya son los
      // correctos. Saltarla ahorra la mayor parte del trabajo en reposo y en
      // las aperturas pequeñas, que son la mayoría del tiempo de conversación.
      let moves = Math.abs(shift(x0, field.seamY)) > .12
        || Math.abs(shift(x1, field.seamY)) > .12;
      for (let step = 0; !moves && step < breaks.length; step += 1) {
        if (Math.abs(travel(xMid, breaks[step])) > .12) moves = true;
      }
      if (!moves) continue;

      const destX0 = x0 + shift(x0, field.seamY);
      const destX1 = x1 + shift(x1, field.seamY);
      // Invasión hacia la cavidad: esconde el escalón entre columnas bajo la
      // sombra interior, y se anula cuando la boca está casi cerrada.
      const bite = Math.min(2.4, field.gap(field.u(xMid)) * .45);

      for (let step = 0; step < breaks.length - 1; step += 1) {
        let sourceTop = breaks[step];
        let sourceBottom = breaks[step + 1];
        if (upper && step === breaks.length - 2) sourceBottom += bite;
        if (!upper && step === 0) sourceTop -= bite;

        const destTop = sourceTop + travel(xMid, sourceTop);
        const destBottom = sourceBottom + travel(xMid, sourceBottom) + overlap;
        if (destBottom <= destTop) continue;

        layer.drawImage(
          image,
          x0, sourceTop, x1 - x0, sourceBottom - sourceTop,
          lx(destX0) - overlap, ly(destTop),
          lx(destX1) - lx(destX0) + overlap * 2, ly(destBottom) - ly(destTop)
        );
      }
    }
  }

  #drawCavity(layer, field, lx, ly, scale) {
    const topPoints = [];
    const bottomPoints = [];
    let maxGap = 0;
    for (let index = 0; index <= CAVITY_STEPS; index += 1) {
      const u = -1 + (2 * index) / CAVITY_STEPS;
      const x = lx(field.edgeX(u));
      topPoints.push([x, ly(field.upperEdge(u))]);
      bottomPoints.push([x, ly(field.lowerEdge(u))]);
      maxGap = Math.max(maxGap, field.gap(u));
    }
    if (maxGap < .35) {
      this.#drawLipSeam(layer, field, lx, ly, scale);
      return;
    }

    const path = ctx => {
      ctx.beginPath();
      ctx.moveTo(topPoints[0][0], topPoints[0][1]);
      for (const [x, y] of topPoints) ctx.lineTo(x, y);
      for (let index = bottomPoints.length - 1; index >= 0; index -= 1) {
        ctx.lineTo(bottomPoints[index][0], bottomPoints[index][1]);
      }
      ctx.closePath();
    };

    const top = ly(field.upperEdge(0));
    const bottom = ly(field.lowerEdge(0));
    const height = Math.max(1, bottom - top);
    const centerX = lx(field.cx);

    layer.save();
    path(layer);
    layer.clip();

    // Fondo de la cavidad. Es lo que queda por debajo de la arcada: cuanto más
    // baja la mandíbula, más superficie oscura, no más diente.
    const depth = layer.createLinearGradient(0, top, 0, bottom);
    depth.addColorStop(0, "rgba(9,19,28,.94)");
    depth.addColorStop(.42, "rgba(6,15,22,.95)");
    depth.addColorStop(1, "rgba(12,26,35,.90)");
    layer.fillStyle = depth;
    layer.fillRect(centerX - 200 * scale, top - 4 * scale, 400 * scale, height + 8 * scale);

    const openness = clamp((field.open - .12) / .55);

    // Lengua: un volumen apenas insinuado al fondo, por detrás de los dientes.
    if (openness > .12) {
      const tongue = layer.createRadialGradient(
        centerX, bottom - height * .12, 1,
        centerX, bottom - height * .12, height * 1.15
      );
      tongue.addColorStop(0, `rgba(78,104,120,${.30 * openness})`);
      tongue.addColorStop(1, "rgba(78,104,120,0)");
      layer.fillStyle = tongue;
      layer.fillRect(centerX - 200 * scale, top, 400 * scale, height + 4 * scale);
    }

    // Arcada superior.
    //
    // Los incisivos cuelgan del maxilar, así que su altura es constante: no
    // crece con la apertura. Entre el borde del labio y el esmalte queda una
    // franja fina de sombra propia, y por debajo empieza la cavidad.
    //
    // Cada pieza se dibuja aparte, con su anchura y su longitud: los centrales
    // son los más largos, los laterales se acortan, el canino vuelve a bajar en
    // punta y el premolar apenas asoma. Una banda uniforme con rayitas se lee
    // como un teclado; ocho piezas con silueta propia se leen como una boca.
    const teethAlpha = clamp((field.open - .06) / .22) * (1 - field.round * .72)
      * (1 - field.press) * .92;
    if (teethAlpha > .015) {
      this.#drawArch(layer, field, lx, ly, scale, teethAlpha);
    }

    // Sombra propia del labio superior proyectada sobre el esmalte. Es un
    // degradado corto que arranca en el borde del labio: da el volumen sin
    // interponer una línea oscura entre labio y diente.
    const sombraAlto = Math.min(height * .34, 3.4 * scale);
    const shade = layer.createLinearGradient(0, top, 0, top + sombraAlto);
    shade.addColorStop(0, "rgba(2,8,14,.52)");
    shade.addColorStop(.5, "rgba(2,8,14,.20)");
    shade.addColorStop(1, "rgba(2,8,14,0)");
    layer.fillStyle = shade;
    layer.fillRect(centerX - 200 * scale, top - 2 * scale, 400 * scale, sombraAlto + 2 * scale);

    // Arcada inferior: apenas un filo claro, y sólo en aperturas amplias.
    const lowerTeeth = clamp((field.open - .45) / .4) * (1 - field.round * .8) * .30;
    if (lowerTeeth > .01) {
      layer.beginPath();
      for (const [x, y] of bottomPoints) layer.lineTo(x, y);
      for (let index = bottomPoints.length - 1; index >= 0; index -= 1) {
        const u = -1 + (2 * index) / CAVITY_STEPS;
        const band = Math.min(field.gap(u) * .22, 3.2 * scale);
        layer.lineTo(bottomPoints[index][0], bottomPoints[index][1] - band * envelope(u * .8));
      }
      layer.closePath();
      layer.fillStyle = `rgba(196,222,238,${lowerTeeth})`;
      layer.fill();
    }

    // Las comisuras conservan siempre penumbra: evita el aspecto de recorte.
    const corners = layer.createLinearGradient(
      lx(field.edgeX(-1)), 0, lx(field.edgeX(1)), 0
    );
    corners.addColorStop(0, "rgba(0,0,0,.6)");
    corners.addColorStop(.22, "rgba(0,0,0,0)");
    corners.addColorStop(.78, "rgba(0,0,0,0)");
    corners.addColorStop(1, "rgba(0,0,0,.6)");
    layer.fillStyle = corners;
    layer.fillRect(centerX - 200 * scale, top - 4 * scale, 400 * scale, height + 8 * scale);
    layer.restore();

    this.#drawLipSeam(layer, field, lx, ly, scale);
  }

  // La arcada se dibuja como una sola silueta con todas las piezas dentro.
  //
  // Difuminar cada diente por separado parecía lo natural, pero no lo es: dos
  // bordes contiguos con desenfoque se componen al 75% y dejan una costura
  // oscura entre piezas, de modo que la dentadura se lee como una fila de
  // azulejos. Con un único trazado el desenfoque suaviza el contorno y las
  // separaciones por igual, sin costuras.
  #drawArch(layer, field, lx, ly, scale, alpha) {
    const trazar = () => {
      layer.beginPath();
      for (const diente of TEETH) this.#toothPath(layer, field, lx, ly, scale, diente);
    };

    const arriba = ly(field.upperEdge(0) + Math.min(field.gap(0) * .10, .5));
    const alto = CROWN_HEIGHT * scale;

    layer.save();
    // Un desenfoque mínimo quita el canto de recorte: sin él el esmalte parece
    // una calcomanía sobre la cavidad.
    layer.filter = `blur(${(.55 * scale).toFixed(2)}px)`;
    trazar();
    const esmalte = layer.createLinearGradient(0, arriba, 0, arriba + alto);
    esmalte.addColorStop(0, `rgba(186,216,234,${alpha * .80})`);
    esmalte.addColorStop(.30, `rgba(230,246,253,${alpha * .97})`);
    esmalte.addColorStop(.78, `rgba(198,226,242,${alpha * .92})`);
    esmalte.addColorStop(1, `rgba(142,176,199,${alpha * .78})`);
    layer.fillStyle = esmalte;
    layer.fill();
    layer.filter = "none";

    // Profundidad: el esmalte se apaga hacia el fondo de la arcada, donde la
    // pieza queda de canto y recibe mucha menos luz.
    const centro = lx(field.cx);
    const media = lx(field.edgeX(.78)) - centro;
    const fondo = layer.createLinearGradient(centro - media, 0, centro + media, 0);
    fondo.addColorStop(0, "rgba(4,10,16,.86)");
    fondo.addColorStop(.30, "rgba(4,10,16,.16)");
    fondo.addColorStop(.5, "rgba(4,10,16,0)");
    fondo.addColorStop(.70, "rgba(4,10,16,.16)");
    fondo.addColorStop(1, "rgba(4,10,16,.86)");
    trazar();
    layer.clip();
    layer.fillStyle = fondo;
    layer.fillRect(centro - 200 * scale, arriba - 4 * scale, 400 * scale, alto + 8 * scale);
    layer.restore();
  }

  // Contorno de una pieza: borde superior pegado al labio y borde incisal con
  // las esquinas redondeadas.
  #toothPath(layer, field, lx, ly, scale, diente) {
    // Los incisivos arrancan pegados al borde del labio. Antes quedaba entre
    // ambos una franja de cavidad que se leía como una raya negra; ahora la
    // sombra del labio se pinta *encima* del esmalte, que es donde cae en un
    // rostro real.
    const bandaDe = u => Math.min(field.gap(u) * .10, .5);
    const coronaDe = u => Math.min(
      field.gap(u) - bandaDe(u),
      CROWN_HEIGHT * (.22 + .78 * envelope(u * .80)) * diente.len
    );

    const izquierda = diente.c - diente.w;
    const derecha = diente.c + diente.w;
    if (coronaDe(diente.c) < .6) return;

    const arriba = u => ly(field.upperEdge(u) + bandaDe(u));
    const abajo = u => ly(field.upperEdge(u) + bandaDe(u) + Math.max(0, coronaDe(u)));
    // Redondeo del borde incisal, proporcional al ancho de la pieza: los
    // premolares son estrechos y no admiten el mismo radio que un central.
    const radio = Math.min(1.8, diente.w * 17) * scale;

    const pasos = 6;
    for (let i = 0; i <= pasos; i += 1) {
      const u = izquierda + (derecha - izquierda) * (i / pasos);
      const x = lx(field.edgeX(u));
      if (i === 0) layer.moveTo(x, arriba(u));
      else layer.lineTo(x, arriba(u));
    }
    const xDerecha = lx(field.edgeX(derecha));
    const xIzquierda = lx(field.edgeX(izquierda));
    layer.lineTo(xDerecha, abajo(derecha) - radio);
    layer.quadraticCurveTo(xDerecha, abajo(derecha), xDerecha - radio, abajo(derecha));
    if (diente.punta) {
      // El canino baja en vértice hacia la línea media.
      const xMedio = lx(field.edgeX(diente.c));
      layer.lineTo(xMedio, abajo(diente.c) + .9 * scale);
    }
    layer.lineTo(xIzquierda + radio, abajo(izquierda));
    layer.quadraticCurveTo(xIzquierda, abajo(izquierda), xIzquierda, abajo(izquierda) - radio);
    layer.closePath();
  }

  // Línea de contacto: sólo aparece cuando los labios están juntos o apretados.
  #drawLipSeam(layer, field, lx, ly, scale) {
    const strength = clamp(field.press * 1.1 + (1 - clamp(field.open * 6)) * .35);
    if (strength < .05) return;
    layer.save();
    layer.strokeStyle = `rgba(4,10,16,${.42 * strength})`;
    layer.lineWidth = Math.max(.6, (.9 + field.press * .7) * scale);
    layer.beginPath();
    for (let index = 0; index <= CAVITY_STEPS; index += 1) {
      const u = -1 + (2 * index) / CAVITY_STEPS;
      const x = lx(field.edgeX(u));
      const y = ly((field.upperEdge(u) + field.lowerEdge(u)) / 2);
      if (index === 0) layer.moveTo(x, y);
      else layer.lineTo(x, y);
    }
    layer.stroke();
    layer.restore();
  }
}
