// Overlay widget: idle dot / live waveform / "…" transcribing indicator.
// Also owns microphone capture — audio is recorded here, downsampled to
// 16 kHz mono PCM, and handed to the main process when recording stops.
// Dragging is manual (pointer deltas -> window position) so a short click
// stays distinguishable from a drag: click toggles recording.
'use strict';

const { createApp, ref, onMounted, onUnmounted } = Vue;
const CH = window.susurro.channels;

const TARGET_RATE = 16000;
const DRAG_THRESHOLD_PX = 5;

// ---- audio capture --------------------------------------------------------

const capture = {
  ctx: null,
  stream: null,
  processor: null,
  source: null,
  chunks: [],
  level: 0,

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    this.ctx = new AudioContext({ sampleRate: TARGET_RATE });
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(input));
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      this.level = Math.sqrt(sum / input.length);
    };
    this.source.connect(this.processor);
    this.processor.connect(this.ctx.destination);
  },

  // Returns { pcm: ArrayBuffer (int16), sampleRate }
  async stop() {
    const sampleRate = this.ctx ? this.ctx.sampleRate : TARGET_RATE;
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.ctx) await this.ctx.close();

    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const pcm = new Int16Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      for (let i = 0; i < chunk.length; i++) {
        const s = Math.max(-1, Math.min(1, chunk[i]));
        pcm[offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
    }
    this.ctx = null;
    this.stream = null;
    this.processor = null;
    this.source = null;
    this.chunks = [];
    this.level = 0;
    return { pcm: pcm.buffer, sampleRate };
  },
};

// ---- component ------------------------------------------------------------

createApp({
  setup() {
    const state = ref('idle'); // idle | recording | transcribing
    const canvasEl = ref(null);
    const unsubs = [];
    let raf = 0;
    let phase = 0;
    const bars = new Array(24).fill(0.06);

    function draw() {
      const canvas = canvasEl.value;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = 108;
      const h = 26;
      if (canvas.width !== w * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      const g = canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      phase += 0.08;

      if (state.value === 'idle') {
        // quiet thin waveform outline
        g.strokeStyle = 'rgba(247, 243, 228, 0.45)';
        g.lineWidth = 1.5;
        g.beginPath();
        for (let x = 0; x <= w; x += 2) {
          const y = h / 2 + Math.sin(x / 14 + phase * 0.35) * 1.6;
          x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.stroke();
      } else if (state.value === 'recording') {
        // live level-driven bars in blush
        bars.shift();
        bars.push(Math.min(1, capture.level * 6 + 0.06));
        const bw = 3;
        const gap = (w - bars.length * bw) / (bars.length - 1);
        g.fillStyle = '#F2BEE0';
        bars.forEach((v, i) => {
          const bh = Math.max(2.5, v * (h - 4));
          const x = i * (bw + gap);
          const y = (h - bh) / 2;
          g.beginPath();
          g.roundRect(x, y, bw, bh, bw / 2);
          g.fill();
        });
      } else {
        // transcribing: three pulsing dots in amber
        g.fillStyle = '#E08A3E';
        for (let i = 0; i < 3; i++) {
          const pulse = (Math.sin(phase * 1.6 - i * 0.9) + 1) / 2;
          const r = 2.2 + pulse * 1.6;
          g.globalAlpha = 0.35 + pulse * 0.65;
          g.beginPath();
          g.arc(w / 2 + (i - 1) * 14, h / 2, r, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      }
      raf = requestAnimationFrame(draw);
    }

    // ---- drag vs click ----
    let dragging = null; // { startScreenX, startScreenY, winX, winY, moved }

    async function onPointerDown(e) {
      if (e.button !== 0) return;
      // Capture the pointer so a fast drag that briefly outruns the widget
      // still delivers move/up events to us instead of being dropped.
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
      const pos = await window.susurro.invoke(CH.OVERLAY_GET_POSITION);
      dragging = {
        pointerId: e.pointerId,
        startScreenX: e.screenX,
        startScreenY: e.screenY,
        winX: pos.x,
        winY: pos.y,
        moved: false,
      };
    }

    function onPointerMove(e) {
      if (!dragging) return;
      const dx = e.screenX - dragging.startScreenX;
      const dy = e.screenY - dragging.startScreenY;
      if (!dragging.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragging.moved = true;
      window.susurro.send(CH.OVERLAY_MOVE, { x: dragging.winX + dx, y: dragging.winY + dy });
    }

    function onPointerUp() {
      if (!dragging) return;
      const wasDrag = dragging.moved;
      dragging = null;
      if (wasDrag) {
        window.susurro.send(CH.OVERLAY_MOVE_END);
      } else {
        window.susurro.send(CH.RECORDING_TOGGLE); // plain click toggles
      }
    }

    // ---- capture control from main ----
    async function startCapture() {
      state.value = 'recording';
      try {
        await capture.start();
      } catch (err) {
        state.value = 'idle';
        window.susurro.send(CH.CAPTURE_ERROR, `Microphone unavailable: ${err.message}`);
      }
    }

    async function stopCapture() {
      state.value = 'transcribing';
      try {
        const { pcm, sampleRate } = await capture.stop();
        await window.susurro.invoke(CH.AUDIO_DATA, pcm, sampleRate);
      } catch (err) {
        window.susurro.send(CH.CAPTURE_ERROR, `Recording failed: ${err.message}`);
      }
    }

    onMounted(() => {
      unsubs.push(window.susurro.on(CH.CAPTURE_START, startCapture));
      unsubs.push(window.susurro.on(CH.CAPTURE_STOP, stopCapture));
      unsubs.push(window.susurro.on(CH.STATE_CHANGED, (s) => { state.value = s; }));
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      raf = requestAnimationFrame(draw);
    });

    onUnmounted(() => {
      unsubs.forEach((u) => u());
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    });

    return { state, canvasEl, onPointerDown };
  },

  template: `
    <div class="pill" :title="state === 'recording' ? 'Stop dictation' : 'Start dictation'"
         @pointerdown="onPointerDown">
      <canvas ref="canvasEl"></canvas>
    </div>
  `,
}).mount('#app');
