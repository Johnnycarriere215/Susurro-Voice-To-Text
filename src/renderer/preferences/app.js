// Preferences: hotkey rebinding (capture + conflict check), model manager,
// injection override, launch-on-startup, optional Ollama cleanup settings.
'use strict';

const { createApp, ref, computed, onMounted, onUnmounted } = Vue;
const CH = window.susurro.channels;

// Maps KeyboardEvent to an Electron accelerator string, or null if the
// pressed combination isn't bindable (e.g. modifier only).
function eventToAccelerator(e) {
  const parts = [];
  if (e.metaKey) parts.push(/Mac/i.test(navigator.platform) ? 'Command' : 'Super');
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  let key = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  else if (/^Arrow/.test(key)) key = key.replace('Arrow', '');
  parts.push(key);

  if (parts.length < 2 && !/^F\d+$/.test(key)) return null; // require a modifier
  return parts.join('+');
}

createApp({
  setup() {
    const settings = ref({});
    const models = ref([]);
    const progress = ref({}); // name -> progress payload
    const injInfo = ref(null);
    const ollamaStatus = ref({ running: false, models: [] });
    const capturing = ref(false);
    const hotkeyError = ref(null);
    const unsubs = [];

    async function refreshModels() {
      models.value = await window.susurro.invoke(CH.MODELS_LIST);
    }

    async function refresh() {
      settings.value = await window.susurro.invoke(CH.SETTINGS_GET);
      injInfo.value = await window.susurro.invoke(CH.INJECTION_INFO);
      ollamaStatus.value = await window.susurro.invoke(CH.OLLAMA_STATUS);
      await refreshModels();
    }

    onMounted(() => {
      refresh();
      unsubs.push(window.susurro.on(CH.SETTINGS_CHANGED, (s) => { settings.value = s; }));
      unsubs.push(window.susurro.on(CH.MODELS_PROGRESS, (p) => {
        progress.value = { ...progress.value, [p.name]: p };
        if (p.done || p.error || p.cancelled) refreshModels();
      }));
      window.addEventListener('keydown', onKeyDown, true);
    });
    onUnmounted(() => {
      unsubs.forEach((u) => u());
      window.removeEventListener('keydown', onKeyDown, true);
    });

    // ---- hotkey capture ----
    function startCapture() {
      capturing.value = true;
      hotkeyError.value = null;
    }

    async function onKeyDown(e) {
      if (!capturing.value) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        capturing.value = false;
        return;
      }
      const accel = eventToAccelerator(e);
      if (!accel) return; // keep capturing until a full combo arrives

      const conflict = await window.susurro.invoke(CH.HOTKEY_CONFLICTS, accel);
      if (conflict.reserved) {
        hotkeyError.value = `${accel} is a common system shortcut — pick another combination.`;
        return;
      }
      const res = await window.susurro.invoke(CH.HOTKEY_SET, accel);
      if (!res.ok) {
        hotkeyError.value = res.reason === 'taken'
          ? `${accel} is already in use by another app.`
          : `${accel} can't be used (${res.reason}).`;
        return;
      }
      capturing.value = false;
      hotkeyError.value = null;
    }

    // ---- models ----
    function downloadModel(name) {
      progress.value = { ...progress.value, [name]: { name, percent: 0 } };
      window.susurro.invoke(CH.MODELS_DOWNLOAD, name).then(refreshModels);
    }
    function cancelModel(name) {
      window.susurro.invoke(CH.MODELS_CANCEL, name);
    }
    async function deleteModel(name) {
      await window.susurro.invoke(CH.MODELS_DELETE, name);
      await refresh();
    }
    async function useModel(name) {
      await window.susurro.invoke(CH.SETTINGS_SET, { model: name });
    }

    // ---- simple setting writes ----
    async function setInjection(event) {
      await window.susurro.invoke(CH.SETTINGS_SET, { injectionMethod: event.target.value });
      injInfo.value = await window.susurro.invoke(CH.INJECTION_INFO);
    }
    async function toggleStartup() {
      await window.susurro.invoke(CH.SETTINGS_SET, { launchOnStartup: !settings.value.launchOnStartup });
    }
    async function toggleOllama() {
      await window.susurro.invoke(CH.SETTINGS_SET, {
        ollamaEnabled: !settings.value.ollamaEnabled,
        ollamaModel: settings.value.ollamaModel || ollamaStatus.value.models[0] || null,
      });
    }
    async function setOllamaModel(event) {
      await window.susurro.invoke(CH.SETTINGS_SET, { ollamaModel: event.target.value });
    }

    const isDownloading = computed(() => (name) => {
      const p = progress.value[name];
      return p && !p.done && !p.error && !p.cancelled;
    });

    return {
      settings, models, progress, injInfo, ollamaStatus, capturing, hotkeyError,
      startCapture, downloadModel, cancelModel, deleteModel, useModel,
      setInjection, toggleStartup, toggleOllama, setOllamaModel, isDownloading,
    };
  },

  template: `
  <div class="prefs">
    <h1>Preferences</h1>

    <div class="section">
      <h2>Hotkey</h2>
      <div class="card">
        <div class="row">
          <div>
            <button class="hotkey-capture" :class="{ capturing }" @click="startCapture">
              {{ capturing ? 'Press your new shortcut… (Esc to cancel)' : settings.hotkey }}
            </button>
            <div class="hotkey-error" v-if="hotkeyError">{{ hotkeyError }}</div>
            <div class="hotkey-note" v-else>Toggles dictation from anywhere. Checked against common OS shortcuts.</div>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Speech models</h2>
      <div class="card">
        <div class="model-row" v-for="m in models" :key="m.name">
          <div class="meta">
            <div class="name">{{ m.label }}
              <span class="badge accent" v-if="settings.model === m.name">in use</span>
              <span class="badge" v-else-if="m.installed">installed</span>
            </div>
            <div class="note">{{ m.downloadLabel }} · {{ m.note }}</div>
          </div>
          <template v-if="isDownloading(m.name)">
            <div class="progress-track">
              <div class="progress-fill" :style="{ width: (progress[m.name]?.percent ?? 0) + '%' }"></div>
            </div>
            <button class="btn" @click="cancelModel(m.name)">Cancel</button>
          </template>
          <template v-else-if="m.installed">
            <button class="btn" v-if="settings.model !== m.name" @click="useModel(m.name)">Use</button>
            <button class="btn btn-danger" @click="deleteModel(m.name)">Delete</button>
          </template>
          <template v-else>
            <button class="btn btn-primary" @click="downloadModel(m.name)">Download</button>
          </template>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Text injection</h2>
      <div class="card">
        <div class="row">
          <div>
            <div style="font-weight:600;">Method</div>
            <div class="small muted" v-if="injInfo">
              Currently: {{ injInfo.resolved }}<span v-if="injInfo.wayland"> (Wayland session)</span>
            </div>
          </div>
          <select :value="settings.injectionMethod" @change="setInjection">
            <option value="auto">Auto (recommended)</option>
            <option value="keystroke">Simulated keystrokes</option>
            <option value="clipboard">Clipboard paste</option>
          </select>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>General</h2>
      <div class="card">
        <div class="row">
          <div>
            <div style="font-weight:600;">Launch Susurro on startup</div>
            <div class="small muted">Starts minimized to the tray.</div>
          </div>
          <button class="toggle" :class="{ on: settings.launchOnStartup }" @click="toggleStartup"
                  aria-label="Toggle launch on startup"></button>
        </div>
      </div>
    </div>

    <div class="section" v-if="ollamaStatus.running">
      <h2>Ollama cleanup <span class="badge">local only</span></h2>
      <div class="card">
        <div class="row">
          <div>
            <div style="font-weight:600;">Polish transcripts with a local model</div>
            <div class="small muted">Grammar and filler-word cleanup only — never changes meaning.
              Talks solely to your own Ollama at localhost:11434.</div>
          </div>
          <button class="toggle" :class="{ on: settings.ollamaEnabled }" @click="toggleOllama"
                  aria-label="Toggle Ollama cleanup"></button>
        </div>
        <div class="row" v-if="settings.ollamaEnabled">
          <div style="font-weight:600;">Model</div>
          <select :value="settings.ollamaModel" @change="setOllamaModel">
            <option v-for="name in ollamaStatus.models" :key="name" :value="name">{{ name }}</option>
          </select>
        </div>
      </div>
    </div>
  </div>
  `,
}).mount('#app');
