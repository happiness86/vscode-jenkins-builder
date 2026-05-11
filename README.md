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

## Commands

See below or [docs/PRD.md §3](./docs/PRD.md#3-核心功能需求).

## License

[MIT](./LICENSE.md)
