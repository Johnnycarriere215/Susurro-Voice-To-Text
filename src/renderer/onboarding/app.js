// Onboarding: (1) microphone permission, (2) text-injection permission /
// platform explanation, (3) Whisper model choice + download. No accounts.
'use strict';

const { createApp, ref, computed, onMounted, onUnmounted } = Vue;
const CH = window.susurro.channels;

const app = createApp({
  setup() {
    const step = ref(0);
    const platform = ref({ platform: 'linux', wayland: false, tools: {}, pythonFound: true });

    // step 1 — mic
    const micState = ref('idle'); // idle | asking | granted | denied

    // step 2 — injection permission
    const injState = ref('idle'); // idle | granted | denied

    // step 3 — models
    const models = ref([]);
    const selectedModel = ref('base');
    const download = ref(null); // { name, percent, error, done }
    const downloading = ref(false);

    let unsubProgress = null;

    onMounted(async () => {
      platform.value = await window.susurro.invoke(CH.PLATFORM_INFO);
      models.value = await window.susurro.invoke(CH.MODELS_LIST);
      unsubProgress = window.susurro.on(CH.MODELS_PROGRESS, (p) => {
        if (p.name !== selectedModel.value) return;
        download.value = p;
        if (p.done) downloading.value = false;
      });
    });
    onUnmounted(() => unsubProgress && unsubProgress());

    async function requestMic() {
      micState.value = 'asking';
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        micState.value = 'granted';
      } catch {
        micState.value = 'denied';
      }
    }

    async function requestInjection() {
      const res = await window.susurro.invoke(CH.PERM_ACCESSIBILITY);
      injState.value = res.granted ? 'granted' : 'denied';
    }

    const isMac = computed(() => platform.value.platform === 'darwin');
    const isWayland = computed(() => !!platform.value.wayland);
    const waylandHasTool = computed(
      () => platform.value.tools && (platform.value.tools.ydotool || platform.value.tools.wtype)
    );

    const selectedInstalled = computed(() =>
      models.value.some((m) => m.name === selectedModel.value && m.installed)
    );

    async function startDownload() {
      downloading.value = true;
      download.value = { name: selectedModel.value, percent: 0 };
      const res = await window.susurro.invoke(CH.MODELS_DOWNLOAD, selectedModel.value);
      downloading.value = false;
      models.value = await window.susurro.invoke(CH.MODELS_LIST);
      if (res.ok) {
        await window.susurro.invoke(CH.SETTINGS_SET, { model: selectedModel.value });
      }
    }

    function cancelDownload() {
      window.susurro.invoke(CH.MODELS_CANCEL, selectedModel.value);
    }

    const canContinue = computed(() => {
      if (step.value === 0) return micState.value === 'granted';
      if (step.value === 1) return true; // explanation-only step is skippable
      return selectedInstalled.value;
    });

    async function next() {
      if (step.value < 2) {
        step.value += 1;
        return;
      }
      await window.susurro.invoke(CH.SETTINGS_SET, { model: selectedModel.value });
      await window.susurro.invoke(CH.ONBOARDING_DONE);
    }

    function back() {
      if (step.value > 0) step.value -= 1;
    }

    return {
      step, micState, injState, models, selectedModel, download, downloading,
      isMac, isWayland, waylandHasTool, selectedInstalled, canContinue,
      requestMic, requestInjection, startDownload, cancelDownload, next, back,
      platform,
    };
  },

  template: `
  <div class="onboarding">
    <div class="steps">
      <div v-for="i in 3" :key="i" class="step-dot"
           :class="{ active: step === i - 1, done: step > i - 1 }"></div>
    </div>

    <!-- Step 1: microphone -->
    <div class="step-body" v-if="step === 0">
      <h1>Your voice stays here.</h1>
      <p class="lead">
        Susurro listens only while you dictate, transcribes on this computer,
        and never uploads a single byte. First, it needs to hear you.
      </p>
      <button class="btn btn-primary" @click="requestMic" :disabled="micState === 'granted'">
        {{ micState === 'granted' ? 'Microphone ready' : 'Allow microphone access' }}
      </button>
      <div class="status-line" v-if="micState === 'granted'">
        <span class="ok">✓</span> Microphone access granted.
      </div>
      <div class="status-line" v-if="micState === 'denied'">
        <span class="muted">Access was blocked. Enable the microphone for Susurro in your
        system privacy settings, then try again.</span>
      </div>
    </div>

    <!-- Step 2: injection permission -->
    <div class="step-body" v-if="step === 1">
      <h1>Typing where you look.</h1>
      <template v-if="isMac">
        <p class="lead">
          To type your words into other apps, macOS requires Accessibility
          permission. You'll see a system prompt — check Susurro in the list.
        </p>
        <button class="btn btn-primary" @click="requestInjection" :disabled="injState === 'granted'">
          {{ injState === 'granted' ? 'Accessibility granted' : 'Request Accessibility access' }}
        </button>
        <div class="status-line" v-if="injState === 'granted'">
          <span class="ok">✓</span> Susurro can now type into any app.
        </div>
        <div class="status-line" v-if="injState === 'denied'">
          <span class="muted">Not granted yet — open System Settings → Privacy &amp; Security →
          Accessibility and enable Susurro, then continue.</span>
        </div>
      </template>
      <template v-else-if="isWayland">
        <p class="lead" v-if="waylandHasTool">
          You're on a Wayland session and a typing helper
          ({{ platform.tools.ydotool ? 'ydotool' : 'wtype' }}) was found —
          Susurro will type directly into your apps. Nothing more to set up.
        </p>
        <p class="lead" v-else>
          You're on a Wayland session. Wayland deliberately blocks apps from
          simulating keystrokes, so Susurro will copy your words to the
          clipboard and paste them instead. Installing <b>ydotool</b> (and its
          daemon) later enables direct typing — Susurro will pick it up
          automatically.
        </p>
      </template>
      <template v-else>
        <p class="lead">
          No extra permission is needed on this system — Susurro can simulate
          keystrokes directly. You're all set.
        </p>
      </template>
    </div>

    <!-- Step 3: model -->
    <div class="step-body" v-if="step === 2">
      <h1>Pick your ears.</h1>
      <p class="lead">
        Susurro uses a Whisper speech model that runs on your machine. This is
        the only download the app will ever make.
      </p>
      <div v-for="m in models" :key="m.name" class="model-option"
           :class="{ selected: selectedModel === m.name }"
           @click="!downloading && (selectedModel = m.name)">
        <div class="meta">
          <div class="name">{{ m.label }}
            <span class="badge" v-if="m.installed">installed</span>
          </div>
          <div class="note">{{ m.note }}</div>
        </div>
        <span class="badge accent">{{ m.downloadLabel }}</span>
      </div>

      <div class="download-box" v-if="!selectedInstalled">
        <template v-if="downloading">
          <div class="row" style="margin-bottom: 8px;">
            <span class="small muted">Downloading {{ selectedModel }}…
              <span class="pct">{{ download?.percent ?? 0 }}%</span></span>
            <button class="btn" @click="cancelDownload">Cancel</button>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: (download?.percent ?? 0) + '%' }"></div>
          </div>
        </template>
        <template v-else>
          <button class="btn btn-primary" @click="startDownload">Download model</button>
          <span class="small muted" v-if="download?.error" style="display:block; margin-top:8px;">
            Download failed: {{ download.error }} — check your connection and retry.
          </span>
        </template>
      </div>
    </div>

    <div class="footer">
      <span class="privacy-note">No account. No cloud. Ever.</span>
      <div style="display:flex; gap:10px;">
        <button class="btn" v-if="step > 0" @click="back">Back</button>
        <button class="btn btn-primary" :disabled="!canContinue" @click="next">
          {{ step === 2 ? 'Start dictating' : 'Continue' }}
        </button>
      </div>
    </div>
  </div>
  `,
});

app.mount('#app');
