# 开发、测试与发布

## 目录结构

```
dlsite-note-listen/
├── README.md                          # 仓库首页：安装入口 + 功能说明
├── RELEASE.md                         # Release 发布说明正文（复制进 GitHub Release 编辑框）
├── LICENSE                            # MIT
├── docs/
│   ├── FEATURES.md                    # 完整功能与规则
│   └── DEVELOPMENT.md                 # 本文件
└── userscript/
    └── dlsite-note-listen.user.js     # 主脚本 / 发布附件
```

## 本地校验

需要 Node.js 20 或更新版本：

```bash
node --check userscript/dlsite-note-listen.user.js
git diff --check
```

## 发布信息（v0.0.1 已填好）

| 项目 | 值 |
| --- | --- |
| GitHub 用户 | `senko171` |
| 安装链接 | `https://github.com/senko171/dlsite-note-listen/releases/download/v0.0.1/dlsite-note-listen.user.js` |
| 更新地址 | `https://github.com/senko171/dlsite-note-listen/releases/latest/download/dlsite-note-listen.user.js` |
| 仓库 | `https://github.com/senko171/dlsite-note-listen` |

用户名和安装链接都已替换完成，不需要再做占位符替换。安装链接用固定版本的 Release 附件，不依赖 commit SHA，所以纯网页上传也能用。

## 发布步骤（纯网页，不用命令行）

1. 在已建好的仓库页面点 `Add file` → `Upload files`，把本地整个目录的文件传上去（保留 `docs/` 和 `userscript/` 目录结构），提交。
2. 右侧 `Releases` → `Draft a new release`：
   - Tag：`v0.0.1`（脚本头部 `@version` 保持同步）
   - Title：`v0.0.1`
   - Description：粘贴 `RELEASE.md` 正文
   - Attach binaries：上传 `userscript/dlsite-note-listen.user.js`
   - `Publish release`
3. 发布后安装链接和更新地址同时生效。
4. 检查 README 顶部的安装链接能打开、脚本内容头部 `@version` 正确。

## 自动更新机制（用户侧怎么收到新版）

脚本内置了和参考插件 dlsite-best-deal 同样的自检机制，代码在 `userscript/dlsite-note-listen.user.js` 的「更新自检」段：

- 每 6 小时检查一次（`UPDATE_CHECK_INTERVAL_MS`），成功后记时间戳，失败不记、下次打开页面再试。
- 版本源两个：GitHub API `releases/latest` 和 jsDelivr `resolved?specifier=latest`，取两者中**较大**的版本号，避免任一源缓存到旧版误判。
- 有新版时右下角弹提示条「有新版本 vX.Y.Z（当前 vX.Y.Z）」+「去更新」+ 关闭按钮；点关闭记住该版本，不再重复提示。
- 「去更新」链接是 `https://cdn.jsdelivr.net/gh/senko171/dlsite-note-listen@v版本/userscript/dlsite-note-listen.user.js`（钉死版本 tag，不受 latest 缓存影响）。
- 脚本管理器自己的「检查更新」走 `@updateURL` / `@downloadURL` 的 `releases/latest/download/...` 永久地址，两条路独立、互不冲突。

## 后续版本（重要：改版本号要改两处）

1. 脚本头部 `@version` 改成新版本（如 `0.0.2`）。
2. 脚本常量 `const APP_VERSION = "0.0.1";` 也改成同一个版本号。**两处必须一致**，否则提示里的「当前版本」会算错。
3. README 顶部安装链接和备用入口里的 `v0.0.1` 改成新 tag。
4. `RELEASE.md` 按需更新本次改动说明。
5. 网页上传脚本文件 → 新建 Release（tag `v0.0.2`，附件仍叫 `dlsite-note-listen.user.js`）→ Publish。
6. 验证：老版本用户重新打开 DLsite 页面，6 小时内会自己弹更新提示；想立刻验证就在`备注`弹窗点「检查更新」。
