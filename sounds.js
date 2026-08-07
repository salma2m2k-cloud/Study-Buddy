/* =========================================================
   STUDY BUDDY — STUDY SOUNDS
   ---------------------------------------------------------
   HONESTY NOTE: we do not ship third-party mp3 audio (that
   would either bloat the repo or silently 404 as fake asset
   links). Instead, the built-in ambient tracks are generated
   live in the browser with the Web Audio API — this is REAL
   working audio, not a placeholder. "Upload your own sound"
   uses the real File API to play any audio file from disk.
   ========================================================= */

const Sounds = (() => {
  let ctx = null;
  let masterGain = null;
  let currentNodes = []; // active WebAudio nodes for the generated ambience
  let currentKind = null;
  let uploadedAudioEl = null;
  let volume = 0.5;

  const PRESETS = [
    { id: "rain", label: "Rain", emoji: "🌧️" },
    { id: "cafe", label: "Café", emoji: "☕" },
    { id: "ocean", label: "Ocean", emoji: "🌊" },
    { id: "fireplace", label: "Fireplace", emoji: "🔥" },
    { id: "forest", label: "Forest", emoji: "🌲" },
    { id: "ambient", label: "Ambient", emoji: "🌌" },
    { id: "lofi", label: "Lo-fi pulse", emoji: "🎧" },
  ];

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function makeNoiseBuffer(kind) {
    const bufferSize = 2 * ctx.sampleRate;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    if (kind === "white") {
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    } else {
      // brown noise (deeper, used for rain/ocean/fireplace/forest base)
      let last = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }
    }
    return buffer;
  }

  function stopGenerated() {
    currentNodes.forEach((n) => {
      try {
        n.stop && n.stop();
      } catch (e) {}
      try {
        n.disconnect && n.disconnect();
      } catch (e) {}
    });
    currentNodes = [];
  }

  function playGenerated(kind) {
    ensureCtx();
    stopGenerated();

    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(kind === "lofi" || kind === "ambient" ? "white" : "brown");
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    switch (kind) {
      case "rain":
        filter.type = "highpass";
        filter.frequency.value = 700;
        gain.gain.value = 0.5;
        break;
      case "cafe":
        filter.type = "bandpass";
        filter.frequency.value = 900;
        filter.Q.value = 0.6;
        gain.gain.value = 0.35;
        break;
      case "ocean":
        filter.type = "lowpass";
        filter.frequency.value = 500;
        gain.gain.value = 0.55;
        // slow amplitude swell to feel like waves
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.value = 0.12;
        lfoGain.gain.value = 0.25;
        lfo.connect(lfoGain);
        lfoGain.connect(gain.gain);
        lfo.start();
        currentNodes.push(lfo, lfoGain);
        break;
      case "fireplace":
        filter.type = "lowpass";
        filter.frequency.value = 380;
        gain.gain.value = 0.6;
        break;
      case "forest":
        filter.type = "bandpass";
        filter.frequency.value = 1200;
        filter.Q.value = 0.4;
        gain.gain.value = 0.3;
        break;
      case "ambient":
        filter.type = "lowpass";
        filter.frequency.value = 900;
        gain.gain.value = 0.25;
        break;
      case "lofi":
        filter.type = "lowpass";
        filter.frequency.value = 1200;
        gain.gain.value = 0.2;
        break;
      default:
        filter.type = "lowpass";
        filter.frequency.value = 800;
        gain.gain.value = 0.4;
    }

    src.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    src.start();

    currentNodes.push(src, filter, gain);
    currentKind = kind;
  }

  function stopUploaded() {
    if (uploadedAudioEl) {
      uploadedAudioEl.pause();
      uploadedAudioEl.currentTime = 0;
    }
  }

  function playUploaded(file) {
    stopAll();
    const url = URL.createObjectURL(file);
    uploadedAudioEl = new Audio(url);
    uploadedAudioEl.loop = true;
    uploadedAudioEl.volume = volume;
    uploadedAudioEl.play().catch((e) => console.warn("Could not play uploaded audio:", e));
    currentKind = "uploaded:" + file.name;
    return uploadedAudioEl;
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (masterGain) masterGain.gain.value = volume;
    if (uploadedAudioEl) uploadedAudioEl.volume = volume;
  }

  function stopAll() {
    stopGenerated();
    stopUploaded();
    currentKind = null;
  }

  function isPlaying() {
    return !!currentKind;
  }

  function nowPlaying() {
    return currentKind;
  }

  return { PRESETS, playGenerated, playUploaded, stopAll, setVolume, isPlaying, nowPlaying };
})();

window.Sounds = Sounds;
