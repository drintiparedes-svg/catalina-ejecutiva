// Lienzos auxiliares fuera de pantalla. Se usan para componer una región del
// rostro y fundirla con una máscara suave, de modo que ningún recorte deje un
// borde duro sobre la piel.
//
// La fábrica se puede sustituir (`createSurface`) para renderizar el mismo
// código en Node con @napi-rs/canvas y revisar el resultado sin abrir el
// navegador.

export function createSurface(width, height) {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  throw new Error("No hay un lienzo disponible para componer el rostro");
}

export class Surface {
  #createSurface;

  constructor(createSurfaceImpl = createSurface) {
    this.#createSurface = createSurfaceImpl;
    this.canvas = null;
    this.ctx = null;
    this.width = 0;
    this.height = 0;
  }

  // Devuelve el contexto listo para dibujar en coordenadas CSS: el escalado
  // por densidad de píxeles ya está aplicado y el lienzo viene limpio.
  acquire(cssWidth, cssHeight, pixelRatio) {
    const width = Math.max(1, Math.ceil(cssWidth * pixelRatio));
    const height = Math.max(1, Math.ceil(cssHeight * pixelRatio));
    if (!this.canvas || this.width !== width || this.height !== height) {
      this.canvas = this.#createSurface(width, height);
      this.ctx = this.canvas.getContext("2d");
      this.width = width;
      this.height = height;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    return ctx;
  }

  // Recorta el contenido con un degradado radial elíptico: opaco en el núcleo y
  // desvanecido en el borde. Sin esto, cada parche movido dejaría un óvalo
  // visible sobre la mejilla.
  feather(cssWidth, cssHeight, mask) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.translate(mask.centerX, mask.centerY);
    ctx.scale(1, mask.radiusY / mask.radiusX);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, mask.radiusX);
    gradient.addColorStop(0, "rgba(0,0,0,1)");
    gradient.addColorStop(mask.solid, "rgba(0,0,0,1)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    const reach = mask.radiusX * 1.02;
    ctx.fillRect(-reach, -reach, reach * 2, reach * 2);
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  blit(targetCtx, x, y, cssWidth, cssHeight) {
    if (!this.canvas) return;
    targetCtx.drawImage(this.canvas, 0, 0, this.width, this.height, x, y, cssWidth, cssHeight);
  }
}
