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

    const mkEQ = () => {
      const eqPreGain = this.ctx.createGain(); // knob "Gain" en dB → lineal
      const low = this.ctx.createBiquadFilter(); // low-shelf 100 Hz
      const mid = this.ctx.createBiquadFilter(); // peaking 1 kHz
      const high = this.ctx.createBiquadFilter(); // high-shelf 10 kHz
      const filter = this.ctx.createBiquadFilter(); // filtro DJ LPF↔HPF

      low.type = "lowshelf";
      low.frequency.value = 100;

      mid.type = "peaking";
      mid.frequency.value = 1000;
      mid.Q.value = 0.7;

      high.type = "highshelf";
      high.frequency.value = 10000;

      // bypass: peaking con ganancia 0 es transparente
      filter.type = "peaking";
      filter.frequency.value = 1000;
      filter.gain.value = 0;

      return { eqPreGain, low, mid, high, filter };
    };

    this.deckA = {
      media: null,
      mediaEl: null,
      // EQ
      ...mkEQ(),
      // Fader y mezcla
      preGain: this.ctx.createGain(), // volumen del deck (slider)
      xfGain: this.ctx.createGain(), // coeficiente del crossfader
      // Salida del canal: el punto que se engancha al master o a la salida
      // dedicada del deck (setDeckOutput). Ganancia 1: no toca la señal.
      out: this.ctx.createGain(),
      meter: this.ctx.createAnalyser(), // VU del canal (pre-fader)
      cueGain: this.ctx.createGain(), // envío a auriculares (PFL)
    };

    this.deckB = {
      media: null,
      mediaEl: null,
      ...mkEQ(),
      preGain: this.ctx.createGain(),
      xfGain: this.ctx.createGain(),
      out: this.ctx.createGain(),
      meter: this.ctx.createAnalyser(),
      cueGain: this.ctx.createGain(),
    };

    this.deckA.cueGain.gain.value = 0;
    this.deckB.cueGain.gain.value = 0;

    // Conexiones por deck (A)
    this.deckA.eqPreGain.connect(this.deckA.low);
    this.deckA.low.connect(this.deckA.mid);
    this.deckA.mid.connect(this.deckA.high);
    this.deckA.high.connect(this.deckA.filter);
    this.deckA.filter.connect(this.deckA.preGain);
    this.deckA.preGain.connect(this.deckA.xfGain);
    this.deckA.xfGain.connect(this.deckA.out);
    this.deckA.out.connect(this.masterGain);
    this.deckA.filter.connect(this.deckA.cueGain); // PFL pre-fader, post-EQ/filtro
    this.deckA.cueGain.connect(this.cueBus);
    this.deckA.filter.connect(this.deckA.meter); // VU del canal: mismo punto que el PFL

    // Conexiones por deck (B)
    this.deckB.eqPreGain.connect(this.deckB.low);
    this.deckB.low.connect(this.deckB.mid);
    this.deckB.mid.connect(this.deckB.high);
    this.deckB.high.connect(this.deckB.filter);
    this.deckB.filter.connect(this.deckB.preGain);
    this.deckB.preGain.connect(this.deckB.xfGain);
    this.deckB.xfGain.connect(this.deckB.out);
    this.deckB.out.connect(this.masterGain);
    this.deckB.filter.connect(this.deckB.cueGain);
    this.deckB.cueGain.connect(this.cueBus);
    this.deckB.filter.connect(this.deckB.meter);

    // Los medidores leen la onda cruda (getFloatTimeDomainData no usa el
    // suavizado), con ventana de 2048 muestras para no perderse picos cortos
    [this.deckA.meter, this.deckB.meter].forEach((a) => {
      a.fftSize = 2048;
    });
  }

  // Analizador para los VU. "A"/"B" = canal post-EQ y pre-fader (como el PFL,
  // así el nivel del canal no depende del fader ni del crossfader);
  // cualquier otra cosa = salida real del master (post-limitador).
  getMeterAnalyser(which) {
    if (which === "A") return this.deckA.meter;
    if (which === "B") return this.deckB.meter;
    return this.masterMeter;
  }

  resume() {
    if (this.ctx.state === "suspended") return this.ctx.resume();
  }

  // Conectar <audio> de cada deck al grafo
  attachMediaElement(which, el) {
    const deck = which === "A" ? this.deckA : this.deckB;
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
    const deck = which === "A" ? this.deckA : this.deckB;
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
    const deck = which === "A" ? this.deckA : this.deckB;
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
    const deck = which === "A" ? this.deckA : this.deckB;
    return this._ensureDirectDest(deck).stream;
  }

  // === Filtro DJ por deck: un solo control LPF↔HPF ===
  // v ∈ [-1, 1]: negativo = lowpass (barre hacia graves), 0 = off,
  // positivo = highpass (barre hacia agudos)
  setDeckFilter(which, v) {
    const deck = which === "A" ? this.deckA : this.deckB;
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
    const deck = which === "A" ? this.deckA : this.deckB;
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
    const d = which === "A" ? this.deckA : this.deckB;

    // === AUTO-TRIM SUAVE (mantenemos la idea, pero sin rampas) ===
    const boostSum = [low, mid, high].reduce(
      (acc, v) => acc + Math.max(0, v),
      0
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
