// Injection engine: OS/session detection and method selection.
//
// method resolution:
//   'auto'      -> keystroke where it works; clipboard-paste on Wayland
//                  sessions without a typing tool
//   'keystroke' -> forced simulated keystrokes
//   'clipboard' -> forced clipboard-copy + simulated paste
'use strict';

const keystroke = require('./keystroke');
const clipboardPaste = require('./clipboardPaste');
const wayland = require('./waylandDetect');

// Resolves the user's setting to the concrete method used right now.
function resolveMethod(setting) {
  if (setting === 'keystroke' || setting === 'clipboard') return setting;
  return keystroke.available() ? 'keystroke' : 'clipboard';
}

// Everything the UI needs to explain what is happening and why.
function info(setting) {
  const env = wayland.detect();
  return {
    platform: env.platform,
    wayland: env.wayland,
    tools: env.tools,
    setting: setting || 'auto',
    resolved: resolveMethod(setting),
    keystrokeAvailable: keystroke.available(),
    // true when auto fell back to clipboard because of Wayland limits —
    // drives the one-time in-app explanation note.
    waylandFallback: env.wayland && setting === 'auto' && !keystroke.available(),
  };
}

// Injects text into the currently focused field.
// Returns { method, manualPaste } — manualPaste means the text was copied
// but the user must press Ctrl+V themselves (bare Wayland, no tools).
async function inject(text, setting) {
  const method = resolveMethod(setting);
  if (method === 'keystroke') {
    try {
      await keystroke.type(text);
      return { method: 'keystroke', manualPaste: false };
    } catch (err) {
      // Keystroke path died mid-flight (tool missing/broken) — fall back
      // rather than losing the user's words.
      const result = await clipboardPaste.paste(text);
      return { method: 'clipboard', manualPaste: result.manualPaste, fellBack: String(err.message) };
    }
  }
  const result = await clipboardPaste.paste(text);
  return { method: 'clipboard', manualPaste: result.manualPaste };
}

module.exports = { inject, info, resolveMethod };
