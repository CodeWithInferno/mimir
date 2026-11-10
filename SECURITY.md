# Security

## The short version

**A Mimir scene is code.** A scene is a JavaScript program, not a document: opening, checking, shooting, querying
or exporting a scene runs it. Treat a scene file from someone else like any other script from someone else: read
it first, or do not run it. The same holds for an HTML file that `mimir export` wrote: it contains the scene's code.

## What runs where

| You run | What executes | With which rights |
|---|---|---|
| `mimir check`, `mimir shot`, `mimir query`, `mimir export` on a scene | the scene's JavaScript, in a headless Chrome-family browser started by Mimir with a throwaway profile, loaded from a server on `127.0.0.1` | the rights of a web page on a local origin: it **can** make network requests and can read whatever the local server serves, which is the directory the scene file is in |
| `mimir open` on a scene | the same code, in **your own browser** | the same, in your normal browser profile, for as long as the tab is open |
| opening an HTML file written by `mimir export` | the scene's JavaScript embedded in that file | restricted by the file's content security policy, see below |
| `mimir new "<prompt>"` | a coding agent you have installed, started as a local process in the output directory, which then runs `mimir` commands and writes files | whatever that agent may do on your machine: it is not sandboxed by Mimir. Your prompt and the scene go to that agent's own service |
| any `mimir` command | Mimir's own TypeScript, with bun | your user account |

What follows from this:

- The scene is not sandboxed from the network while it is being developed. A hostile scene can send what it can
  read to a server.
- The local server serves the directory of the scene file under `/scene/`, so that a scene's relative imports
  work. A page you have open in the same browser can ask it for `http://127.0.0.1:<port>/…`, so what it refuses
  matters (`src/cli/server.ts`, tested in `tests/unit/cli/infra.test.ts`):
  - it listens on `127.0.0.1` only and is not reachable from other machines;
  - it answers only requests whose `Host` header is its own loopback address with its own port; anything else is
    `403`. A foreign name that was pointed at your machine (DNS rebinding) therefore reads nothing;
  - it never serves a dot file or anything inside a dot directory (`.env`, `.git/…`);
  - it serves only files of web types (code, JSON, CSS, images, fonts, sound, video, text, CSV); the list is
    `SERVED_EXTENSIONS`, and `MIMIR_SERVE_EXTENSIONS` adds to it on your own responsibility;
  - paths outside the viewer and the scene directory are refused, also through a symbolic link;
  - `mimir open` binds a free port, not a fixed one, so a page cannot guess where it is.
  What it still does: any file of a served type next to the scene can be read by the scene itself and by a page
  that can run script on the server's own origin. Keep scenes in a directory of their own, away from files you
  would not publish.
- The scene does not get access to the file system or to a shell: it runs in the browser, not in bun.
- `mimir new` is different in kind: it starts a coding agent, and an agent runs commands. The adapter passes the
  agent a working directory, a turn limit and a spend limit and, for the built-in adapter, permission rules for a
  headless run; that is a convenience, not a sandbox. Run it in a directory you are willing to let an agent write
  to. Mimir reads, stores and forwards no credential.
- On Linux, when Mimir is run as root (typical in containers), the browser is started with `--no-sandbox`, because
  Chrome refuses to start otherwise. Do not run untrusted scenes as root.

## Exported files

`mimir export` writes one HTML file with this policy in a `<meta http-equiv="Content-Security-Policy">` element:

```
default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'unsafe-inline';
img-src data: blob:; font-src data:; media-src data: blob:; worker-src blob:; connect-src 'none'
```

In a browser that enforces it, the exported file cannot fetch, post, open a WebSocket, load a remote script, image,
font or frame, or submit a form to a remote address: everything it needs is inside the file. The export command
verifies the written file by opening it from `file://`, and `bun scripts/offline-proof.ts <file> <png>` proves it
again with the network switched off and reports every request the page made.

What the policy does **not** do:

- It does not make the embedded JavaScript harmless. Inline script is allowed (that is how the file works), so
  the scene's code runs in the page. It can still navigate the window to another address (a content security
  policy does not restrict top-level navigation), use the CPU, or show misleading content.
- It is written into the file. Anyone who edits the file can remove it. It protects a reader from a file that was
  exported by Mimir, not from a file that only claims to be.
- A file opened from `file://` shares that origin's behaviour in your browser. Host exported files you did not
  write on a separate origin or open them in a separate browser profile.

The engine itself makes no network request, has no telemetry and contains no keys.

## Supported versions

Nothing has been released yet. Until 1.0.0 only the latest commit on the default branch receives fixes.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

- Preferred: the repository's private vulnerability reporting ("Report a vulnerability" under the Security tab),
  once the repository is public and the feature is switched on.
- Or e-mail **<SECURITY CONTACT - the owner must fill this in before publishing>**.

Include the commit, the platform and browser, the scene or command that shows the problem, and what an attacker
gains. You can expect an acknowledgement within 7 days. Please allow 90 days before publishing details, or until a
fix is released if that is sooner.

Things that are in scope: a scene or an exported file escaping the restrictions described above (for example a
network request from an exported file), the local server serving a dot file, a file outside the viewer and the
scene directory, or answering a request with a foreign `Host` header or on a non-loopback address, the CLI
executing something from a scene outside the browser, a dependency with a known vulnerability that is reachable.

Not a vulnerability: a scene doing in the page what any web page may do while it is developed (see the table above).
