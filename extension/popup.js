const DEFAULTS = {
  baseUrl: "http://127.0.0.1:8765",
  token: "",
  armed: false,
  autoSend: true
};

const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function setStatus(text, ok = null) {
  statusEl.textContent = text;
  statusEl.className = ok === true ? "ok" : ok === false ? "bad" : "";
}

async function load() {
  // Always wake the service worker first. It imports the installer-generated
  // local-config.js and bootstraps the pairing token + armed state. Reading
  // chrome.storage directly here can otherwise race the worker on first load.
  let settings;
  try {
    const response = await chrome.runtime.sendMessage({ type: "NOVUM_GET_SETTINGS" });
    if (!response?.ok || !response.settings) {
      throw new Error(response?.error || "No settings response");
    }
    settings = response.settings;
  } catch (_) {
    settings = await chrome.storage.local.get(DEFAULTS);
  }

  $("baseUrl").value = settings.baseUrl || DEFAULTS.baseUrl;
  $("token").value = settings.token || "";
  $("armed").checked = settings.armed === true;
  $("autoSend").checked = settings.autoSend !== false;

  if (settings.token && settings.armed) {
    setStatus("Paired automatically — ready.", true);
  }
}

async function save() {
  const settings = {
    baseUrl: $("baseUrl").value.trim().replace(/\/$/, "") || DEFAULTS.baseUrl,
    token: $("token").value.trim(),
    armed: $("armed").checked,
    autoSend: $("autoSend").checked
  };
  await chrome.storage.local.set(settings);
  setStatus(settings.armed ? "Saved — bridge armed." : "Saved — bridge disarmed.", true);
  return settings;
}

$("save").addEventListener("click", async () => {
  try {
    await save();
  } catch (error) {
    setStatus(error.message, false);
  }
});

$("test").addEventListener("click", async () => {
  try {
    await save();
    setStatus("Testing local agent…");
    const response = await chrome.runtime.sendMessage({ type: "NOVUM_HEALTH" });
    if (!response?.ok) throw new Error(response?.error || "No response from agent");
    const tools = response.payload?.tools?.length || 0;
    setStatus(`Agent online — v${response.payload.version}, ${tools} tools.`, true);
  } catch (error) {
    setStatus(`Agent unavailable: ${error.message}`, false);
  }
});

$("inject").addEventListener("click", async () => {
  try {
    const settings = await save();
    if (!settings.armed) throw new Error("Arm tool execution first.");
    if (!settings.token) throw new Error("Pairing token unavailable. Re-run the installer or reload the extension.");

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.startsWith("https://chatgpt.com/")) {
      throw new Error("Open a ChatGPT tab first.");
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: "NOVUM_INJECT_PROTOCOL" });
    if (!response?.ok) throw new Error(response?.error || "Protocol injection failed");
    setStatus("Protocol sent. ChatGPT should call pc.status next.", true);
    window.close();
  } catch (error) {
    setStatus(error.message, false);
  }
});

$("armed").addEventListener("change", () => void save());
$("autoSend").addEventListener("change", () => void save());

void load();
