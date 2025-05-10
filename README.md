# VPS 监控面板 (Cloudflare Worker + D1 版) - 部署与使用指南

这是一个部署在 Cloudflare Workers 上的现代化 VPS 及网站监控面板，使用 Cloudflare D1 数据库存储数据，并通过美观的卡片式界面和图表展示服务器状态。本指南将引导你通过 Cloudflare 网页控制面板完成部署，无需使用命令行工具。

**主要特性:**

*   **实时服务器状态监控:** CPU、内存、硬盘使用率，网络流量和速度。
*   **卡片式 VPS 展示:** 每个 VPS 作为一个独立的卡片，信息清晰明了。
*   **悬停展开详情:** 鼠标悬停在 VPS 卡片上即可展开，显示详细的饼状图和24小时历史折线图。
*   **网站在线状态监控:** 监控指定网站的可用性、响应时间，并记录24小时历史。
*   **Telegram 通知:** 服务器离线/恢复、网站故障/恢复时，可配置通过 Telegram Bot 发送通知。
*   **后端管理:** 添加/编辑/删除服务器和监控网站，修改管理员密码，配置 Telegram。
*   **一键 Agent 安装脚本:** 方便在 VPS 上部署监控探针。
*   **多语言支持:** 内置中文和英文。
*   **主题切换:** 支持浅色和深色主题。
*   **数据自动修剪:** 定期清理旧的监控历史数据，保持数据库健康。

## 先决条件

*   一个 Cloudflare 账户。

## 部署步骤

### 1. 创建 D1 数据库

你需要一个 D1 数据库来存储面板数据（服务器列表、API 密钥、监控数据等）。

1.  登录 Cloudflare 控制面板。
2.  在左侧菜单中，找到并点击 **Workers 和 Pages**。
3.  在右侧，选择 **D1** 标签页。
4.  点击 **创建数据库**。
5.  为数据库**命名**（例如 `vps-monitor-db`），选择一个**位置**，然后点击 **创建**。


**重要：初始化数据库表**

 *   数据库创建后，你会看到数据库的概览页面。点击 `控制台` 标签页。
    *   复制下面的第一段 SQL 命令，粘贴到控制台的输入框中，然后点击 `执行`：
      ```sql
      CREATE TABLE IF NOT EXISTS admin_credentials (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL
      );
      ```
      
    *   复制下面的第二段 SQL 命令，粘贴并点击 `执行`：
      ```sql
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        api_key TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        sort_order INTEGER
      );
      ```
      
    *   复制下面的第三段 SQL 命令，粘贴并点击 `执行`：
      ```sql
      CREATE TABLE IF NOT EXISTS metrics (
        server_id TEXT PRIMARY KEY,
        timestamp INTEGER,
        cpu TEXT,
        memory TEXT,
        disk TEXT,
        network TEXT,
        FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
      );
      ```

    *   现在你的数据库表结构已经准备好了。

### 2. 创建并配置 Worker

接下来，创建 Worker 并将代码部署上去。

1.  在 Cloudflare 控制面板左侧菜单中，点击 **Workers 和 Pages**。
2.  在概览页面，点击 **创建应用程序**。
3.  选择 **创建 Worker**。
4.  为你的 Worker **命名**（例如 `vps-monitor-worker`），确保名称可用。
5.  点击 **部署**。
6.  部署完成后，点击 **编辑代码** 进入 Worker 编辑器。
7.  **删除编辑器中现有的所有代码。**
8.  **复制你收到的 `worker.js` 文件的全部内容。**
9.  将复制的代码粘贴到 Cloudflare Worker 编辑器中。
10. 点击编辑器右上角的 **部署** 按钮。


### 3. 绑定 D1 数据库到 Worker

Worker 需要访问你之前创建的 D1 数据库。

1.  在 Worker 的管理页面（编辑代码页面上方有 Worker 名称，点击它可以返回管理页面），选择 **设置** 标签页。
2.  在设置页面中，向下滚动到 **变量** 部分，找到 **D1 数据库绑定**。
3.  点击 **添加绑定**。
4.  在 **变量名称** 处输入 `DB` (**必须大写**)。
5.  在 **D1 数据库** 下拉菜单中，选择你之前创建的数据库 (例如 `vps-monitor-db`)。
6.  点击 **保存并部署**。


### 4. 设置 Cron 触发器 (用于网站和服务器状态检查)

1.  在 Worker 的管理页面，选择 **设置** 标签页。
2.  选择 **触发器** 子菜单。
3.  在 **Cron 触发器** 部分，点击 **添加 Cron 触发器**。
4.  **计划 (Cron 表达式):**
    *   为了实现每分钟检查一次（推荐用于快速检测），输入 `* * * * *`。
    *   如果想降低频率，例如每5分钟，输入 `*/5 * * * *`。
    *   Cloudflare 免费版 Worker 对 Cron 触发器有频率限制（例如，最快可能为每分钟或每5分钟）。
5.  点击 **添加**。

### 5. 访问面板

部署和绑定完成后，你的监控面板应该可以通过 Worker 的 URL 访问了。

*   在 Worker 的概览页面或设置页面，你会看到一个 `.workers.dev` 的 URL，例如 `vps-monitor-worker.your-subdomain.workers.dev`。
*   在浏览器中打开这个 URL，你应该能看到监控面板的前端界面。

## 使用面板

### 1. 初始登录

1.  访问你的 Worker URL。
2.  点击页面右上角的 **管理员登录** (或 Admin Login) 或直接访问 `/login` 路径。
3.  使用默认凭据登录：
    *   **用户名:** `admin`
    *   **密码:** `admin`
4.  登录后，强烈建议立即通过管理后台的 **修改密码** 功能更改密码。

### 2. 添加服务器 (VPS)

1.  登录管理后台后，进入 **服务器管理** 部分。
2.  点击 **添加服务器**。
3.  输入服务器的**名称**和可选的**描述**。
4.  点击 **保存**。
5.  面板会自动生成一个唯一的 **服务器 ID** 和 **API 密钥**。请**仔细记下这两个值**，部署 Agent 时会用到。你可以随时在服务器列表中点击对应服务器的 **查看密钥** 按钮来重新获取。

### 3. 部署 Agent (探针) 到你的 VPS

Agent 是一个需要在你的 VPS 上运行的脚本，用于收集状态信息并发送回面板。

1.  SSH 登录到你的 VPS。
2.  **下载并运行安装脚本：**
    脚本会自动从你的 Worker URL (`https://<你的Worker地址>/install.sh`) 下载。
    确保将 `<你的Worker地址>` 替换为你的实际 Worker URL。

    ```bash
    wget https://raw.githubusercontent.com/JohnMing143/vps-monitor/main/agent-vps-monitor.sh -O agent-vps-monitor.sh && chmod +x agent-vps-monitor.sh && ./agent-vps-monitor.sh
    ```
    或者使用 `curl`:
    ```bash
    curl -O https://raw.githubusercontent.com/JohnMing143/vps-monitor/main/agent-vps-monitor.sh && chmod +x agent-vps-monitor.sh && ./agent-vps-monitor.sh
    ```

    **请替换:**
    *   `YOUR_API_KEY` 为你在面板中为该服务器生成的 API 密钥。
    *   `YOUR_SERVER_ID` 为你在面板中为该服务器生成的服务器 ID。

    **可选参数:**
    *   `-u <自定义WorkerURL>`: 如果你想指定一个不同的 Worker URL（例如使用了自定义域名）。
    *   `-d <安装目录>`: 自定义 Agent 的安装目录 (默认为 `/opt/vps-monitor`)。

    安装脚本会自动安装依赖 (`bc`, `curl`, `ifstat`) 并将 Agent 设置为 systemd 服务，开机自启。

3.  安装完成后，Agent 会开始定期 (默认60秒) 向你的面板发送数据。你应该能在面板上看到对应服务器的状态更新。


### 4. 添加监控网站

1.  登录管理后台，进入 **网站监控管理** 部分。
2.  点击 **添加监控网站**。
3.  输入网站**名称**（可选）和网站的完整 **URL** (例如 `https://example.com`)。
4.  点击 **保存**。网站状态将开始被定期检查。

### 5. 配置 Telegram 通知

1.  **创建 Telegram Bot 并获取 Token:**
    *   在 Telegram 中搜索 `BotFather`。
    *   发送 `/newbot` 命令给 `BotFather`。
    *   按照提示为你的 Bot 设置名称和用户名。
    *   `BotFather` 会提供一个 **HTTP API Token**，复制并保存它。
2.  **获取你的 Chat ID:**
    *   在 Telegram 中搜索 `@userinfobot`。
    *   向它发送 `/start` 或任意消息，它会回复你的 **Chat ID**。复制并保存它。
    *   如果你想发送到群组，需要将 Bot 添加到群组，然后在群组中发送 `/my_id @你的Bot用户名`，或者使用其他方法获取群组 ID (通常为负数)。
3.  **在面板中配置:**
    *   登录管理后台，进入 **Telegram 通知设置**。
    *   将获取到的 **Bot Token** 和 **Chat ID** 填入对应输入框。
    *   勾选 **启用通知**。
    *   点击 **保存Telegram设置**。如果配置正确且启用了通知，你会收到一条测试消息。

## 注意事项

*   **Cloudflare 免费额度:** Cloudflare Worker 和 D1 对请求次数、运行时间、存储空间等有免费额度。对于少量服务器和网站的监控，免费额度通常足够。超出部分可能会产生费用，请查阅 Cloudflare 最新文档。
*   **安全性:** 默认管理员密码 `admin` 非常不安全，请务必在首次登录后立即修改。Agent 使用的 API 密钥也应妥善保管，不要泄露。
*   **错误处理:** 如果面板或 Agent 遇到问题：
    *   **面板问题:** 检查浏览器开发者控制台的错误信息。检查 Cloudflare 控制面板中对应 Worker 的日志。
    *   **Agent 问题:** 在 VPS 上使用 `sudo journalctl -u vps-monitor -f` 查看 Agent 的实时日志。
*   **代码来源:** 本项目代码基于用户需求由AI生成，并经过多次迭代优化。
