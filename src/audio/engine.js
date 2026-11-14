import { dbToGain } from "./dsp";

export class AudioEngine {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    // Master (único)
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1;

    // Ruteo final (sin duplicados, sin conexiones huérfanas):
    // decks -> masterGain -> limitador -> destination (+ medidor y grabación)
    //
    // Aquí hubo un auto-nivel (AGC) dinámico del master con su trim y su
    // analizador. Se quitó porque subía el nivel en las partes flojas y lo
    // bajaba al entrar el groove: la nivelación es ahora la ganancia estática
    // por pista que se calcula una vez al cargar (utils.js).
    //
    // Limitador de seguridad: atrapa los picos antes de la salida para que
    // el mix nunca clipee (es lo que se oía como distorsión con auto-gain)
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.05;

    // Medidor del master: cuelga DESPUÉS del limitador, así que mide la
    // señal que sale de verdad por la tarjeta (con el recorte del limitador
    // ya aplicado).
    this.masterMeter = this.ctx.createAnalyser();
    this.masterMeter.fftSize = 2048; // ~43 ms: ventanas solapadas a 30 fps

    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);
    this.limiter.connect(this.masterMeter);

    // Stream del master para grabar la sesión (MediaRecorder)
    this.recordDest = this.ctx.createMediaStreamDestination();
    this.limiter.connect(this.recordDest);

    // Bus de pre-escucha (PFL): tap post-EQ / pre-fader de cada deck
    // -> cueGain (on/off) -> cueBus (volumen auriculares) -> stream
    this.cueBus = this.ctx.createGain();
    this.cueBus.gain.value = 1;
    this.cueDest = this.ctx.createMediaStreamDestination();
    this.cueBus.connect(this.cueDest);

    this.deckA = this._buildDeck();
    this.deckB = this._buildDeck();
  }

  // Monta y cablea un canal: EQ → filtro DJ → fader → crossfader → salida
  // del canal → master, con el PFL y el medidor colgando después del filtro
  // (post-EQ, pre-fader). Los dos decks son idénticos.
  _buildDeck() {
    const ctx = this.ctx;
    const deck = {
      media: null,
      mediaEl: null,
      // EQ
      eqPreGain: ctx.createGain(), // knob "Gain" en dB → lineal
      low: ctx.createBiquadFilter(), // low-shelf 100 Hz
      mid: ctx.createBiquadFilter(), // peaking 1 kHz
      high: ctx.createBiquadFilter(), // high-shelf 10 kHz
      filter: ctx.createBiquadFilter(), // filtro DJ LPF↔HPF
      // Fader y mezcla
      preGain: ctx.createGain(), // volumen del deck (slider)
      xfGain: ctx.createGain(), // coeficiente del crossfader
      // Salida del canal: el punto que se engancha al master o a la salida
      // dedicada del deck (setDeckOutput). Ganancia 1: no toca la señal.
      out: ctx.createGain(),
      meter: ctx.createAnalyser(), // VU del canal (pre-fader)
      cueGain: ctx.createGain(), // envío a auriculares (PFL)
    };

    deck.low.type = "lowshelf";
    deck.low.frequency.value = 100;

    deck.mid.type = "peaking";
    deck.mid.frequency.value = 1000;
    deck.mid.Q.value = 0.7;

    deck.high.type = "highshelf";
    deck.high.frequency.value = 10000;

    // bypass: peaking con ganancia 0 es transparente
    deck.filter.type = "peaking";
    deck.filter.frequency.value = 1000;
    deck.filter.gain.value = 0;

    deck.cueGain.gain.value = 0;

    // Los medidores leen la onda cruda (getFloatTimeDomainData no usa el
    // suavizado), con ventana de 2048 muestras para no perderse picos cortos
    deck.meter.fftSize = 2048;

    deck.eqPreGain.connect(deck.low);
    deck.low.connect(deck.mid);
    deck.mid.connect(deck.high);
    deck.high.connect(deck.filter);
    deck.filter.connect(deck.preGain);
    deck.preGain.connect(deck.xfGain);
    deck.xfGain.connect(deck.out);
    deck.out.connect(this.masterGain);
    deck.filter.connect(deck.cueGain); // PFL pre-fader, post-EQ/filtro
    deck.cueGain.connect(this.cueBus);
    deck.filter.connect(deck.meter); // VU del canal: mismo punto que el PFL
    return deck;
  }

  _deck(which) {
    return which === "A" ? this.deckA : this.deckB;
  }

  // Analizador para los VU. "A"/"B" = canal post-EQ y pre-fader (como el PFL,
  // así el nivel del canal no depende del fader ni del crossfader);
  // cualquier otra cosa = salida real del master (post-limitador).
  getMeterAnalyser(which) {
    if (which === "A" || which === "B") return this._deck(which).meter;
    return this.masterMeter;
  }

  resume() {
    if (this.ctx.state === "suspended") return this.ctx.resume();
  }

  // Conectar <audio> de cada deck al grafo
  attachMediaElement(which, el) {
    const deck = this._deck(which);
    if (deck.mediaEl === el && deck.media) return;
    if (deck.media && deck.mediaEl && deck.mediaEl !== el) {
      try {
        deck.media.disconnect();
      } catch {
        // ignorar
      }
      deck.media = null;
    }

    deck.mediaEl = el;
    deck.media = this.ctx.createMediaElementSource(el);
    deck.media.connect(deck.eqPreGain); // ← ahora entra por el bloque de EQ
  }

  setDeckVolume(which, vol) {
    const deck = this._deck(which);
    deck.preGain.gain.value = vol;
  }

  setMaster(vol) {
    this.masterGain.gain.value = vol;
  }

  // === Ruteo de salidas (config multi-tarjeta) ===
  // Cambia el dispositivo de salida del mix master (Chrome 110+)
  setMasterSink(deviceId) {
    if (typeof this.ctx.setSinkId !== "function") {
      return Promise.reject(new Error("AudioContext.setSinkId no soportado"));
    }
    return this.ctx.setSinkId(deviceId || "");
  }

  _ensureDirectDest(deck) {
    if (!deck.directDest) {
      deck.directDest = this.ctx.createMediaStreamDestination();
    }
    return deck.directDest;
  }

  // direct=true saca el deck por su propio stream (salida dedicada)
  // en vez de por el master (modo mezcla externa)
  setDeckOutput(which, direct) {
    const deck = this._deck(which);
    this._ensureDirectDest(deck);
    try {
      deck.out.disconnect();
    } catch {
      // sin conexiones previas
    }
    if (direct) deck.out.connect(deck.directDest);
    else deck.out.connect(this.masterGain);
  }

  getDeckStream(which) {
    const deck = this._deck(which);
    return this._ensureDirectDest(deck).stream;
  }

  // === Filtro DJ por deck: un solo control LPF↔HPF ===
  // v ∈ [-1, 1]: negativo = lowpass (barre hacia graves), 0 = off,
  // positivo = highpass (barre hacia agudos)
  setDeckFilter(which, v) {
    const deck = this._deck(which);
    const f = deck.filter;
    if (Math.abs(v) < 0.05) {
      f.type = "peaking";
      f.gain.value = 0; // transparente
      return;
    }
    f.Q.value = 1.2; // algo de resonancia, tacto de mesa DJ
    if (v < 0) {
      f.type = "lowpass";
      f.frequency.value = 20000 * Math.pow(80 / 20000, -v); // 20k → 80 Hz
    } else {
      f.type = "highpass";
      f.frequency.value = 20 * Math.pow(8000 / 20, v); // 20 → 8k Hz
    }
  }

  // === PFL / pre-escucha por auriculares ===
  setDeckCue(which, on) {
    const deck = this._deck(which);
    deck.cueGain.gain.value = on ? 1 : 0;
  }

  setCueVolume(vol) {
    this.cueBus.gain.value = vol;
  }

  getCueStream() {
    return this.cueDest.stream;
  }

  // Stream del mix master (para MediaRecorder)
  getRecordStream() {
    return this.recordDest.stream;
  }

  // Crossfader "dipless" estilo mesa DJ (x∈[0,1], 0=A, 1=B):
  // cada deck va a tope en su mitad; del centro hacia un lado solo se
  // atenúa el canal contrario (nunca sube el propio)
  setCrossfader(x) {
    const tA = Math.min(1, Math.max(0, (x - 0.5) * 2)); // cuánto se aleja hacia B
    const tB = Math.min(1, Math.max(0, (0.5 - x) * 2)); // cuánto se aleja hacia A
    this.deckA.xfGain.gain.value = Math.cos(tA * Math.PI * 0.5);
    this.deckB.xfGain.gain.value = Math.cos(tB * Math.PI * 0.5);
  }

  // Aplicar EQ por deck: {gain, low, mid, high} en dB
  setDeckEQ(which, { gain = 0, low = 0, mid = 0, high = 0 } = {}) {
    const d = this._deck(which);

    // === AUTO-TRIM SUAVE (mantenemos la idea, pero sin rampas) ===
    const boostSum = [low, mid, high].reduce(
      (acc, v) => acc + Math.max(0, v),
      0,
    );
    // cuando supera ~9 dB combinados, restamos un poco al pre-gain
    const trimDb = boostSum > 9 ? -(boostSum - 9) * 0.4 : 0;
    const effectiveGainDb = gain + trimDb;

    const target = dbToGain(effectiveGainDb);

    // 👉 Cambio importante: nada de cancelScheduledValues ni linearRamp
    // Ajuste directo, súper barato:
    d.eqPreGain.gain.value = target;

    // filtros EQ (esto ya era “gratis”)
    d.low.gain.value = low;
    d.mid.gain.value = mid;
    d.high.gain.value = high;
  }
}
