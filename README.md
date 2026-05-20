# Jenkins Builder (VS Code / Cursor)

[Made with reactive-vscode](https://kermanx.github.io/reactive-vscode/)

Lightweight Jenkins integration: sign in with username + API token, bind a job to the workspace, browse all jobs with search, stream console logs, stop running builds, and trigger a parameterized build using the current Git branch.

**Documentation**

- [Product requirements (PRD)](./docs/PRD.md)
- [Technical design](./docs/TECHNICAL_DESIGN.md)

## Quick start

1. Run `pnpm install` and open this folder in VS Code / Cursor.
2. `pnpm dev` in a terminal, then **F5** → Run Extension.
3. In the Extension Host window: **Jenkins Builder: Sign In** (Command Palette), then use the Jenkins activity bar to bind a job and trigger builds.

## Packaging

```bash
pnpm run build
pnpm run ext:package
```

Install the resulting `.vsix` via **Extensions: Install from VSIX…**.

## Configuration

See the generated tables below (from `package.json`) or [docs/PRD.md §5](./docs/PRD.md#5-配置项汇总).

### Behind a corporate proxy (Cursor 3.4+ / VSCode on Electron 39+)

Starting with Cursor 3.4 (Electron 39 / Node 22), the global `fetch` no longer reads VS Code's `http.proxy` setting or `HTTPS_PROXY` / `HTTP_PROXY` environment variables automatically. If your Jenkins is only reachable through a proxy and you see `fetch failed` after updating, set **one** of the following:

- `jenkinsBuilder.proxy`: `http://user:pass@proxy.corp:8080` (recommended — explicit and per-extension)
- VS Code `http.proxy` (used as a fallback)
- Environment variable `HTTPS_PROXY` / `HTTP_PROXY` (lowest priority fallback; must be set in the shell that launched Cursor/VSCode)

For self-signed or internal-CA Jenkins instances, set `jenkinsBuilder.strictSSL: false` (or VS Code's `http.proxyStrictSSL: false`). For slow proxy links, raise `jenkinsBuilder.requestTimeoutMs` to `20000`–`30000`. The resolved proxy URL (credentials masked) is logged to the **Jenkins Builder** Output Channel for verification.

## Commands

See below or [docs/PRD.md §3](./docs/PRD.md#3-核心功能需求).

## License

[MIT](./LICENSE.md)
