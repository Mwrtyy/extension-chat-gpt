(() => {
  const CALL_RE = /<<<NOVUM_TOOL>>>\s*([\s\S]*?)\s*<<<END_NOVUM_TOOL>>>/g;
  const ALLOWED_TOOLS = new Set([
    "pc.status",
    "fs.list",
    "fs.read",
    "fs.write",
    "fs.search",
    "shell.run",
    "screen.capture",
    "clipboard.read",
    "clipboard.write"
  ]);
  const TURN_SELECTOR = [
    "article",
    '[data-testid^="conversation-turn-"]',
    '[data-testid*="conversation-turn"]',
    '[data-scroll-anchor="true"]'
  ].join(",");

  const seen = new Set(JSON.parse(sessionStorage.getItem("novumSeenToolIds") || "[]"));
  let processing = false;

  const PROTOCOL = `You are connected to my Windows PC through the NOVUM PC Bridge Chrome extension.\n\nWhen you need to use my PC, output EXACTLY ONE tool request and nothing else in this format:\n<<<NOVUM_TOOL>>>\n{"id":"unique-id","tool":"TOOL_NAME","args":{}}\n<<<END_NOVUM_TOOL>>>\n\nAfter the extension runs it, I will automatically send you a <<<NOVUM_RESULT>>> message. Continue from that result. Never invent a NOVUM_RESULT. Never claim an action happened unless the returned result says it happened. Use a new unique id for every call.\n\nAvailable tools:\n- pc.status {}\n- fs.list {"path":"C:\\\\Users\\\\...","limit":100}\n- fs.read {"path":"C:\\\\Users\\\\...\\\\file.txt"}\n- fs.write {"path":"C:\\\\Users\\\\...\\\\file.txt","content":"..."}\n- fs.search {"path":"C:\\\\Users\\\\...","query":"name","limit":100}\n- shell.run {"command":"...","cwd":"C:\\\\Users\\\\...","timeout":120}\n- screen.capture {}\n- clipboard.read {}\n- clipboard.write {"text":"..."}\n\nStart by calling pc.status to verify the bridge.`;

  function persistSeen() {
    sessionStorage.setItem("novumSeenToolIds", JSON.stringify(Array.from(seen).slice(-500)));
  }

  function getComposer() {
    return (
      document.querySelector("#prompt-textarea") ||
      document.querySelector('textarea[placeholder]') ||
      document.querySelector('div[contenteditable="true"][data-lexical-editor="true"]') ||
      document.querySelector('div[contenteditable="true"]')
    );
  }

  async function waitForComposer(timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const composer = getComposer();
      if (composer) return composer;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("ChatGPT composer not found");
  }

  function setComposerText(text) {
    const el = getComposer();
    if (!el) throw new Error("ChatGPT composer not found");
    el.focus();

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    el.replaceChildren();
    const p = document.createElement("p");
    p.textContent = text;
    el.appendChild(p);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }

  function findSendButton() {
    return (
      document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('button[aria-label="Send prompt"]') ||
      Array.from(document.querySelectorAll("button")).find((button) => {
        const label = (button.getAttribute("aria-label") || "").toLowerCase();
        return label.includes("send") || label.includes("envoyer");
      })
    );
  }

  async function waitForSendButton(timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const button = findSendButton();
      if (button && !button.disabled) return button;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error("Send button not available");
  }

  async function sendText(text) {
    await waitForComposer();
    setComposerText(text);
    const button = await waitForSendButton();
    button.click();
  }

  function base64ToFile(base64, mime, filename) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], filename || "novum-screenshot.png", { type: mime || "image/png" });
  }

  function findFileInput() {
    return (
      document.querySelector('input[type="file"][accept*="image"]') ||
      document.querySelector('input[type="file"][multiple]') ||
      document.querySelector('input[type="file"]')
    );
  }

  async function attachImage(base64, mime, filename) {
    const input = findFileInput();
    if (!input) throw new Error("ChatGPT file input not found for screenshot upload");
    const transfer = new DataTransfer();
    transfer.items.add(base64ToFile(base64, mime, filename));
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 1600));
  }

  function compactPayload(payload) {
    const clone = structuredClone(payload);
    const result = clone?.result;
    if (result?.image_base64) {
      delete result.image_base64;
      result.image_attached_to_chat = true;
    }
    return clone;
  }

  async function deliverResult(call, response) {
    const settingsResponse = await chrome.runtime.sendMessage({ type: "NOVUM_GET_SETTINGS" });
    const autoSend = settingsResponse?.settings?.autoSend !== false;

    let payload;
    if (response.ok) {
      payload = response.payload;
      const image = payload?.result?.image_base64;
      if (image) {
        await attachImage(
          image,
          payload.result.mime || "image/png",
          payload.result.filename || `novum-${call.id}.png`
        );
      }
    } else {
      payload = { ok: false, error: response.error || "Unknown extension error" };
    }

    const text = [
      "<<<NOVUM_RESULT>>>",
      JSON.stringify({ id: call.id, tool: call.tool, ...compactPayload(payload) }, null, 2),
      "<<<END_NOVUM_RESULT>>>"
    ].join("\n");

    if (autoSend) await sendText(text);
    else setComposerText(text);
  }

  async function executeCall(call) {
    if (!call || typeof call !== "object") return;
    if (typeof call.id !== "string" || !call.id.trim()) return;
    if (typeof call.tool !== "string" || !call.tool.trim()) return;
    if (!ALLOWED_TOOLS.has(call.tool)) return;
    if (seen.has(call.id)) return;

    seen.add(call.id);
    persistSeen();

    const response = await chrome.runtime.sendMessage({
      type: "NOVUM_TOOL_CALL",
      tool: call.tool,
      args: call.args || {}
    });

    await deliverResult(call, response || { ok: false, error: "No response from extension worker" });
  }

  function explicitRole(node) {
    if (!(node instanceof Element)) return null;
    if (node.closest('[data-message-author-role="assistant"], [data-turn="assistant"]')) return "assistant";
    if (node.closest('[data-message-author-role="user"], [data-turn="user"]')) return "user";
    return null;
  }

  function classifyTurn(node) {
    if (!(node instanceof Element)) return null;
    const direct = explicitRole(node);
    if (direct) return direct;

    const turn = node.matches(TURN_SELECTOR) ? node : node.closest(TURN_SELECTOR);
    if (!turn) return null;

    const roleNode = turn.querySelector("[data-message-author-role], [data-turn]");
    if (roleNode) {
      const role = (roleNode.getAttribute("data-message-author-role") || roleNode.getAttribute("data-turn") || "").toLowerCase();
      if (role === "assistant" || role === "user") return role;
    }

    const labels = Array.from(turn.querySelectorAll('h1,h2,h3,h4,h5,h6,[class*="sr-only"],[aria-label]'))
      .slice(0, 30)
      .map((el) => `${el.getAttribute("aria-label") || ""} ${el.textContent || ""}`.trim().toLowerCase())
      .filter(Boolean)
      .join("\n");

    if (/\b(you said|vous avez dit|tu as dit|user said)\b/i.test(labels)) return "user";
    if (/\b(chatgpt said|chatgpt a dit|assistant said)\b/i.test(labels) || /(^|\s)chatgpt($|\s)/i.test(labels)) return "assistant";
    return null;
  }

  function getAssistantMessages() {
    const nodes = new Set();
    for (const selector of [
      '[data-message-author-role="assistant"]',
      'article[data-turn="assistant"]',
      '[data-turn="assistant"]'
    ]) {
      for (const node of document.querySelectorAll(selector)) nodes.add(node);
    }
    for (const turn of document.querySelectorAll(TURN_SELECTOR)) {
      if (classifyTurn(turn) === "assistant") nodes.add(turn);
    }
    return Array.from(nodes);
  }

  async function scanAssistantMessages() {
    if (processing) return;
    processing = true;
    try {
      for (const node of getAssistantMessages()) {
        const text = node.innerText || node.textContent || "";
        if (!text.includes("<<<NOVUM_TOOL>>>")) continue;
        CALL_RE.lastIndex = 0;
        let match;
        while ((match = CALL_RE.exec(text)) !== null) {
          try {
            const call = JSON.parse(match[1]);
            await executeCall(call);
          } catch (error) {
            console.warn("NOVUM: invalid tool call", error, match[1]);
          }
        }
      }
    } finally {
      processing = false;
    }
  }

  async function injectProtocol() {
    await sendText(PROTOCOL);
  }

  async function maybeAutoConnect() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("novum") !== "1") return;
    if (sessionStorage.getItem("novumAutoConnected") === "1") return;

    const settingsResponse = await chrome.runtime.sendMessage({ type: "NOVUM_GET_SETTINGS" });
    if (!settingsResponse?.settings?.armed || !settingsResponse?.settings?.token) return;

    sessionStorage.setItem("novumAutoConnected", "1");
    try {
      await injectProtocol();
    } catch (error) {
      sessionStorage.removeItem("novumAutoConnected");
      console.warn("NOVUM: automatic protocol injection failed", error);
    }
  }

  const observer = new MutationObserver(() => void scanAssistantMessages());
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  void scanAssistantMessages();
  window.setInterval(() => void scanAssistantMessages(), 1200);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "NOVUM_INJECT_PROTOCOL") return;
    injectProtocol()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  window.setTimeout(() => void maybeAutoConnect(), 1200);
})();
