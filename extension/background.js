const DEFAULTS = {
  baseUrl: "http://127.0.0.1:8765",
  token: "",
  armed: false,
  autoSend: true
};

async function getSettings() {
  return await chrome.storage.local.get(DEFAULTS);
}

async function callAgent(tool, args) {
  const settings = await getSettings();
  if (!settings.armed) {
    throw new Error("NOVUM bridge is disarmed. Open the extension popup and enable Arm.");
  }
  if (!settings.token) {
    throw new Error("No NOVUM token configured in the extension popup.");
  }

  const response = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/tool`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Novum-Token": settings.token
    },
    body: JSON.stringify({ tool, args: args || {} })
  });

  const payload = await response.json().catch(() => ({ ok: false, message: `HTTP ${response.status}` }));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Agent returned HTTP ${response.status}`);
  }
  return payload;
}

async function health() {
  const settings = await getSettings();
  const response = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/health`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "NOVUM_TOOL_CALL") {
    callAgent(message.tool, message.args)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "NOVUM_HEALTH") {
    health()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "NOVUM_GET_SETTINGS") {
    getSettings().then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }
});
