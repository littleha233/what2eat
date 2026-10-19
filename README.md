# 吃什么（What2Eat）

拍照记下一餐，翻看最近三天、一周、一个月吃过什么，再决定今天想吃什么。首版是个人照片饮食日记，默认本地保存，无账号、后端、AI 或地图依赖。

[PRD V0.2](docs/PRD.md) 已取代旧产品范围；[交付与 L01–L10](docs/DELIVERY.md)、[决策](docs/DECISIONS.md)、[手机验收](docs/DEVICE-ACCEPTANCE.md)、[依赖审查](docs/DEPENDENCIES.md) 随实现维护。旧需求保存在 [历史归档](docs/archive/README.md)，不再作为本轮门槛。

## 当前版本

2026-10-19（Asia/Shanghai）：沿用 React Native + Expo SDK 57 + TypeScript 客户端：拍照/选图/文字保存、照片时间线、3/7/30 天与全部、详情、补记、修改和删除。SQLite 保存记录，APP 私有持久目录保存压缩照片及缩略图；原生界面和存储均为正式实现，没有模拟 AI 或示例餐馆。

**iOS 独立 Release 模拟器 APP 已完成纯文字基本流程；本阶段隔离原生存储检查的 11 项也已通过，包括照片保存、移除临时源后结束进程重开恢复、生产启动回收、替换和删除。** 生产界面的系统相册选图完整流程仍待验，Android 原生构建与双端真机拍照未执行，尚未完成 L01–L10 手机验收。

当前阶段补齐照片可靠性：启动时安全回收复制完成但数据库尚未提交就中断的孤立照片目录，已有原生照片处理与恢复的实际证据。系统相册交互、原生存储集成与真机验收分别记录，不以其中一类代替全部流程。

## 启动

推荐 Node 24（`.nvmrc`）；本机实际使用 Node 25.9.0。支持范围以 `package.json` 的 `engines` 为准。无需环境密钥或后端。

```bash
npm ci
npm run ios:release -- --device
```

选择已安装的 iPhone 17e 模拟器。此命令生成并安装内置 JS 的 Release APP，无需 Metro 持续运行。当前验证的是模拟器 `.app`，不是已签名真机 IPA。首次构建需要 Xcode 与 CocoaPods；本机 Xcode 27.0、CocoaPods 1.16.2 和 iOS 26.3.1 模拟器已可用。

开发时可用 `npm run ios` 或 `npm run android` 构建原生开发版本；`npm start` 启动 Expo 开发服务，匹配 SDK 的 Expo Go 可连接。Android 需要另行配置 SDK/模拟器或真机，本机尚未发现 SDK。

```bash
npm run typecheck
npm test
npm run export:ios
npm run export:android
npx expo install --check
npx expo-doctor
```

2026-10-19 最终类型检查、29/29 测试、两端生产 JS 导出、新版生产 iOS Release 构建和隔离 iOS 原生存储 11 项检查均通过，包含中断写入、启动回收与已提交照片保护。新版已安装并启动首页；实际拒绝相机权限后仍可保存文字，空记录保存按钮保持禁用。10 月 8 日的 Expo 依赖检查和 doctor 21/21 作为历史记录，本阶段未重跑；完整结果见[交付记录](docs/DELIVERY.md)。JS 导出不等于原生构建，存储集成不等于系统相册界面完整验收。`npm audit` 上次仍报告工具链上游漏洞，详见[依赖记录](docs/DEPENDENCIES.md)。

## 快速体验

1. 首页点击“记一餐”，拍照或选一张照片，其他字段不填即可保存；也可以只写一句“吃了什么”。
2. 首页默认最近 7 天，切换近三天、近一个月（30 天）和全部；点击卡片看详情。
3. 修改日期或补记过去的一餐，确认分组和范围变化；编辑文字/照片，再尝试删除。
4. 强制关闭 APP 并重开，检查图片和文字；先取得照片再断网，尝试保存、查看、修改和删除。

实际结果见[手机验收表](docs/DEVICE-ACCEPTANCE.md)。10 月 8 日纯文字基本流程已在独立 iOS APP 验证；10 月 19 日再次打开生产 APP 系统相册，自动化坐标点击返回 `noWindowsAvailable`，尚未完成选图保存的 UI 验收。原生日期控件已打开但未实际改期，飞行模式也未执行。浏览器预览使用独立 SQLite 与 localStorage 图片，仅为开发辅助，目前未运行验收。

## 本地保存

只在拍照或选图时请求必要权限，不申请定位，不自动上传图片或记录。**当前没有云备份；卸载 APP、清除应用数据或换设备可能丢失记录。** 使用测试图片验收，不清除需要保留的用户数据。

数据库与图片写入失败会保留编辑输入；替换和删除按引用关系回收图片，失败清理会重试。启动回收在开放保存操作前读取完整记录，仅移除未被引用、符合 APP 照片布局的 UUID 目录；数据库读取失败时不扫描，未知文件布局保留。中断留下的孤立照片可在下次启动清理，清理失败不阻断记录使用并留待后续启动重试。

测试图片、设备数据库和本地证据放在已忽略的 `local-data/`，不提交私人数据。

## Git 交付

`origin`：[littleha233/what2eat](https://github.com/littleha233/what2eat)，主分支 `main`。每个功能必要验证通过后，精确提交本任务文件、推送独立分支，检查 PR 全部差异、冲突及必需检查/审核后合并 main，核验远端 SHA。不强推、不绕过保护。

V0.2 初始实现 `5363ae2` 已通过 [PR #2](https://github.com/littleha233/what2eat/pull/2) 合并到 `main`（`60f21f8`）。10 月 19 日照片可靠性实现为 `ebcba76`，已推送 `origin/codex/photo-reliability-stage` 并创建 [PR #3](https://github.com/littleha233/what2eat/pull/3)；本阶段 CI、审核及合并结果以 PR 的实时记录为准。**本轮不部署、不上架。** Notion 保留进展与审计，最终 Done 留给人工验收。
