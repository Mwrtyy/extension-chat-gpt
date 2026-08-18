(() => {
  const CALL_RE = /<<<NOVUM_TOOL>>>\s*([\s\S]*?)\s*<<<END_NOVUM_TOOL>>>/g;
  const seen = new Set(JSON.parse(sessionStorage.getItem("novumSeenToolIds") || "[]"));
  let processing = false;

  function persistSeen() {
    sessionStorage.setItem("novumSeenToolIds", JSON.stringify(Array.from(seen).slice(-500)));
  }

  function getComposer() {
    return (
      document.querySelector("#prompt-textarea") ||
      document.querySelector('textarea[placeholder]') ||
      document.querySelector('div[contenteditable="true"]')
    );
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
      Array.from(document.querySelectorAll("button")).find((button) => {
        const label = (button.getAttribute("aria-label") || "").toLowerCase();
        return label.includes("send") || label.includes("envoyer");
      })
    );
  }

  async function waitForSendButton(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const button = findSendButton();
      if (button && !button.disabled) return button;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error("Send button not available");
  }

  async function sendText(text) {
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

  async function attachImage(base64, mime, filename) {
    const input = document.querySelector('input[type="file"]');
    if (!input) throw new Error("ChatGPT file input not found for screenshot upload");
    const transfer = new DataTransfer();
    transfer.items.add(base64ToFile(base64, mime, filename));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));

    // Give ChatGPT time to process the attachment before sending the result message.
    await new Promise((resolve) => setTimeout(resolve, 1400));
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

    if (autoSend) {
      await sendText(text);
    } else {
      setComposerText(text);
    }
  }

  async function executeCall(call) {
    if (!call || typeof call !== "object") return;
    if (typeof call.id !== "string" || !call.id.trim()) return;
    if (typeof call.tool !== "string" || !call.tool.trim()) return;
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

  async function scanAssistantMessages() {
    if (processing) return;
    processing = true;
    try {
      const assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]');
      for (const node of assistantMessages) {
        const text = node.innerText || node.textContent || "";
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

  const observer = new MutationObserver(() => {
    void scanAssistantMessages();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  void scanAssistantMessages();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "NOVUM_INJECT_PROTOCOL") {
      const protocol = `You are connected to my Windows PC through the NOVUM PC Bridge Chrome extension.\n\nWhen you need to use my PC, output EXACTLY ONE tool request and nothing else in this format:\n<<<NOVUM_TOOL>>>\n{"id":"unique-id","tool":"TOOL_NAME","args":{}}\n<<<END_NOVUM_TOOL>>>\n\nAfter the extension runs it, I will automatically send you a <<<NOVUM_RESULT>>> message. Continue from that result. Never invent a NOVUM_RESULT. Never claim an action happened unless the returned result says it happened. Use a new unique id for every call.\n\nAvailable tools:\n- pc.status {}\n- fs.list {"path":"C:\\\\Users\\\\...","limit":100}\n- fs.read {"path":"C:\\\\Users\\\\...\\\\file.txt"}\n- fs.write {"path":"C:\\\\Users\\\\...\\\\file.txt","content":"..."}\n- fs.search {"path":"C:\\\\Users\\\\...","query":"name","limit":100}\n- shell.run {"command":"...","cwd":"C:\\\\Users\\\\...","timeout":120}\n- screen.capture {}\n- clipboard.read {}\n- clipboard.write {"text":"..."}\n\nStart by calling pc.status to verify the bridge.`;

      sendText(protocol)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
  });
})();
