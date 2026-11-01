# 第三方说明

## 代码署名

本项目保留 qq-bridge / QSH 上游代码的 MIT 许可证和 `Derpyu520 and qq-bridge / QSH contributors` 署名，见根目录和 `qq-bridge-work/bridge/LICENSE`。新增源码沿用该许可。

## 依赖

| 组件 | 处理方式 |
| --- | --- |
| DeepSeek Harness 与 `@deepseek-ai/*` 包 | 使用独立安装的宿主及项目依赖；以各包的许可证为准，不附带完整宿主运行时 |
| `@modelcontextprotocol/sdk`、`js-yaml`、`zod`、TypeScript | 通过锁文件管理，保留各自包内许可证 |
| `silk-wasm` 3.7.1 | 固定版本随源码收录，保留 MIT 许可证、原README及署名；其WASM属于编解码依赖 |
| QQ客户端及原生库 | 不随本仓库分发；由用户在自己的本机环境中准备 |
| 语音、唱歌及其他模型资源 | 不随本仓库分发；分别遵循资源提供方的使用和分发条件 |

当前桥接的直接依赖清单不包含 `@snowluma/sdk` 或 `@snowluma/mcp`。部分兼容配置和源码文件仍沿用历史命名，这不代表仓库打包了 SnowLuma 本体。

## 图片素材

工作台角色插画由维护者提供的人设参考辅助生成，部分新版素材使用 `gpt-image-2.5-sunburst`。本仓库的代码许可证不代替可能涉及的角色、商标或其他第三方权利许可；复用素材前请自行确认适用范围。

本项目不是腾讯、QQ、DeepSeek或其他第三方的官方产品，也不表示获得其背书。
