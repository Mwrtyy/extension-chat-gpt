# NOVUM ChatGPT PC Bridge

A proof-of-concept that lets **ChatGPT Web** call tools on your own Windows PC through a Chrome extension and a local agent.

## Fastest install

Download **`INSTALL-NOVUM.bat`** from this repository and double-click it.

The installer automatically:

- downloads/copies NOVUM into `%LOCALAPPDATA%\NOVUM-ChatGPT`;
- finds Python, or installs Python 3.12 with `winget` if needed;
- enables filesystem read/write and `shell.run` as your current Windows user;
- creates and injects the extension pairing token automatically;
- starts the local agent in the background;
- creates a **`NOVUM ChatGPT`** shortcut on your Desktop;
- opens the extension folder and `chrome://extensions` for the only unavoidable browser setup step.

### First time only: two Chrome clicks

Google Chrome no longer allows a normal local application to silently load an unpacked extension. So once:

1. turn on **Developer mode** in `chrome://extensions`;
2. click **Load unpacked** and choose the NOVUM `extension` folder that the installer opened for you.

The path is also copied to your clipboard:

```text
%LOCALAPPDATA%\NOVUM-ChatGPT\extension
```

You do **not** need to paste a pairing token or configure the URL when using the quick installer.

## After installation: one double-click

Use the Desktop shortcut:

```text
NOVUM ChatGPT
```

It will:

1. start the local NOVUM agent if it is not already running;
2. open Chrome on `https://chatgpt.com/?novum=1`;
3. let the extension auto-connect that ChatGPT page to the PC bridge;
4. inject the NOVUM tool protocol automatically.

Then ask things such as:

```text
Regarde mon ecran et dis-moi ce que tu vois.
```

or:

```text
Liste les fichiers de mon Bureau et cree test-novum.txt.
```

or:

```text
Lance whoami et donne-moi le resultat.
```

## Current tools

| Tool | Purpose |
|---|---|
| `pc.status` | Check bridge, Windows user, roots and shell status |
| `fs.list` | List files/folders |
| `fs.read` | Read a text file |
| `fs.write` | Write a text file |
| `fs.search` | Search names recursively |
| `shell.run` | Run a command as the current Windows user |
| `screen.capture` | Capture the Windows desktop and return the image to ChatGPT |
| `clipboard.read` | Read text clipboard |
| `clipboard.write` | Write text clipboard |

The quick installer makes filesystem tools available on mounted Windows filesystem drives and enables shell execution. Commands still run with **your normal Windows user privileges**, not SYSTEM/Administrator privileges.

## Architecture

```text
ChatGPT Web
    |
Chrome extension
    |
http://127.0.0.1:8765
    |
NOVUM local agent
    |
files / terminal / screenshots / clipboard
```

The local HTTP agent is bound to loopback only. Do not expose port `8765` directly to the internet.

## Manual / development install

If you want to work on the source instead of using the quick installer:

```powershell
git clone https://github.com/Mwrtyy/extension-chat-gpt.git
cd extension-chat-gpt
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

Then load the repository's `extension` folder from `chrome://extensions`.

Smoke test:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-test.ps1
```

## Local state

```text
%USERPROFILE%\.novum-pc-bridge\
├── config.json
├── token.txt
├── actions.jsonl
└── screenshots\
```

Quick-install program files:

```text
%LOCALAPPDATA%\NOVUM-ChatGPT\
├── agent\
├── extension\
├── launch-novum.ps1
└── start-agent.vbs
```

Every tool call is logged to:

```text
%USERPROFILE%\.novum-pc-bridge\actions.jsonl
```

## Current limitations

- No Administrator/SYSTEM broker yet.
- No remote tunnel yet.
- No LM Studio/local-model adapter yet.
- The ChatGPT DOM adapter can require updates when the ChatGPT interface changes.
- Screenshot attachment uses ChatGPT's current web file input and is therefore best-effort.

## Security

Read [`SECURITY.md`](SECURITY.md).

The bridge is intentionally local-only for this stage. `shell.run` is powerful: anything the current Windows account can do from a terminal can potentially be requested through the bridge. Keep the extension disarmed when you do not want ChatGPT to execute local tools.
