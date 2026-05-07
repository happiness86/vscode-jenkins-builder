# Jenkins Builder — Agent brief

面向 AI：本文件是单页速览；细则与验收以仓库内文档为准（见下方索引）。

## 是什么

VS Code / Cursor 扩展：**单 Jenkins 实例**、登录（username + API Token 存 `SecretStorage`）、绑定工作区 Job、侧栏看构建、**按当前 Git 分支触发参数化构建**、流式日志与停止构建。目标比官方 Workbench 更轻，且可上架 Open VSX（Cursor）与 VS Marketplace。

## 技术栈与运行

| 项 | 说明 |
|----|------|
| 宿主 | `engines.vscode` 见 `package.json`（当前 `^1.97.0`） |
| 构建 | `pnpm`；入口 `src/index.ts` → `dist/index.cjs`（`tsdown`，`vscode` external） |
| 框架 | `reactive-vscode`（`defineExtension`、`useCommand`、`useTreeView`、`useStatusBarItem` 等） |
| 测试 | `vitest`；优先测 `jenkins/url`、`JenkinsClient` 错误归一化、`BuildTracker` 顺序 |

## 源码地图（与实现对齐）

| 职责 | 路径 |
|------|------|
| 扩展入口、命令、双 TreeView、Trigger、状态栏 | `src/index.ts` |
| HTTP / Jenkins REST | `src/jenkins/client.ts`、`src/jenkins/types.ts`、`src/jenkins/url.ts` |
| Git 分支 | `src/git-branch.ts` |
| 构建完成追踪与通知（须先刷新再 toast） | `src/services/build-tracker.ts` |
| OutputChannel 日志流 | `src/services/log-stream.ts` |
| 树节点与 Job 加载辅助 | `src/tree/helpers.ts` |
| 密钥键名等 | `src/constants.ts` |
| `contributes` 元数据生成 | `src/generated/meta.ts`（`pnpm run update`） |

设计文档里的目录名（如 `views/*-provider.ts`）是规划参考；**以当前 `src/` 为准**。

## 硬约束（改 Trigger / 侧栏 / 通知前必读）

**PRD §3.6** 与 **TECHNICAL_DESIGN §4 / §4.1** 成对约束，缺一不可：

1. **Trigger**：队列解析出 `executable` 后须**立即**刷新 Current Project + All Jobs；构建 `building === true` 期间短间隔（约 2s）刷新侧栏。  
2. **终态**：判定 `building === false` 后，须**先于** `showInformationMessage` / `showErrorMessage` 完成双树刷新（`BuildTracker.onBuildFinished` 顺序）。

禁止仅靠 `refreshIntervalSec` 定时器作为 Trigger 相关 UI 的唯一更新路径。

## 配置与密钥（摘要）

- Settings：`jenkinsBuilder.baseUrl`、`username`、`projectJob`（工作区）、`branchParamName`、`refreshIntervalSec`、`recentBuildCount`、`notifyOnFinish`。  
- Token：**仅** `SecretStorage`，不得写入 `settings.json` 或日志。  
- 全文表格：`docs/PRD.md` §5。

## 功能边界（MVP）

**包含**：登录/登出、绑定 Job、All Jobs（含搜索/懒加载等实现细节见 PRD）、控制台日志、Stop、按分支 Trigger、完成通知（可配置）。  

**不含**：多 Jenkins、收藏、Pipeline 阶段图、产物下载、浏览器打开 Job（PRD §7；若 `package.json` 仍有相关命令，以 PRD 与代码实际行为为准）。

---

## 文档索引（详细说明）

| 文档 | 用途 |
|------|------|
| [docs/README.md](docs/README.md) | 文档导航；PRD §3.6 与 TECH §4 成对约束提示 |
| [docs/PRD.md](docs/PRD.md) | 需求、配置表、验收清单、里程碑、调试与联调（§4） |
| [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md) | 分层架构、模块表、Trigger 序列、**§4.1 实现落点**、`package.json` 映射、安全与测试要求 |
| [README.md](README.md) | 人类读者的快速开始、打包 |

## 常用命令（开发）

- `pnpm install` / `pnpm dev`（watch 构建）+ **F5** Run Extension  
- `pnpm test` / `pnpm typecheck` / `pnpm lint`  
- `pnpm run ext:package` → `.vsix`
