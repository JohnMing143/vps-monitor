# VPS Monitoring Panel (Cloudflare Worker + D1 Version) - Deployment and Usage Guide

This is a modern VPS and website monitoring panel deployed on Cloudflare Workers, using the Cloudflare D1 database to store data, and displaying server status through a beautiful card-style interface and charts. This guide will walk you through deploying it via the Cloudflare web control panel, without the need for command-line tools.

**Main Features:**

*   **Real-time server status monitoring:** CPU, memory, disk usage, network traffic, and speed.
*   **Card-style VPS display:** Each VPS as an independent card, with clear and concise information.
*   **Hover to expand details:** Hover over a VPS card to expand and display detailed pie charts and 24-hour historical line charts.
*   **Website online status monitoring:** Monitor the availability and response time of specified websites, and record 24-hour history.
*   **Telegram notifications:** Configurable to send notifications via Telegram Bot when servers go offline/recover or websites fail/recover.
*   **Backend management:** Add/edit/delete servers and monitored websites, modify admin password, and configure Telegram.
*   **One-click Agent installation script:** Easily deploy the monitoring probe on your VPS.
*   **Multi-language support:** Built-in Chinese and English.
*   **Theme switching:** Supports light and dark themes.
*   **Data auto-trimming:** Regularly clean up old monitoring history data to keep the database healthy.

## Prerequisites

*   A Cloudflare account.

## Deployment Steps

### 1. Create D1 Database

You need a D1 database to store panel data (server list, API keys, monitoring data, etc.).

1.  Log in to the Cloudflare control panel.
2.  In the left menu, find and click **Workers and Pages**.
3.  On the right, select the **D1** tab.
4.  Click **Create Database**.
5.  Name the database (e.g., `vps-monitor-db`), select a **location**, and then click **Create**.


**Important: Initialize Database Tables**

 - **Step 1: After database creation**  
   You will see the database overview page. Click the `Console` tab.

- **Step 2: Execute the first SQL command**  
   Copy the following SQL command, paste it into the console input box, and then click `Execute`:  
   ```sql
   CREATE TABLE IF NOT EXISTS admin_credentials (
     username TEXT PRIMARY KEY,
     password TEXT NOT NULL
   );
   ```

- **Step 3: Execute the second SQL command**  
   Copy the following SQL command, paste it, and click `Execute`:  
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

- **Step 4: Execute the third SQL command**  
   Copy the following SQL command, paste it, and click `Execute`:  
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

    *   Now your database table structure is ready.

### 2. Create and Configure Worker

Next, create the Worker and deploy the code.

1.  In the Cloudflare control panel left menu, click **Workers and Pages**.
2.  On the overview page, click **Create Application**.
3.  Select **Create Worker**.
4.  Name your Worker (e.g., `vps-monitor-worker`), ensuring the name is available.
5.  Click **Deploy**.
6.  After deployment, click **Edit Code** to enter the Worker editor.
7.  **Delete all existing code in the editor.**
8.  **Copy the full content of the `worker.js` file you received.**
9.  Paste the copied code into the Cloudflare Worker editor.
10. Click the **Deploy** button in the top right of the editor.


### 3. Bind D1 Database to Worker

The Worker needs access to the D1 database you created earlier.

1.  In the Worker's management page (from the code editor page, above the Worker name, click it to return to the management page), select the **Settings** tab.
2.  On the settings page, scroll down to the **Variables** section, and find **D1 Database Bindings**.
3.  Click **Add Binding**.
4.  In the **Variable Name** field, enter `DB` (**must be uppercase**).
5.  In the **D1 Database** dropdown menu, select the database you created earlier (e.g., `vps-monitor-db`).
6.  Click **Save and Deploy**.


### 4. Set Up Cron Triggers (for Website and Server Status Checks)

1.  In the Worker's management page, select the **Settings** tab.
2.  Select the **Triggers** submenu.
3.  In the **Cron Triggers** section, click **Add Cron Trigger**.
4.  **Schedule (Cron Expression):**
    *   Choose `Schedule`, set the frequency to `Hour`, and fill in 1 in the box below (i.e., check websites once per hour).
    *   Cloudflare free tier Workers have frequency limits for Cron triggers.
5.  Click **Add**.

### 5. Access the Panel

After deployment and binding, your monitoring panel should be accessible via the Worker's URL.

*   On the Worker's overview or settings page, you'll see a `.workers.dev` URL, for example, `vps-monitor-worker.your-subdomain.workers.dev`.
*   Open this URL in your browser, and you should see the monitoring panel's frontend interface.

## Using the Panel

### 1. Initial Login

1.  Access your Worker URL.
2.  Click **Admin Login** in the top right of the page (or Admin Login) or directly visit the `/login` path.
3.  Log in using the default credentials:
    *   **Username:** `admin`
    *   **Password:** `admin`
4.  After logging in, it's strongly recommended to immediately change the password via the management backend's **Change Password** feature.

### 2. Add Server (VPS)

1.  After logging into the management backend, go to the **Server Management** section.
2.  Click **Add Server**.
3.  Enter the server's **name** and optional **description**.
4.  Click **Save**.
5.  The panel will automatically generate a unique **Server ID** and **API Key**. **Make sure to note these two values carefully**, as they will be needed when deploying the Agent. You can retrieve them anytime by clicking the **View Key** button for the corresponding server in the server list.

### 3. Deploy Agent (Probe) to Your VPS

The Agent is a script that needs to run on your VPS to collect status information and send it back to the panel.

1.  SSH into your VPS.
2.  **Download and run the installation script:**
    
    ```bash
    wget https://raw.githubusercontent.com/JohnMing143/vps-monitor/main/agent-vps-monitor.sh -O agent-vps-monitor.sh && chmod +x agent-vps-monitor.sh && ./agent-vps-monitor.sh
    ```
    Or using `curl`:
    ```bash
    curl -O https://raw.githubusercontent.com/JohnMing143/vps-monitor/main/agent-vps-monitor.sh && chmod +x agent-vps-monitor.sh && ./agent-vps-monitor.sh
    ```

    **Please replace:**
    *   `YOUR_API_KEY` with the API key generated for the server in the panel.
    *   `YOUR_SERVER_ID` with the server ID generated for the server in the panel.

    **Optional parameters:**
    *   `-u <custom Worker URL>`: If you want to specify a different Worker URL (e.g., using a custom domain).
    *   `-d <installation directory>`: Customize the Agent's installation directory (default is `/opt/vps-monitor`).

    The installation script will automatically install dependencies (`bc`, `curl`, `ifstat`) and set up the Agent as a systemd service for auto-start on boot.

3.  After installation, the Agent will start sending data to your panel periodically (default 60 seconds). You should see the corresponding server status updates on the panel.


### 4. Add Monitored Website

1.  Log in to the management backend and go to the **Website Monitoring Management** section.
2.  Click **Add Monitored Website**.
3.  Enter the website's **name** (optional) and the full **URL** (e.g., `https://example.com`).
4.  Click **Save**. The website status will start being checked periodically.

### 5. Configure Telegram Notifications

1.  **Create a Telegram Bot and Get the Token:**
    *   Search for `BotFather` in Telegram.
    *   Send the `/newbot` command to `BotFather`.
    *   Follow the prompts to set a name and username for your Bot.
    *   `BotFather` will provide an **HTTP API Token**; copy and save it.
2.  **Get Your Chat ID:**
    *   Search for `@userinfobot` in Telegram.
    *   Send it `/start` or any message, and it will reply with your **Chat ID**. Copy and save it.
    *   If you want to send to a group, add the Bot to the group, then send `/my_id @yourBotUsername` in the group, or use other methods to get the group ID (usually negative).
3.  **Configure in the Panel:**
    *   Log in to the management backend and go to **Telegram Notification Settings**.
    *   Enter the obtained **Bot Token** and **Chat ID** in the corresponding input boxes.
    *   Check **Enable Notifications**.
    *   Click **Save Telegram Settings**. If configured correctly and notifications are enabled, you will receive a test message.

## Notes

*   **Cloudflare Free Quotas:** Cloudflare Workers and D1 have free quotas for request counts, runtime, and storage space. For a small number of servers and websites, the free quotas are usually sufficient. Exceeding them may incur costs, so please check the latest Cloudflare documentation.
*   **Security:** The default admin password `admin` is very insecure, so be sure to change it immediately after your first login. The API keys used by the Agent should also be kept secure and not leaked.
*   **Error Handling:** If issues occur with the panel or Agent:
    *   **Panel issues:** Check the browser developer console for error messages. Check the logs for the corresponding Worker in the Cloudflare control panel.
    *   **Agent issues:** On your VPS, use `sudo journalctl -u vps-monitor -f` to view the Agent's real-time logs.
*   **Code Source:** This project code was generated based on user needs by AI and has undergone multiple iterations for optimization.
