# Security model

NOVUM PC Bridge v0.1 is intentionally local-only.

## Defaults

- Agent binds to `127.0.0.1:8765`.
- Tool calls require a random pairing token stored in `%USERPROFILE%\.novum-pc-bridge\token.txt`.
- The Chrome extension is disarmed by default.
- Filesystem access is restricted to `%USERPROFILE%` by default.
- Filesystem writes are enabled inside allowed roots.
- `shell.run` is disabled by default and can be enabled during install or in `config.json`.
- No administrator/SYSTEM service exists in v0.1.
- No remote tunnel exists in v0.1.
- Every tool action is appended to `%USERPROFILE%\.novum-pc-bridge\actions.jsonl`.

## Important

When armed, assistant messages can request tools. Treat web content, pasted prompts, files, and third-party instructions as potentially hostile. Disarm the extension when you are not actively using PC control.

Do not port-forward TCP 8765. Do not bind v0.1 to `0.0.0.0`. Remote access should be implemented later through an authenticated tunnel with a separate threat model.

## Shell access

`shell.run` executes as the currently logged-in Windows user. It is powerful and is not a sandbox. Only enable it when you understand that commands can modify data accessible to your account.

## Administrator access

Administrator/SYSTEM execution is deliberately not part of v0.1. A later privileged broker should expose narrow, audited operations rather than a generic unauthenticated admin shell.
