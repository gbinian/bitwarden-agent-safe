# Bitwarden Agent Safe

Bitwarden Agent Safe 是一个跨平台 Codex 插件。它在官方 Bitwarden MCP server 前增加了一层默认拒绝的安全门面，支持 macOS 和 Windows，并将官方 MCP server 与 Bitwarden CLI 作为本地依赖锁定到确定版本。

本插件刻意采用纯本地设计：不包含远程 MCP 端点、代理服务、遥测，也不自行实现 Bitwarden 身份验证。

## 包含的三个阶段

1. 安全的官方会话控制：首次授权、状态检查、原生解锁、锁定与同步。
2. 精选的安全操作：脱敏元数据、创建使用随机生成密码的登录项，以及创建文件夹。
3. 轻量自动化策略：经过单独审批、完整性锁定的执行配置，并支持注入机密环境变量。

插件不会直接暴露官方的 `get`、`list`、删除、Send、附件、设备审批或组织管理工具。

## 前置条件

- macOS 或 Windows。
- Codex Desktop，以及其内置的 Node.js 22 或更新版本运行时。必要时，启动器会回退到系统安装的 Node.js 22+。
- Bitwarden 账户。首次登录可以从插件中发起，并在本地终端中完成。

插件运行时不依赖当前启用的 NVM 版本。它会优先通过 Codex 内置的 Node 运行时启动，并直接调用插件本地锁定的 `@bitwarden/cli` JavaScript 入口。

## 安装与验证

在插件目录中运行：

```text
node scripts/setup.mjs
node scripts/doctor.mjs
npm test
npm run validate:package
```

安装脚本会安装 `package-lock.json` 中记录的确切版本，其中包括本地 Bitwarden CLI。它不会登录、解锁保险库或读取凭据。从源码检出目录运行安装脚本仍需要 Node.js 22+；插件安装到 Codex 后，则会使用内置运行时启动器。

Windows 请在 PowerShell 中运行相同命令；macOS 请在终端中运行。插件同时包含 POSIX 和 Windows 的运行时发现实现。

请通过 Codex 本地或代码仓库市场安装插件。可选文件 `policies/codex-safe-config.toml` 提供了一份纵深防御的 Codex 审批配置示例；将类似设置合并到自己的 Codex 配置前，请先进行审查。

安装完成后，请新建一个 Codex 任务，使打包后的 skill 和 MCP server 从已安装的插件缓存中加载。

在插件的“立即试用”提示中选择 **Connect my Bitwarden account securely and check whether the vault is ready**。如果 CLI 尚未完成身份验证，插件会打开本地终端并运行官方 `bw login` 流程。电子邮箱、主密码以及两步登录验证码只能输入到该终端中；这些内容不会经过 MCP 或 Codex。登录完成后，再让 Codex 检查状态；如果保险库已锁定，现有的 `unlock` 工具会打开官方原生密码对话框。

## 对外提供的工具

| 阶段 | 工具 | 安全边界 |
| --- | --- | --- |
| 1 | `status`、`authorize`、`unlock`、`lock`、`sync` | `authorize` 在本地终端中打开官方 CLI 登录流程；凭据不会经过 MCP。`status` 只返回保险库状态。 |
| 2 | `list_item_metadata`、`get_item_metadata`、`create_generated_login`、`create_folder` | 使用固定的元数据允许列表；生成的密码绝不会返回给 Agent。 |
| 3 | `profile_propose`、`profile_request_approval`、`profile_list`、`profile_run` | 原生人工审批、HMAC 签名配置、可执行文件与文件哈希校验、禁止 shell、最小化子进程环境、仅记录状态的审计。 |

同一个 Agent 会话中不得在此安全门面之外再注册不受限制的官方 server，否则会重新开放直接读取机密和执行破坏性操作的工具。

## 审批配置

使用 `profile_propose` 创建待审批配置。它只返回不透明的提案 ID 和不含路径的摘要。审查摘要后，使用 `profile_request_approval` 打开本机原生确认对话框。本地可执行文件路径、工作目录、受监控文件以及 Bitwarden 项目绑定，只会显示在该对话框中，不会回显到工具响应。Agent 绝不能点击或自动操作这个审批对话框。

保险库项目名称和 ID 属于元数据，而不是公开数据。元数据工具会向 Codex 返回经过筛选的名称和标识符；作为工具参数提交的值，例如用户名、URI、本地路径或项目 ID，对模型可见，也可能出现在工具历史中。密码、TOTP 值、备注和生成的密码绝不会由此安全门面返回。

有关配置结构和安全边界的详细信息，请参阅插件内附 skill 的参考文档。

## 验证状态

- 测试套件使用模拟的 `bw` 可执行文件和真实锁定版本的官方 MCP 包，在不读取保险库的情况下覆盖完整的 stdio 调用链。
- GitHub Actions 已配置为在 `macos-latest` 与 `windows-latest` 上运行同一套测试。
- 真实 Bitwarden CLI/保险库冒烟测试不会自动执行，因为它需要用户凭据，并且可能修改保险库。
- 首次使用前请运行 `node scripts/doctor.mjs`。它只检查前置条件，不会读取凭据。

## 依赖安全维护

官方 Bitwarden CLI 和 MCP server 继续使用精确版本锁定，以保证可复现性。Dependabot 每天检查这两个包，并分别创建更新拉取请求。每次更新都必须通过 macOS 与 Windows 的安全门面测试，再由人工审查并合并；依赖更新不会自动合并。

另一个每日工作流会检查公开的 npm 安全公告数据库，在生产依赖存在高级或严重漏洞时失败，并在任一 Bitwarden 包不再是当前版本时失败。对于 CLI 中已知有漏洞的传递依赖，会临时覆盖为经过审查的修复版本，直到 Bitwarden 上游采用这些版本。不要运行 `npm audit fix --force`：npm 可能建议把采用日历版本号的 Bitwarden CLI 降级到更旧且不兼容的版本。

## 分发

本源码插件使用解释执行的 JavaScript，并不是原生 `.app`、`.pkg`、`.exe` 或 `.msi`，因此 Apple 公证和 Windows Authenticode 不适用于源码压缩包本身。分发源码时，请使用锁文件、发布校验和、受保护的发布标签与 CI 来源证明。如果以后增加原生安装程序，请单独对该安装程序签名或公证；详情参见 `docs/distribution.md`。
