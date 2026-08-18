# NOVUM ChatGPT PC Bridge

A proof-of-concept that lets **ChatGPT Web** call tools on your own Windows PC through a Chrome extension and a local Python agent.

> v0.1 is intentionally local-only. No LM Studio, no remote tunnel, and no Administrator/SYSTEM broker yet.

## What works in v0.1

- ChatGPT Web can request PC tools from assistant messages.
- The Chrome extension executes those requests against a localhost agent.
- Results are automatically sent back into the ChatGPT conversation.
- Screenshots are returned as an image attachment when ChatGPT requests `screen.capture`.
- Pairing token authentication.
- Arm / Disarm switch in the extension popup.
- Action log on disk.

### Tools

| Tool | Purpose |
|---|---|
| `pc.status` | Check bridge, Windows user, host, roots and shell status |
| `fs.list` | List files/folders |
| `fs.read` | Read a text file |
| `fs.write` | Write a text file inside allowed roots |
| `fs.search` | Search names recursively |
| `shell.run` | Run a command as the current Windows user (opt-in) |
| `screen.capture` | Capture the Windows virtual desktop and attach the PNG to ChatGPT |
| `clipboard.read` | Read text clipboard |
| `clipboard.write` | Write text clipboard |

## Install on Windows

### 1. Download / clone this branch

For the current test version use branch:

```text
feat/pc-bridge-v0.1
```

If using Git:

```powershell
git clone https://github.com/Mwrtyy/extension-chat-gpt.git
cd extension-chat-gpt
git checkout feat/pc-bridge-v0.1
```

### 2. Run installer

From the repository folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

The installer creates:

```text
%USERPROFILE%\.novum-pc-bridge\
├── config.json
├── token.txt
└── start-novum-agent.cmd
```

It prints your pairing token. Keep it private.

During installation you can opt into `shell.run`. If you answer **No**, files/screenshots/clipboard still work but ChatGPT cannot execute terminal commands.

### 3. Start the PC agent

Double-click:

```text
%USERPROFILE%\.novum-pc-bridge\start-novum-agent.cmd
```

Leave that window open for the first test.

You should see:

```text
NOVUM PC Bridge v0.1
Listening: http://127.0.0.1:8765
Token: ...
```

### 4. Optional smoke test

Open another PowerShell in the repo:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-test.ps1
```

Expected ending:

```text
NOVUM bridge smoke test PASSED.
```

### 5. Load the Chrome extension

Open:

```text
chrome://extensions
```

Then:

1. Enable **Developer mode**.
2. Click **Load unpacked**.
3. Select the repository's `extension` folder.
4. Pin **NOVUM PC Bridge** if desired.

### 6. Pair it with the local agent

Open ChatGPT Web, then open the NOVUM extension popup.

1. Agent URL: `http://127.0.0.1:8765`
2. Paste the token printed by the installer / agent.
3. Enable **Arm tool execution**.
4. Leave **Auto-send results** enabled.
5. Click **Test agent**.

It should report something similar to:

```text
Agent online — v0.1.0, 8 tools.
```

### 7. Connect the current ChatGPT conversation

While the ChatGPT tab is active, click:

**Inject protocol into ChatGPT**

The extension sends the tool protocol to the conversation. ChatGPT should immediately request `pc.status`.

The extension then performs this loop:

```text
ChatGPT assistant
      ↓
<<<NOVUM_TOOL>>>
      ↓
Chrome extension
      ↓
localhost agent
      ↓
Windows PC
      ↓
NOVUM_RESULT / screenshot
      ↓
ChatGPT conversation
```

## Example

After protocol injection, you can ask ChatGPT:

```text
Regarde mon écran et dis-moi ce qui est ouvert.
```

ChatGPT can emit:

```text
<<<NOVUM_TOOL>>>
{"id":"screen-001","tool":"screen.capture","args":{}}
<<<END_NOVUM_TOOL>>>
```

The extension captures the desktop through the local agent, uploads the PNG into the ChatGPT composer, and sends the associated tool result.

Another example:

```text
Liste les fichiers de mon bureau puis ouvre le fichier notes.txt.
```

ChatGPT can chain `fs.list` and `fs.read` calls through multiple turns.

## Configuration

Local config:

```text
%USERPROFILE%\.novum-pc-bridge\config.json
```

Default:

```json
{
  "host": "127.0.0.1",
  "port": 8765,
  "allowed_roots": ["%USERPROFILE%"],
  "allow_write": true,
  "allow_shell": false,
  "shell_timeout_seconds": 120,
  "max_read_bytes": 2000000,
  "max_list_entries": 500
}
```

To let the bridge access another drive/folder, add it to `allowed_roots`, for example:

```json
"allowed_roots": [
  "%USERPROFILE%",
  "D:\\Projects"
]
```

Restart the local agent after changing the config.

## Important v0.1 limitations

- **Not admin:** commands run with the same privileges as the account that starts `novum_agent.py`.
- **Not remote:** v0.1 listens on localhost only. Do not expose port 8765 to the internet.
- **No LM Studio yet:** intentionally excluded from this first proof-of-concept.
- **ChatGPT DOM can change:** the extension has fallbacks for the current composer/send controls, but a future ChatGPT UI update can require adapter changes.
- **Screenshot upload is best-effort:** it uses ChatGPT's existing file input; if OpenAI changes that component, the image adapter may need an update.

## Security

Read [`SECURITY.md`](SECURITY.md).

The important rule for this first build: **keep the extension disarmed when you are not actively using local tools.**

Every tool call is logged to:

```text
%USERPROFILE%\.novum-pc-bridge\actions.jsonl
```

## Next versions

After the local ChatGPT ↔ PC loop is proven on your machine, the next logical layers are:

1. more reliable ChatGPT UI adapter / native MCP path;
2. explicit per-operation confirmation UI;
3. remote authenticated tunnel;
4. Windows privileged broker for narrow admin operations;
5. persistent tasks / experiment engine;
6. local LLM adapters.
