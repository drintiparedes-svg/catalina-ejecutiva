// Calibración de la apertura de boca.
//
// Estos cinco valores gobiernan cuánto se abre la boca con voz real. Viven
// juntos y son mutables a propósito: el banco de pruebas (/banco.html) los
// mueve en vivo con deslizadores, así se afina mirando la cara en vez de
// recompilando a ciegas. Los módulos los leen en cada cuadro, nunca los copian
// a una constante local.
//
// El recorrido de la señal es:
//
//   F1 (Hz) --f1Closed/f1Open--> apertura 0..1 --openGain--> mouth.open
//   mouth.open --jawTravel/lipEvert--> píxeles de la imagen
//
// Los dos primeros son percepción (qué tan abierta *suena* la voz); los dos
// últimos son geometría (cuántos píxeles se mueve el mentón y el labio).

export const TUNING = {
  // Formante F1 que se lee como boca cerrada y como boca abierta del todo.
  // Acortar la distancia entre ambos abre más la boca con la misma voz.
  //
  // Distribución real medida sobre la voz de la API: p25≈360, mediana≈418,
  // p75≈500, máx≈786. Con f1Open=620 la mediana caía en 0,29 y la boca pasaba
  // la mayor parte del tiempo casi cerrada; a 560 la misma voz da 0,37.
  f1Closed: 335,
  f1Open: 560,

  // Ganancia sobre la apertura ya normalizada. Es el mando grueso: 1 deja la
  // calibración de formantes tal cual, 1,3 abre un tercio más.
  openGain: 1.32,

  // Geometría, en píxeles de la imagen original (1408×768).
  jawTravel: 18,   // recorrido máximo del mentón
  lipEvert: 9.5    // apertura extra del labio inferior sobre la mandíbula
};
