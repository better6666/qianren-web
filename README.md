# 前任 · 网页版

这是一个离线优先的私人对话档案工具。语料、角色、会话和导出备份默认仅保存在浏览器本地存储。网页提供可选的 Cloudflare Worker 在线模式：只有用户显式启用后，当前发送的消息才会转交给 Worker 代理；模型密钥不进入浏览器或此仓库。

## 本地开发

使用 Node.js 22 与 pnpm 10，执行 `pnpm install` 后运行 `pnpm dev`。执行 `pnpm run build` 可生成静态网站到 `dist/public`。

## 发布

推送到 `main` 后，GitHub Actions 会发布到 GitHub Pages。Cloudflare Worker 代码位于 `worker/`；部署后请使用 Cloudflare Secret 设置 `OPENAI_API_KEY`，否则在线模式会保持关闭而不影响离线功能。
