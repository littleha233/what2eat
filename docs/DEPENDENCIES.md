# 依赖审查记录

2026-10-07，Expo SDK 57 / React Native 0.86.3。`npm audit --json` 初次报告 23 个受影响包条目（16 high、7 moderate），根因是三个上游 advisory；不是 23 个独立漏洞。

## 已处理

仅覆盖 `xcode@3.0.1 → uuid` 到 **11.1.1**，保留 Expo/RN/日期控件版本。该版修复 [uuid buffer 边界漏洞](https://github.com/advisories/GHSA-w5hq-g745-h8pq) 并支持 CommonJS。覆盖后的 Expo prebuild、依赖匹配、doctor 和 iOS Release 构建已通过；2026-10-08 的第二次 Release 增量构建再次通过。项目的 xcode 路径只使用无 buffer 的 `uuid.v4()`。

## 剩余审计结果

当前 `npm audit` 仍非零：**16 high 受影响包条目，来自以下两个上游漏洞**。

| 根依赖与路径 | 实际用途 | 修复状态 |
| --- | --- | --- |
| `expo → @expo/metro → metro-file-map → micromatch@4.0.8 → braces@3.0.3`；RN CLI 共用 Metro | 开发机监听和打包 glob；当前模式来自项目配置，不由餐食字段生成 | [深层模式栈耗尽](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)；最新 3.0.3 仍受影响，无发布修复版 |
| `expo → @expo/cli → node-forge@1.4.0`，以及 `@expo/code-signing-certificates → node-forge` | Expo 工具的证书解析和签名校验；存在校验调用，不能概括为永不触发 | [RSA 签名校验缺陷](https://github.com/advisories/GHSA-86w9-cpqp-85rv)；最新 1.4.0 仍受影响，无发布修复版 |

这是工具链路径的分析，不是手机安装包全量安全证明。Expo 将工具随 production dependencies 安装，`--omit=dev` 不能代替运行时分析。

未执行 `npm audit fix --force`。其建议降级 Expo 44、RN 0.72 和日期控件会破坏 SDK 57 组合；当前保留兼容版本和审计结果。后续采用上游修复时重新执行 audit、Expo 依赖检查、prebuild 和相关构建；启用外部证书/更新签名功能前复核 node-forge 路径。不能将此次审计写为安全检查全部通过。

原始本地报告在被忽略的 `local-data/dependency-audit.json`，不随仓库发布。
