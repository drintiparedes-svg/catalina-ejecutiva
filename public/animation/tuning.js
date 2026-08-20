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
  lipEvert: 9.5,   // apertura extra del labio inferior sobre la mandíbula

  // Respiración nasal basal.
  //
  // El recorrido es diminuto a propósito. El ala mide unos 76 px de lado a
  // lado para una nariz de ~40 mm, así que un píxel son más o menos medio
  // milímetro. La excursión del ala en respiración tranquila es de décimas de
  // milímetro: pasado de ahí deja de ser ventilación y parece aleteo nasal,
  // que es signo de trabajo respiratorio.
  nasalApertura: 1.6,    // px que se separa el borde alar del eje, en el máximo
  nasalDescenso: .35,    // parte de ese recorrido que va hacia abajo
  nasalRelieve: .05,     // realce de luz del ala al abrirse, da sensación de volumen
  // La anatomía real no es simétrica. Se aplica una diferencia fija entre
  // lados, nunca una alternancia visible: el ciclo nasal existe, pero verlo
  // alternar en pantalla parecería un fallo.
  nasalAsimetria: .94,

  // Brisa en la cabellera.
  //
  // Lo que distingue una brisa de un limpiaparabrisas no es la amplitud sino
  // el retardo: en el pelo real la ráfaga viaja desde el nacimiento hacia las
  // puntas, así que cada franja va un poco por detrás de la de encima. Con
  // retardo 0 el mechón entero bascula a la vez y se ve artificial por mucho
  // que se baje la amplitud.
  brisaAmplitud: 7,      // px que se desplaza la punta en una ráfaga fuerte
  brisaVelocidad: .16,   // cada cuánto cambia el aire; bajo es aire lento
  brisaRetardo: 1.35,    // cuánto tarda la onda en bajar de la raíz a la punta
  brisaElevacion: .22    // parte del recorrido lateral que sube: al oscilar,
                         // la punta describe un arco, no una recta
};
