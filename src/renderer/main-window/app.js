// Main window: current model, hotkey, injection method, Ollama toggle,
// and the local-only history of the last 50 transcriptions.
'use strict';

const { createApp, ref, computed, onMounted, onUnmounted } = Vue;
const CH = window.susurro.channels;

const METHOD_LABELS = {
  keystroke: 'Simulated keystrokes',
  clipboard: 'Clipboard paste',
};

createApp({
  setup() {
    const settings = ref({});
    const models = ref([]);
    const historyItems = ref([]);
    const injInfo = ref(null);
    const ollamaStatus = ref({ running: false, models: [] });
    const dictState = ref('idle');
    const lastError = ref(null);

    const unsubs = [];

    async function refresh() {
      settings.value = await window.susurro.invoke(CH.SETTINGS_GET);
      models.value = await window.susurro.invoke(CH.MODELS_LIST);
      historyItems.value = await window.susurro.invoke(CH.HISTORY_LIST);
      injInfo.value = await window.susurro.invoke(CH.INJECTION_INFO);
      ollamaStatus.value = await window.susurro.invoke(CH.OLLAMA_STATUS);
    }

    onMounted(() => {
      refresh();
      unsubs.push(window.susurro.on(CH.SETTINGS_CHANGED, (s) => { settings.value = s; }));
      unsubs.push(window.susurro.on(CH.HISTORY_CHANGED, (items) => { historyItems.value = items; }));
      unsubs.push(window.susurro.on(CH.STATE_CHANGED, (s) => {
        dictState.value = s;
        if (s === 'recording') lastError.value = null;
      }));
      unsubs.push(window.susurro.on(CH.DICTATION_ERROR, (message) => { lastError.value = message; }));
    });
    onUnmounted(() => unsubs.forEach((u) => u()));

    const modelLabel = computed(() => {
      const m = models.value.find((x) => x.name === settings.value.model);
      return m ? `Whisper ${m.label}` : 'None installed';
    });

    const injectionLabel = computed(() => {
      if (!injInfo.value) return '…';
      const resolved = METHOD_LABELS[injInfo.value.resolved] || injInfo.value.resolved;
      return injInfo.value.setting === 'auto' ? `${resolved}` : resolved;
    });

    const injectionSub = computed(() => {
      if (!injInfo.value) return '';
      const auto = injInfo.value.setting === 'auto';
      if (injInfo.value.wayland) return auto ? 'auto · Wayland session' : 'manual override';
      return auto ? 'auto-detected' : 'manual override';
    });

    const stateLabel = computed(() => ({
      idle: 'Ready',
      recording: 'Listening…',
      transcribing: 'Transcribing…',
    }[dictState.value]));

    function toggleDictation() {
      window.susurro.send(CH.RECORDING_TOGGLE);
    }

    async function toggleOllama() {
      await window.susurro.invoke(CH.SETTINGS_SET, {
        ollamaEnabled: !settings.value.ollamaEnabled,
        ollamaModel: settings.value.ollamaModel || ollamaStatus.value.models[0] || null,
      });
    }

    async function clearHistory() {
      await window.susurro.invoke(CH.HISTORY_CLEAR);
    }

    function openPrefs() {
      window.susurro.send(CH.OPEN_PREFERENCES);
    }

    function fmtTime(ts) {
      return new Date(ts).toLocaleString([], {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    }

    return {
      settings, models, historyItems, injInfo, ollamaStatus, dictState, lastError,
      modelLabel, injectionLabel, injectionSub, stateLabel,
      toggleDictation, toggleOllama, clearHistory, openPrefs, fmtTime,
    };
  },

  template: `
  <div class="main">
    <div class="header">
      <div class="title">
        <h1>Susurro</h1>
        <span class="tagline">local voice dictation — nothing leaves this machine</span>
      </div>
      <button class="btn" @click="openPrefs">Preferences</button>
    </div>

    <div class="error-banner" v-if="lastError">{{ lastError }}</div>

    <div class="status-grid">
      <div class="card">
        <span class="label">Model in use</span>
        <span class="value">{{ modelLabel }}</span>
      </div>
      <div class="card">
        <span class="label">Hotkey</span>
        <span class="value"><span class="hotkey-pill">{{ settings.hotkey }}</span></span>
      </div>
      <div class="card">
        <span class="label">Text injection</span>
        <span class="value">{{ injectionLabel }} <span class="sub">{{ injectionSub }}</span></span>
      </div>
      <div class="card">
        <span class="label">Ollama cleanup</span>
        <div class="row" v-if="ollamaStatus.running">
          <span class="value">{{ settings.ollamaEnabled ? (settings.ollamaModel || 'on') : 'Off' }}</span>
          <button class="toggle" :class="{ on: settings.ollamaEnabled }" @click="toggleOllama"
                  aria-label="Toggle Ollama cleanup"></button>
        </div>
        <span class="value sub muted" v-else style="font-weight:400; font-size:13px;">
          Not detected — start Ollama locally to enable an optional grammar cleanup pass.
        </span>
      </div>
    </div>

    <div class="dictate-bar card">
      <div class="state-dot" :class="dictState"></div>
      <span style="flex:1; font-weight:600;">{{ stateLabel }}</span>
      <button class="btn btn-primary" @click="toggleDictation"
              :disabled="dictState === 'transcribing'">
        {{ dictState === 'recording' ? 'Stop' : 'Start dictating' }}
      </button>
    </div>

    <div class="history">
      <div class="card">
        <div class="history-head">
          <h2>History <span class="small muted">(last 50 · stored only on this device)</span></h2>
          <button class="btn btn-danger" @click="clearHistory"
                  :disabled="historyItems.length === 0">Clear all</button>
        </div>
        <div class="history-list">
          <div class="history-empty" v-if="historyItems.length === 0">
            Nothing yet — press <span class="hotkey-pill">{{ settings.hotkey }}</span> anywhere and start talking.
          </div>
          <div class="history-item" v-for="(item, i) in historyItems" :key="item.ts + '-' + i">
            <div class="text">{{ item.text }}</div>
            <div class="when">{{ fmtTime(item.ts) }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
  `,
}).mount('#app');
