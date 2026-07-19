// Single source of truth for every IPC channel Susurro uses.
// Required by the main process and embedded into the preload whitelist —
// renderers can only reach channels listed here.
'use strict';

const CH = {
  // settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_CHANGED: 'settings:changed', // main -> renderers

  // transcription history
  HISTORY_LIST: 'history:list',
  HISTORY_CLEAR: 'history:clear',
  HISTORY_CHANGED: 'history:changed', // main -> renderers

  // whisper models
  MODELS_LIST: 'models:list',
  MODELS_DOWNLOAD: 'models:download',
  MODELS_CANCEL: 'models:cancel',
  MODELS_DELETE: 'models:delete',
  MODELS_PROGRESS: 'models:progress', // main -> renderers

  // dictation state machine
  RECORDING_TOGGLE: 'recording:toggle',
  STATE_CHANGED: 'state:changed', // main -> renderers ('idle'|'recording'|'transcribing')
  CAPTURE_START: 'capture:start', // main -> overlay
  CAPTURE_STOP: 'capture:stop', // main -> overlay
  AUDIO_DATA: 'audio:data', // overlay -> main (16-bit PCM ArrayBuffer + sampleRate)
  CAPTURE_ERROR: 'capture:error', // overlay -> main
  DICTATION_ERROR: 'dictation:error', // main -> renderers

  // overlay widget window management
  OVERLAY_MOVE: 'overlay:move', // renderer -> main {x, y}
  OVERLAY_MOVE_END: 'overlay:move-end', // renderer -> main (persist position)
  OVERLAY_GET_POSITION: 'overlay:get-position',

  // hotkey
  HOTKEY_SET: 'hotkey:set',
  HOTKEY_CONFLICTS: 'hotkey:conflicts',

  // injection
  INJECTION_INFO: 'injection:info',

  // ollama (optional, local-only)
  OLLAMA_STATUS: 'ollama:status',

  // onboarding / windows
  ONBOARDING_DONE: 'onboarding:done',
  OPEN_PREFERENCES: 'window:open-preferences',
  OPEN_MAIN: 'window:open-main',
  PERM_ACCESSIBILITY: 'perm:accessibility',
  PLATFORM_INFO: 'platform:info',
};

// invoke (request/response) channels a renderer may call
CH.INVOKABLE = [
  CH.SETTINGS_GET,
  CH.SETTINGS_SET,
  CH.HISTORY_LIST,
  CH.HISTORY_CLEAR,
  CH.MODELS_LIST,
  CH.MODELS_DOWNLOAD,
  CH.MODELS_CANCEL,
  CH.MODELS_DELETE,
  CH.AUDIO_DATA,
  CH.OVERLAY_GET_POSITION,
  CH.HOTKEY_SET,
  CH.HOTKEY_CONFLICTS,
  CH.INJECTION_INFO,
  CH.OLLAMA_STATUS,
  CH.ONBOARDING_DONE,
  CH.PERM_ACCESSIBILITY,
  CH.PLATFORM_INFO,
];

// fire-and-forget channels a renderer may send on
CH.SENDABLE = [
  CH.RECORDING_TOGGLE,
  CH.CAPTURE_ERROR,
  CH.OVERLAY_MOVE,
  CH.OVERLAY_MOVE_END,
  CH.OPEN_PREFERENCES,
  CH.OPEN_MAIN,
];

// main -> renderer broadcast channels a renderer may subscribe to
CH.SUBSCRIBABLE = [
  CH.SETTINGS_CHANGED,
  CH.HISTORY_CHANGED,
  CH.MODELS_PROGRESS,
  CH.STATE_CHANGED,
  CH.CAPTURE_START,
  CH.CAPTURE_STOP,
  CH.DICTATION_ERROR,
];

module.exports = CH;
