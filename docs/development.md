# 开发与环境准备

## 仓库提供什么

此仓库提供应用源码、构建脚本、公开配置模板和工作台素材。它不提供完整安装介质，克隆仓库不会自动复制任何个人账号、模型、声音或会话。

当前部署结构为：

```text
项目目录/
  deployment/DeepSeek-Harness-Windows/
    runtime/node-v24.15.0-win-x64/
    engine/node_modules/@deepseek-ai/dsh/
  qq-bridge-work/
    bridge/
    integration/
    native-research/
    vendor/
```

原生链路的已有适配以 QQNT `9.9.35-52892` 和固定宿主摘要为基线。原生SDK、Node宿主、编译器、导入闭包摘要及语音资源需要在自己的合法本机环境中准备。源码内的摘要验证会拒绝不匹配的组合；不要删除这些检查来绕过准备步骤。

安装器脚本面向完整部署布局，依赖源码仓库没有附带的资源和环境清单，不能把它当作纯源码克隆的一键安装器。准备工作完成后，先阅读 `qq-bridge-work/integration/prepare.mjs` 的目录约束，再使用根目录启动入口。

## 应用源码构建

在 `qq-bridge-work/bridge` 目录准备项目依赖：

```powershell
npm ci --ignore-scripts --legacy-peer-deps
npm run typecheck
npm run typecheck:console
npm run build:typed
npm run build:console
npm run build:workbench
```

保持锁文件版本。运行加载生成的JS；修改TypeScript后应同步生成物，工作台则修改 `client/workbench.js`、`client/management.js` 和CSS后重新构建 `lib/client.js`。

```powershell
npm run check:generated
npm run check:console
```

工作台将压缩WebP嵌入前端产物，构建限制为512KiB。原始插画不属于构建必需文件。页面截图在 `docs/screenshots/`，应使用合成数据，避免显示真实账号或二维码。

## 原生与资源组件

电话宿主源码包括原始宿主、NTRTC音频接口和私聊信令适配。`build-ntrtc-host.py` 仍依赖项目内固定工具链、QQ提供的本机组件和对应摘要文件；这些不是 npm 构建的一部分。

SILK编解码使用仓库中的固定版本依赖，并逐文件校验摘要。语音识别、合成和唱歌工作进程需要按模板准备各自资源，模型权重和个人声音不随仓库分发。

## 维护约定

- `.gitignore` 使用逐文件收录规则，新增源码需要明确加入白名单。
- 不提交 `integration/data`、账号目录、日志、密钥、模型、运行缓存、备份及个人角色。
- 日常QQ连接在工作台内完成；外部救援入口仅用于工作台本身不可达时恢复。
- 不把受理回执、源码构建通过或页面状态等同于所有实际业务已经成功。
