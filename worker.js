const D1_SCHEMAS = {
    admin_credentials: `
      CREATE TABLE IF NOT EXISTS admin_credentials (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL
      );
      INSERT OR IGNORE INTO admin_credentials (username, password) VALUES ('admin', 'admin');
    `,
    servers: `
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        api_key TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        sort_order INTEGER,
        last_notified_down_at INTEGER DEFAULT NULL
      );
    `,
    metrics: `
      CREATE TABLE IF NOT EXISTS metrics (
        server_id TEXT PRIMARY KEY,
        timestamp INTEGER,
        cpu TEXT,
        memory TEXT,
        disk TEXT,
        network TEXT,
        FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
      );
    `,
    server_metrics_history: `
      CREATE TABLE IF NOT EXISTS server_metrics_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        cpu_percent REAL,
        memory_percent REAL,
        FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_server_metrics_history_server_id_timestamp ON server_metrics_history (server_id, timestamp DESC);
    `,
    monitored_sites: `
      CREATE TABLE IF NOT EXISTS monitored_sites (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        name TEXT,
        added_at INTEGER NOT NULL,
        last_checked INTEGER,
        last_status TEXT DEFAULT 'PENDING',
        last_status_code INTEGER,
        last_response_time_ms INTEGER,
        sort_order INTEGER,
        last_notified_down_at INTEGER DEFAULT NULL
      );
    `,
    site_status_history: `
      CREATE TABLE IF NOT EXISTS site_status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        status TEXT NOT NULL,
        status_code INTEGER,
        response_time_ms INTEGER,
        FOREIGN KEY(site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_site_status_history_site_id_timestamp ON site_status_history (site_id, timestamp DESC);
    `,
    telegram_config: `
      CREATE TABLE IF NOT EXISTS telegram_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        bot_token TEXT,
        chat_id TEXT,
        enable_notifications INTEGER DEFAULT 0,
        updated_at INTEGER
      );
      INSERT OR IGNORE INTO telegram_config (id, bot_token, chat_id, enable_notifications, updated_at) VALUES (1, NULL, NULL, 0, NULL);
    `
  };
 
  
  async function ensureTablesExist(db) {
    // console.log("Ensuring all database tables exist..."); // Less verbose
    const createTableStatements = Object.values(D1_SCHEMAS).map(sql => db.prepare(sql));
    try { await db.batch(createTableStatements); /* console.log("Database tables verified/created successfully."); */ }
    catch (error) { console.error("Error during initial table creation:", error); }
  
    const alterStatements = [
      "ALTER TABLE monitored_sites ADD COLUMN last_notified_down_at INTEGER DEFAULT NULL",
      "ALTER TABLE servers ADD COLUMN last_notified_down_at INTEGER DEFAULT NULL"
    ];
    for (const alterSql of alterStatements) {
      try { await db.exec(alterSql); }
      catch (e) { if (!(e.message && (e.message.includes("duplicate column name") || e.message.includes("already exists")))) console.error(`Error executing ALTER: "${alterSql}":`, e); }
    }
  }
  
  async function handleApiRequest(request, env, ctx) {
    const url = new URL(request.url); const path = url.pathname; const method = request.method;
    const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key', };
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  
    if (path === '/api/auth/login' && method === 'POST') {
      try {
        const { username, password } = await request.json();
        let result = await env.DB.prepare('SELECT password FROM admin_credentials WHERE username = ?').bind(username).first();
        let storedPassword = result ? result.password : null;
        if (!result && username === 'admin') {
          const defaultPassword = 'admin';
          try { await env.DB.prepare('INSERT OR IGNORE INTO admin_credentials (username, password) VALUES (?, ?)').bind('admin', defaultPassword).run(); storedPassword = defaultPassword; }
          catch (dbError) { if (dbError.message.includes('no such table')) { await env.DB.exec(D1_SCHEMAS.admin_credentials); storedPassword = defaultPassword; } else { throw dbError; }}
        }
        if (storedPassword && password === storedPassword) return new Response(JSON.stringify({ token: btoa(username + ':' + Date.now()) }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
        return new Response(JSON.stringify({ error: 'Invalid credentials', message: '用户名或密码错误' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
      } catch (error) { console.error("Login error:", error); return new Response(JSON.stringify({ error: 'Internal server error', message: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}); }
    }
    if (path === '/api/auth/status' && method === 'GET') { const authHeader = request.headers.get('Authorization'); return new Response(JSON.stringify({ authenticated: authHeader && authHeader.startsWith('Bearer ') }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }}); }
    if (path === '/api/servers' && method === 'GET') {
      try { const { results } = await env.DB.prepare('SELECT id, name, description FROM servers ORDER BY sort_order ASC NULLS LAST, name ASC').all(); return new Response(JSON.stringify({ servers: results || [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }}); }
      catch (error) { console.error("Get servers error:", error); if (error.message.includes('no such table')) { try { await env.DB.exec(D1_SCHEMAS.servers); return new Response(JSON.stringify({ servers: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }}); } catch (ce) {return new Response(JSON.stringify({ error: 'DB error', message: ce.message }), { status: 500, headers: corsHeaders });}} return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
    if (path.startsWith('/api/status/') && method === 'GET') {
      try {
        const serverId = path.split('/').pop();
        const serverData = await env.DB.prepare('SELECT id, name, description FROM servers WHERE id = ?').bind(serverId).first();
        if (!serverData) return new Response(JSON.stringify({ error: 'Server not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
        const metricsResult = await env.DB.prepare('SELECT timestamp, cpu, memory, disk, network FROM metrics WHERE server_id = ?').bind(serverId).first();
        let metricsData = null;
        if (metricsResult) { try { metricsData = { timestamp: metricsResult.timestamp, cpu: JSON.parse(metricsResult.cpu || '{}'), memory: JSON.parse(metricsResult.memory || '{}'), disk: JSON.parse(metricsResult.disk || '{}'), network: JSON.parse(metricsResult.network || '{}') }; } catch (e) { console.error(`Parse metrics JSON error for ${serverId}:`, e); metricsData = { timestamp: metricsResult.timestamp };}}
        return new Response(JSON.stringify({ server: serverData, metrics: metricsData }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
      } catch (error) { console.error("Get status error:", error); if (error.message.includes('no such table')) { try { await env.DB.batch([env.DB.prepare(D1_SCHEMAS.servers), env.DB.prepare(D1_SCHEMAS.metrics)]); return new Response(JSON.stringify({ error: 'Server not found (tables created)' }), { status: 404, headers: corsHeaders }); } catch (ce) {return new Response(JSON.stringify({ error: 'DB error', message: ce.message }), { status: 500, headers: corsHeaders });} } return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders }); }
    }
    if (path.match(/\/api\/servers\/[^\/]+\/history$/) && method === 'GET') {
      try {
        const serverId = path.split('/')[3]; const now = Math.floor(Date.now() / 1000); const ago = now - (24 * 60 * 60);
        const { results } = await env.DB.prepare('SELECT timestamp, cpu_percent, memory_percent FROM server_metrics_history WHERE server_id = ? AND timestamp >= ? ORDER BY timestamp ASC').bind(serverId, ago).all();
        return new Response(JSON.stringify({ history: results || [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
      } catch (error) { console.error("Get server metrics history error:", error); if (error.message.includes('no such table')) { try { await env.DB.exec(D1_SCHEMAS.server_metrics_history); return new Response(JSON.stringify({ history: [] }), { headers: corsHeaders });} catch (ce) { console.error("Failed to create server_metrics_history table:", ce); }} return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
  
    const isAdminRequest = path.startsWith('/api/admin/') || path.startsWith('/api/auth/change-password');
    if (isAdminRequest) { const authH = request.headers.get('Authorization'); if (!authH || !authH.startsWith('Bearer ')) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });}
  
    if (path === '/api/admin/servers' && method === 'GET') {
      try { const { results } = await env.DB.prepare(`SELECT s.id, s.name, s.description, s.created_at, s.sort_order, s.last_notified_down_at, m.timestamp as last_report FROM servers s LEFT JOIN metrics m ON s.id = m.server_id ORDER BY s.sort_order ASC NULLS LAST, s.name ASC`).all(); return new Response(JSON.stringify({ servers: results || [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }}); }
      catch (error) { console.error("Admin get servers error:", error); if (error.message.includes('no such table')) { try { await env.DB.batch([env.DB.prepare(D1_SCHEMAS.servers), env.DB.prepare(D1_SCHEMAS.metrics)]); return new Response(JSON.stringify({ servers: [] }), { headers: corsHeaders }); } catch (ce) {return new Response(JSON.stringify({ error: 'DB error', message: ce.message }), { status: 500, headers: corsHeaders });}} return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
    if (path === '/api/admin/servers' && method === 'POST') {
      try {
        const { name, description } = await request.json(); if (!name) return new Response(JSON.stringify({ error: 'Server name is required' }), { status: 400, headers: corsHeaders });
        const serverId = Math.random().toString(36).substring(2, 10); const apiKey = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15); const createdAt = Math.floor(Date.now() / 1000);
        const maxOrderResult = await env.DB.prepare('SELECT MAX(sort_order) as max_order FROM servers').first(); const nextSortOrder = (maxOrderResult && typeof maxOrderResult.max_order === 'number') ? maxOrderResult.max_order + 1 : 0;
        await env.DB.prepare('INSERT INTO servers (id, name, description, api_key, created_at, sort_order) VALUES (?, ?, ?, ?, ?, ?)').bind(serverId, name, description || '', apiKey, createdAt, nextSortOrder).run();
        return new Response(JSON.stringify({ server: { id: serverId, name, description: description || '', api_key: apiKey, created_at: createdAt, sort_order: nextSortOrder } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
      } catch (error) { console.error("Admin add server error:", error); if (error.message.includes('UNIQUE constraint')) return new Response(JSON.stringify({ error: 'Server ID/API Key conflict', message: '服务器ID或API密钥冲突' }), { status: 409, headers: corsHeaders }); if (error.message.includes('no such table')) { try { await env.DB.exec(D1_SCHEMAS.servers); return new Response(JSON.stringify({ error: 'DB table created, retry', message: '数据库表已创建，请重试' }), { status: 503, headers: corsHeaders }); } catch (ce) {return new Response(JSON.stringify({ error: 'DB error', message: ce.message }), { status: 500, headers: corsHeaders });}} return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
    if (path.match(/\/api\/admin\/servers\/[^\/]+$/) && method === 'DELETE') {
      try { const serverId = path.split('/').pop(); const { changes } = await env.DB.prepare('DELETE FROM servers WHERE id = ?').bind(serverId).run(); if (changes === 0) return new Response(JSON.stringify({ error: 'Server not found' }), { status: 404, headers: corsHeaders }); return new Response(JSON.stringify({ success: true }), { headers: corsHeaders }); }
      catch (error) { console.error("Admin delete server error:", error); return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
    if (path.match(/\/api\/admin\/servers\/[^\/]+$/) && method === 'PUT') {
      try {
        const serverId = path.split('/').pop(); const { name, description } = await request.json(); if (!name) return new Response(JSON.stringify({ error: 'Server name is required' }), { status: 400, headers: corsHeaders });
        let setClauses = [], bindings = []; if (name !== undefined) { setClauses.push("name = ?"); bindings.push(name); } if (description !== undefined) { setClauses.push("description = ?"); bindings.push(description || ''); }
        if (setClauses.length === 0) return new Response(JSON.stringify({ error: 'No fields to update' }), { status: 400, headers: corsHeaders });
        bindings.push(serverId); const { changes } = await env.DB.prepare(`UPDATE servers SET ${setClauses.join(', ')} WHERE id = ?`).bind(...bindings).run();
        if (changes === 0) return new Response(JSON.stringify({ error: 'Server not found' }), { status: 404, headers: corsHeaders }); return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch (error) { console.error("Admin update server error:", error); return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
    if (path.startsWith('/api/report/') && method === 'POST') {
      try {
        const serverId = path.split('/').pop(); const apiKey = request.headers.get('X-API-Key'); if (!apiKey) return new Response(JSON.stringify({ error: 'API key required' }), { status: 401, headers: corsHeaders });
        const serverData = await env.DB.prepare('SELECT api_key FROM servers WHERE id = ?').bind(serverId).first();
        if (!serverData) return new Response(JSON.stringify({ error: 'Server not found' }), { status: 404, headers: corsHeaders }); if (serverData.api_key !== apiKey) return new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 401, headers: corsHeaders });
        const reportData = await request.json(); if (!reportData.timestamp || !reportData.cpu || !reportData.memory || !reportData.disk || !reportData.network) return new Response(JSON.stringify({ error: 'Invalid data format' }), { status: 400, headers: corsHeaders });
        await env.DB.prepare(`REPLACE INTO metrics (server_id, timestamp, cpu, memory, disk, network) VALUES (?, ?, ?, ?, ?, ?)`).bind(serverId, reportData.timestamp, JSON.stringify(reportData.cpu), JSON.stringify(reportData.memory), JSON.stringify(reportData.disk), JSON.stringify(reportData.network)).run();
        const cpuPercent = reportData.cpu && typeof reportData.cpu.usage_percent === 'number' ? reportData.cpu.usage_percent : null;
        const memoryPercent = reportData.memory && typeof reportData.memory.usage_percent === 'number' ? reportData.memory.usage_percent : null;
        if (cpuPercent !== null || memoryPercent !== null) { await env.DB.prepare(`INSERT INTO server_metrics_history (server_id, timestamp, cpu_percent, memory_percent) VALUES (?, ?, ?, ?)`).bind(serverId, reportData.timestamp, cpuPercent, memoryPercent).run(); }
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch (error) { console.error("Report API error:", error); if (error.message.includes('no such table')) { try { await env.DB.batch([env.DB.prepare(D1_SCHEMAS.servers), env.DB.prepare(D1_SCHEMAS.metrics), env.DB.prepare(D1_SCHEMAS.server_metrics_history)]); return new Response(JSON.stringify({ error: 'DB tables created, retry', message: '数据库表已创建，请重试' }), { status: 503, headers: corsHeaders }); } catch (ce) {return new Response(JSON.stringify({ error: 'DB error', message: ce.message }), { status: 500, headers: corsHeaders });}} return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
    if (path.match(/\/api\/admin\/servers\/[^\/]+\/key$/) && method === 'GET') {
      try { const serverId = path.split('/')[4]; const result = await env.DB.prepare('SELECT api_key FROM servers WHERE id = ?').bind(serverId).first(); if (!result) return new Response(JSON.stringify({ error: 'Server not found' }), { status: 404, headers: corsHeaders }); return new Response(JSON.stringify({ api_key: result.api_key }), { headers: corsHeaders }); }
      catch (error) { console.error("Admin get API key error:", error); return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
    if (path.match(/\/api\/admin\/servers\/[^\/]+\/reorder$/) && method === 'POST') {
      try {
        const serverId = path.split('/')[4]; const { direction } = await request.json(); if (!direction || !['up', 'down'].includes(direction)) return new Response(JSON.stringify({ error: 'Invalid direction' }), { status: 400, headers: corsHeaders });
        const allServers = (await env.DB.prepare('SELECT id, sort_order FROM servers ORDER BY sort_order ASC NULLS LAST, name ASC').all()).results;
        const currentIndex = allServers.findIndex(s => s.id === serverId); if (currentIndex === -1) return new Response(JSON.stringify({ error: 'Server not found' }), { status: 404, headers: corsHeaders });
        let targetIndex = (direction === 'up' && currentIndex > 0) ? currentIndex - 1 : (direction === 'down' && currentIndex < allServers.length - 1) ? currentIndex + 1 : -1;
        if (targetIndex !== -1) {
          if (allServers.some(s => s.sort_order === null)) {
            await env.DB.batch(allServers.map((s, i) => env.DB.prepare('UPDATE servers SET sort_order = ? WHERE id = ?').bind(i, s.id)));
            const updatedServers = (await env.DB.prepare('SELECT id, sort_order FROM servers ORDER BY sort_order ASC').all()).results;
            const newCurrentIndex = updatedServers.findIndex(s => s.id === serverId);
            targetIndex = (direction === 'up' && newCurrentIndex > 0) ? newCurrentIndex - 1 : (direction === 'down' && newCurrentIndex < updatedServers.length - 1) ? newCurrentIndex + 1 : -1;
            if (targetIndex !== -1) { await env.DB.batch([env.DB.prepare('UPDATE servers SET sort_order = ? WHERE id = ?').bind(updatedServers[targetIndex].sort_order, serverId), env.DB.prepare('UPDATE servers SET sort_order = ? WHERE id = ?').bind(updatedServers[newCurrentIndex].sort_order, updatedServers[targetIndex].id)]);}
          } else { await env.DB.batch([env.DB.prepare('UPDATE servers SET sort_order = ? WHERE id = ?').bind(allServers[targetIndex].sort_order, serverId), env.DB.prepare('UPDATE servers SET sort_order = ? WHERE id = ?').bind(allServers[currentIndex].sort_order, allServers[targetIndex].id)]);}
        } return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch (error) { console.error("Admin reorder server error:", error); return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
    if (path === '/api/auth/change-password' && method === 'POST') {
      try {
        const { current_password, new_password } = await request.json(); if (!current_password || !new_password) return new Response(JSON.stringify({ error: 'Passwords required' }), { status: 400, headers: corsHeaders });
        const result = await env.DB.prepare('SELECT password FROM admin_credentials WHERE username = \'admin\'').first();
        if (!result) return new Response(JSON.stringify({ error: 'Admin not found', message: '管理员用户不存在' }), { status: 404, headers: corsHeaders });
        if (result.password !== current_password) return new Response(JSON.stringify({ error: 'Incorrect current password', message: '当前密码不正确' }), { status: 400, headers: corsHeaders });
        await env.DB.prepare('UPDATE admin_credentials SET password = ? WHERE username = \'admin\'').bind(new_password).run(); return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch (error) { console.error("Change password error:", error); return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
    if (path === '/api/admin/sites' && method === 'GET') {
      try { const { results } = await env.DB.prepare('SELECT id, name, url, added_at, last_checked, last_status, last_status_code, last_response_time_ms, sort_order, last_notified_down_at FROM monitored_sites ORDER BY sort_order ASC NULLS LAST, name ASC, url ASC').all(); return new Response(JSON.stringify({ sites: results || [] }), { headers: corsHeaders }); }
      catch (error) { console.error("Admin get sites error:", error); if (error.message.includes('no such table')) { try { await env.DB.exec(D1_SCHEMAS.monitored_sites); return new Response(JSON.stringify({ sites: [] }), { headers: corsHeaders });} catch (ce) { console.error("Failed to create monitored_sites table:", ce); }} return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
    if (path === '/api/admin/sites' && method === 'POST') {
      try {
        const { url, name } = await request.json(); if (!url || !isValidHttpUrl(url)) return new Response(JSON.stringify({ error: 'Valid URL required', message: '请输入有效URL' }), { status: 400, headers: corsHeaders });
        const siteId = Math.random().toString(36).substring(2, 12); const addedAt = Math.floor(Date.now() / 1000);
        const maxOrderResult = await env.DB.prepare('SELECT MAX(sort_order) as max_order FROM monitored_sites').first(); const nextSortOrder = (maxOrderResult && typeof maxOrderResult.max_order === 'number') ? maxOrderResult.max_order + 1 : 0;
        await env.DB.prepare('INSERT INTO monitored_sites (id, url, name, added_at, last_status, sort_order) VALUES (?, ?, ?, ?, ?, ?)').bind(siteId, url, name || '', addedAt, 'PENDING', nextSortOrder).run();
        if (ctx && typeof ctx.waitUntil === 'function') { ctx.waitUntil(checkWebsiteStatus({ id: siteId, url: url, name: name || '' }, env.DB, ctx)); } else { checkWebsiteStatus({ id: siteId, url: url, name: name || '' }, env.DB, ctx).catch(e => console.error("Immediate site check error:", e));}
        return new Response(JSON.stringify({ site: { id: siteId, url, name: name || '', added_at: addedAt, last_status: 'PENDING', sort_order: nextSortOrder } }), { status: 201, headers: corsHeaders });
      } catch (error) { console.error("Admin add site error:", error); if (error.message.includes('UNIQUE constraint')) return new Response(JSON.stringify({ error: 'URL exists or ID conflict', message: '该URL已被监控或ID冲突' }), { status: 409, headers: corsHeaders }); if (error.message.includes('no such table')) { try { await env.DB.exec(D1_SCHEMAS.monitored_sites); return new Response(JSON.stringify({ error: 'DB table created, retry', message: '数据库表已创建，请重试' }), { status: 503, headers: corsHeaders }); } catch (ce) { console.error("Failed to create monitored_sites table:", ce); }} return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
    if (path.match(/\/api\/admin\/sites\/[^\/]+$/) && method === 'PUT') {
      try {
        const siteId = path.split('/').pop(); const { url, name } = await request.json(); let setClauses = [], bindings = [];
        if (url !== undefined) { if (!isValidHttpUrl(url)) return new Response(JSON.stringify({ error: 'Valid URL required' }), { status: 400, headers: corsHeaders }); setClauses.push("url = ?"); bindings.push(url); }
        if (name !== undefined) { setClauses.push("name = ?"); bindings.push(name || ''); }
        if (setClauses.length === 0) return new Response(JSON.stringify({ error: 'No fields to update' }), { status: 400, headers: corsHeaders });
        bindings.push(siteId); const { changes } = await env.DB.prepare(`UPDATE monitored_sites SET ${setClauses.join(', ')} WHERE id = ?`).bind(...bindings).run();
        if (changes === 0) return new Response(JSON.stringify({ error: 'Site not found or no changes' }), { status: 404, headers: corsHeaders });
        const updatedSite = await env.DB.prepare('SELECT * FROM monitored_sites WHERE id = ?').bind(siteId).first(); return new Response(JSON.stringify({ site: updatedSite }), { headers: corsHeaders });
      } catch (error) { console.error("Admin update site error:", error); if (error.message.includes('UNIQUE constraint')) return new Response(JSON.stringify({ error: 'URL exists for another site', message: '该URL已被其他监控站点使用' }), { status: 409, headers: corsHeaders }); return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
    if (path.match(/\/api\/admin\/sites\/[^\/]+$/) && method === 'DELETE') {
      try { const siteId = path.split('/').pop(); const { changes } = await env.DB.prepare('DELETE FROM monitored_sites WHERE id = ?').bind(siteId).run(); if (changes === 0) return new Response(JSON.stringify({ error: 'Site not found' }), { status: 404, headers: corsHeaders }); return new Response(JSON.stringify({ success: true }), { headers: corsHeaders }); }
      catch (error) { console.error("Admin delete site error:", error); return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
    if (path.match(/\/api\/admin\/sites\/[^\/]+\/reorder$/) && method === 'POST') {
      try {
        const siteId = path.split('/')[4]; const { direction } = await request.json(); if (!direction || !['up', 'down'].includes(direction)) return new Response(JSON.stringify({ error: 'Invalid direction' }), { status: 400, headers: corsHeaders });
        const allSites = (await env.DB.prepare('SELECT id, sort_order FROM monitored_sites ORDER BY sort_order ASC NULLS LAST, name ASC, url ASC').all()).results;
        const currentIndex = allSites.findIndex(s => s.id === siteId); if (currentIndex === -1) return new Response(JSON.stringify({ error: 'Site not found' }), { status: 404, headers: corsHeaders });
        let targetIndex = (direction === 'up' && currentIndex > 0) ? currentIndex - 1 : (direction === 'down' && currentIndex < allSites.length - 1) ? currentIndex + 1 : -1;
        if (targetIndex !== -1) {
          if (allSites.some(s => s.sort_order === null)) {
            await env.DB.batch(allSites.map((s, i) => env.DB.prepare('UPDATE monitored_sites SET sort_order = ? WHERE id = ?').bind(i, s.id)));
            const updatedSites = (await env.DB.prepare('SELECT id, sort_order FROM monitored_sites ORDER BY sort_order ASC').all()).results;
            const newCurrentIndex = updatedSites.findIndex(s => s.id === siteId);
            targetIndex = (direction === 'up' && newCurrentIndex > 0) ? newCurrentIndex - 1 : (direction === 'down' && newCurrentIndex < updatedSites.length - 1) ? newCurrentIndex + 1 : -1;
            if (targetIndex !== -1) { await env.DB.batch([env.DB.prepare('UPDATE monitored_sites SET sort_order = ? WHERE id = ?').bind(updatedSites[targetIndex].sort_order, siteId), env.DB.prepare('UPDATE monitored_sites SET sort_order = ? WHERE id = ?').bind(updatedSites[newCurrentIndex].sort_order, updatedSites[targetIndex].id)]);}
          } else { await env.DB.batch([env.DB.prepare('UPDATE monitored_sites SET sort_order = ? WHERE id = ?').bind(allSites[targetIndex].sort_order, siteId), env.DB.prepare('UPDATE monitored_sites SET sort_order = ? WHERE id = ?').bind(allSites[currentIndex].sort_order, allSites[targetIndex].id)]);}
        } return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch (error) { console.error("Admin reorder site error:", error); return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
    if (path === '/api/sites/status' && method === 'GET') {
      try { const { results } = await env.DB.prepare('SELECT id, name, last_checked, last_status, last_status_code, last_response_time_ms FROM monitored_sites ORDER BY sort_order ASC NULLS LAST, name ASC, id ASC').all(); return new Response(JSON.stringify({ sites: results || [] }), { headers: corsHeaders }); }
      catch (error) { console.error("Get sites status error:", error); if (error.message.includes('no such table')) { try { await env.DB.exec(D1_SCHEMAS.monitored_sites); return new Response(JSON.stringify({ sites: [] }), { headers: corsHeaders });} catch (ce) { console.error("Failed to create monitored_sites table:", ce); }} return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
    if (path === '/api/admin/telegram-settings' && method === 'GET') {
      try { const settings = await env.DB.prepare('SELECT bot_token, chat_id, enable_notifications FROM telegram_config WHERE id = 1').first(); return new Response(JSON.stringify(settings || { bot_token: null, chat_id: null, enable_notifications: 0 }), { headers: corsHeaders }); }
      catch (error) { console.error("Get TG settings error:", error); if (error.message.includes('no such table')) { try { await env.DB.exec(D1_SCHEMAS.telegram_config); return new Response(JSON.stringify({ bot_token: null, chat_id: null, enable_notifications: 0 }), { headers: corsHeaders });} catch (ce) { console.error("Failed to create telegram_config table:", ce); }} return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
    if (path === '/api/admin/telegram-settings' && method === 'POST') {
      try {
        const { bot_token, chat_id, enable_notifications } = await request.json(); const updatedAt = Math.floor(Date.now() / 1000);
        const enableVal = (enable_notifications === true || enable_notifications === 1) ? 1 : 0;
        await env.DB.prepare('UPDATE telegram_config SET bot_token = ?, chat_id = ?, enable_notifications = ?, updated_at = ? WHERE id = 1').bind(bot_token || null, chat_id || null, enableVal, updatedAt).run();
        if (enableVal && bot_token && chat_id) { if (ctx?.waitUntil) { ctx.waitUntil(sendTelegramNotification(env.DB, "✅ Telegram 通知已激活。")); } else { sendTelegramNotification(env.DB, "✅ Telegram 通知已激活.").catch(console.error);}}
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch (error) { console.error("Update TG settings error:", error); return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
    if (path.match(/\/api\/sites\/[^\/]+\/history$/) && method === 'GET') {
      try { const siteId = path.split('/')[3]; const now = Math.floor(Date.now() / 1000); const ago = now - (24 * 60 * 60);
        const { results } = await env.DB.prepare('SELECT timestamp, status, status_code, response_time_ms FROM site_status_history WHERE site_id = ? AND timestamp >= ? ORDER BY timestamp DESC').bind(siteId, ago).all();
        return new Response(JSON.stringify({ history: results || [] }), { headers: corsHeaders });
      } catch (error) { console.error("Get site history error:", error); if (error.message.includes('no such table')) { try { await env.DB.exec(D1_SCHEMAS.site_status_history); return new Response(JSON.stringify({ history: [] }), { headers: corsHeaders });} catch (ce) { console.error("Failed to create site_status_history table:", ce); }} return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), { status: 500, headers: corsHeaders });}
    }
    return new Response(JSON.stringify({ error: 'API endpoint not found' }), { status: 404, headers: corsHeaders });
  }
  
  async function sendTelegramNotification(db, message) {
    try {
      const config = await db.prepare('SELECT bot_token, chat_id, enable_notifications FROM telegram_config WHERE id = 1').first();
      if (!config || !config.enable_notifications || !config.bot_token || !config.chat_id) return;
      const response = await fetch(`https://api.telegram.org/bot${config.bot_token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: config.chat_id, text: message, parse_mode: 'Markdown' }) });
      if (!response.ok) { const errData = await response.json(); console.error(`TG Notify Fail: ${response.status}`, errData); } 
    } catch (error) { console.error("TG Notify Error:", error); }
  }
  
  async function checkWebsiteStatus(site, db, ctx) {
    const { id, url, name } = site; const startTime = Date.now(); let newStatus = 'PENDING', newStatusCode = null, newResponseTime = null;
    let siteDetails = await db.prepare('SELECT last_status, last_notified_down_at FROM monitored_sites WHERE id = ?').bind(id).first();
    const previousStatus = siteDetails?.last_status || 'PENDING'; let siteLastNotifiedDownAt = siteDetails?.last_notified_down_at;
    const NOTIFICATION_INTERVAL = 3600; 
  
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15000) }); 
      newResponseTime = Date.now() - startTime; newStatusCode = response.status;
      newStatus = (response.ok || (response.status >= 300 && response.status < 500)) ? 'UP' : 'DOWN';
    } catch (error) { newResponseTime = Date.now() - startTime; newStatus = (error.name === 'TimeoutError') ? 'TIMEOUT' : 'ERROR'; }
  
    const checkTime = Math.floor(Date.now() / 1000); const displayName = name || url; let newSiteLastNotifiedDownAt = siteLastNotifiedDownAt;
    if (['DOWN', 'TIMEOUT', 'ERROR'].includes(newStatus)) {
      const firstTimeDown = !['DOWN', 'TIMEOUT', 'ERROR'].includes(previousStatus);
      if (firstTimeDown) { ctx.waitUntil(sendTelegramNotification(db, `🔴 网站故障: *${displayName}* ${newStatus.toLowerCase()} (码: ${newStatusCode || '无'}).\n${url}`)); newSiteLastNotifiedDownAt = checkTime; }
      else { const shouldResend = !siteLastNotifiedDownAt || (checkTime - siteLastNotifiedDownAt > NOTIFICATION_INTERVAL); if (shouldResend) { ctx.waitUntil(sendTelegramNotification(db, `🔴 网站持续故障: *${displayName}* ${newStatus.toLowerCase()} (码: ${newStatusCode || '无'}).\n${url}`)); newSiteLastNotifiedDownAt = checkTime; }}
    } else if (newStatus === 'UP' && ['DOWN', 'TIMEOUT', 'ERROR'].includes(previousStatus)) { ctx.waitUntil(sendTelegramNotification(db, `✅ 网站恢复: *${displayName}* 已恢复在线!\n${url}`)); newSiteLastNotifiedDownAt = null; }
    try {
      await db.batch([
        db.prepare('UPDATE monitored_sites SET last_checked = ?, last_status = ?, last_status_code = ?, last_response_time_ms = ?, last_notified_down_at = ? WHERE id = ?').bind(checkTime, newStatus, newStatusCode, newResponseTime, newSiteLastNotifiedDownAt, id),
        db.prepare('INSERT INTO site_status_history (site_id, timestamp, status, status_code, response_time_ms) VALUES (?, ?, ?, ?, ?)') .bind(id, checkTime, newStatus, newStatusCode, newResponseTime)
      ]);
    } catch (dbError) { console.error(`DB Update site ${id} fail:`, dbError); }
  }
  
  export default {
    async fetch(request, env, ctx) {
      ctx.waitUntil(ensureTablesExist(env.DB)); const url = new URL(request.url); const path = url.pathname;
      if (path.startsWith('/api/')) return handleApiRequest(request, env, ctx);
      if (path === '/install.sh') return handleInstallScript(request, url);
      return handleFrontendRequest(request, path);
    },
    async scheduled(event, env, ctx) {
      console.log(`Cron: ${event.cron} - Running scheduled tasks...`);
      ctx.waitUntil( (async () => {
        try {
          await ensureTablesExist(env.DB);
          const sites = (await env.DB.prepare('SELECT id, url, name FROM monitored_sites').all()).results;
          if (sites?.length) { const S_LIMIT = 10; let promises = []; for (const site of sites) { promises.push(checkWebsiteStatus(site, env.DB, ctx)); if (promises.length >= S_LIMIT) { await Promise.all(promises); promises = []; }} if (promises.length) await Promise.all(promises); }
          const tgConfig = await env.DB.prepare('SELECT bot_token, chat_id, enable_notifications FROM telegram_config WHERE id = 1').first();
          if (tgConfig?.enable_notifications && tgConfig.bot_token && tgConfig.chat_id) {
            const servers = (await env.DB.prepare(`SELECT s.id, s.name, s.last_notified_down_at, m.timestamp as last_report FROM servers s LEFT JOIN metrics m ON s.id = m.server_id`).all()).results;
            if (servers?.length) { const now = Math.floor(Date.now()/1000); const STALE_S = 300; const NOTIFY_S = 3600;
              for (const s of servers) {
                const stale = !s.last_report || (now - s.last_report > STALE_S); const sName = s.name || s.id; const lastTime = s.last_report ? new Date(s.last_report*1000).toLocaleString('zh-CN') : '从未';
                if (stale) { if (!s.last_notified_down_at || (now - s.last_notified_down_at > NOTIFY_S)) { ctx.waitUntil(sendTelegramNotification(env.DB, `🔴 VPS 故障: *${sName}* 离线。最后报告: ${lastTime}.`)); ctx.waitUntil(env.DB.prepare('UPDATE servers SET last_notified_down_at = ? WHERE id = ?').bind(now, s.id).run());}}
                else if (s.last_notified_down_at) { ctx.waitUntil(sendTelegramNotification(env.DB, `✅ VPS 恢复: *${sName}* 在线。当前报告: ${lastTime}.`)); ctx.waitUntil(env.DB.prepare('UPDATE servers SET last_notified_down_at = NULL WHERE id = ?').bind(s.id).run());}
              }
            }
          }
          const daysAgo = Math.floor(Date.now()/1000) - (7*24*60*60); 
          const pr1 = await env.DB.prepare('DELETE FROM site_status_history WHERE timestamp < ?').bind(daysAgo).run();
          const pr2 = await env.DB.prepare('DELETE FROM server_metrics_history WHERE timestamp < ?').bind(daysAgo).run();
          console.log(`Pruned site_history: ${pr1.meta.rows_written}, server_metrics_history: ${pr2.meta.rows_written}`);
        } catch (error) { console.error("Scheduled task error:", error); }
      })());
    }
  };
  
  function isValidHttpUrl(string) { try { const url = new URL(string); return url.protocol === "http:" || url.protocol === "https:"; } catch (_) { return false; }}
  function handleInstallScript(request, url) {
    const baseUrl = url.origin;
    const script = `#!/bin/bash
  # VPS监控脚本 - 安装程序
  API_KEY="" SERVER_ID="" WORKER_URL="${baseUrl}" INSTALL_DIR="/opt/vps-monitor" SERVICE_NAME="vps-monitor"
  while [[ $# -gt 0 ]]; do case $1 in -k|--key) API_KEY="$2"; shift 2;; -s|--server) SERVER_ID="$2"; shift 2;; -u|--url) WORKER_URL="$2"; shift 2;; -d|--dir) INSTALL_DIR="$2"; shift 2;; *) echo "未知参数: $1"; exit 1;; esac; done
  if [ -z "$API_KEY" ] || [ -z "$SERVER_ID" ]; then echo "错误: API密钥和服务器ID是必需的"; echo "用法: $0 -k API_KEY -s SERVER_ID [-u WORKER_URL] [-d INSTALL_DIR]"; exit 1; fi
  if [ "$(id -u)" -ne 0 ]; then echo "错误: 此脚本需要root权限"; exit 1; fi
  echo "=== VPS监控脚本安装程序 ==="; echo "安装目录: $INSTALL_DIR"; echo "Worker URL: $WORKER_URL"; mkdir -p "$INSTALL_DIR"; cd "$INSTALL_DIR" || exit 1
  cat > "$INSTALL_DIR/monitor.sh" << 'EOF'
  #!/bin/bash
  API_KEY="__API_KEY__" SERVER_ID="__SERVER_ID__" WORKER_URL="__WORKER_URL__" INTERVAL=60
  log() { echo "$(date '+%Y-%m-%d %H:%M:%S') - $1"; }
  get_cpu_usage() { cpu_usage=$(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk '{print 100 - $1}'); cpu_load=$(cat /proc/loadavg | awk '{print $1","$2","$3}'); echo "{\"usage_percent\":$cpu_usage,\"load_avg\":[$cpu_load]}"; }
  get_memory_usage() { total=$(free -k | grep Mem | awk '{print $2}'); used=$(free -k | grep Mem | awk '{print $3}'); free=$(free -k | grep Mem | awk '{print $4}'); usage_percent=$(echo "scale=1; $used * 100 / $total" | bc); echo "{\"total\":$total,\"used\":$used,\"free\":$free,\"usage_percent\":$usage_percent}"; }
  get_disk_usage() { disk_info=$(df -k / | tail -1); total=$(echo "$disk_info" | awk '{print $2 / 1024 / 1024}'); used=$(echo "$disk_info" | awk '{print $3 / 1024 / 1024}'); free=$(echo "$disk_info" | awk '{print $4 / 1024 / 1024}'); usage_percent=$(echo "$disk_info" | awk '{print $5}' | tr -d '%'); echo "{\"total\":$total,\"used\":$used,\"free\":$free,\"usage_percent\":$usage_percent}"; }
  get_network_usage() { if ! command -v ifstat &> /dev/null; then log "ifstat未安装"; echo "{\"upload_speed\":0,\"download_speed\":0,\"total_upload\":0,\"total_download\":0}"; return; fi; interface=$(ip route | grep default | awk '{print $5}'); network_speed=$(ifstat -i "$interface" 1 1 | tail -1); download_speed=$(echo "$network_speed" | awk '{print $1 * 1024}'); upload_speed=$(echo "$network_speed" | awk '{print $2 * 1024}'); rx_bytes=$(cat /proc/net/dev | grep "$interface" | awk '{print $2}'); tx_bytes=$(cat /proc/net/dev | grep "$interface" | awk '{print $10}'); echo "{\"upload_speed\":$upload_speed,\"download_speed\":$download_speed,\"total_upload\":$tx_bytes,\"total_download\":$rx_bytes}"; }
  report_metrics() { timestamp=$(date +%s); cpu=$(get_cpu_usage); memory=$(get_memory_usage); disk=$(get_disk_usage); network=$(get_network_usage); data="{\"timestamp\":$timestamp,\"cpu\":$cpu,\"memory\":$memory,\"disk\":$disk,\"network\":$network}"; log "正在上报数据..."; response=$(curl -s -X POST "$WORKER_URL/api/report/$SERVER_ID" -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" -d "$data"); if [[ "$response" == *"success"* ]]; then log "数据上报成功"; else log "数据上报失败: $response"; fi; }
  install_dependencies() { log "检查并安装依赖..."; if command -v apt-get &> /dev/null; then PKG_MANAGER="apt-get"; elif command -v yum &> /dev/null; then PKG_MANAGER="yum"; else log "不支持的系统"; return 1; fi; $PKG_MANAGER update -y >/dev/null 2>&1; $PKG_MANAGER install -y bc curl ifstat >/dev/null 2>&1; log "依赖安装完成"; return 0; }
  main() { log "VPS监控脚本启动"; install_dependencies; while true; do report_metrics; sleep $INTERVAL; done; }
  main
  EOF
  sed -i "s|__API_KEY__|$API_KEY|g" "$INSTALL_DIR/monitor.sh"; sed -i "s|__SERVER_ID__|$SERVER_ID|g" "$INSTALL_DIR/monitor.sh"; sed -i "s|__WORKER_URL__|$WORKER_URL|g" "$INSTALL_DIR/monitor.sh"; chmod +x "$INSTALL_DIR/monitor.sh"
  cat > "/etc/systemd/system/$SERVICE_NAME.service" << EOF
  [Unit]
  Description=VPS Monitor Service
  After=network.target
  [Service]
  ExecStart=$INSTALL_DIR/monitor.sh
  Restart=always
  User=root
  Group=root
  Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  [Install]
  WantedBy=multi-user.target
  EOF
  systemctl daemon-reload; systemctl enable "$SERVICE_NAME"; systemctl start "$SERVICE_NAME"
  echo "=== 安装完成 ==="; echo "服务已启动并设置为开机自启"; echo "查看服务状态: systemctl status $SERVICE_NAME"; echo "查看服务日志: journalctl -u $SERVICE_NAME -f"
  `;
    return new Response(script, { headers: { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="install.sh"' }});
  }
  
  function handleFrontendRequest(request, path) {
    if (path === '/js/common.js') return new Response(getCommonJs(), { headers: { 'Content-Type': 'application/javascript' }});
    if (path === '/' || path === '') return new Response(getIndexHtml(), { headers: { 'Content-Type': 'text/html' }});
    if (path === '/login' || path === '/login.html') return new Response(getLoginHtml(), { headers: { 'Content-Type': 'text/html' }});
    if (path === '/admin' || path === '/admin.html') return new Response(getAdminHtml(), { headers: { 'Content-Type': 'text/html' }});
    if (path === '/css/style.css') return new Response(getStyleCss(), { headers: { 'Content-Type': 'text/css' }});
    if (path === '/js/main.js') return new Response(getMainJs(), { headers: { 'Content-Type': 'application/javascript' }});
    if (path === '/js/login.js') return new Response(getLoginJs(), { headers: { 'Content-Type': 'application/javascript' }});
    if (path === '/js/admin.js') return new Response(getAdminJs(), { headers: { 'Content-Type': 'application/javascript' }});
    return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' }});
  }
  
  // --- Frontend HTML, CSS, and JavaScript (Focus on In-Card Expansion UI - Corrected) ---
  
  function getCommonJs() {
    return `
  const THEME_KEY = 'vpsMonitorTheme'; 
  const LANGUAGE_KEY = 'vpsMonitorLanguage';
  const LIGHT_THEME = 'light'; 
  const DARK_THEME = 'dark'; 
  const DEFAULT_LANGUAGE = 'zh';
  
  const translations = {
    en: {
      vpsMonitorPanel: "VPS Monitor Panel", adminLogin: "Admin Login", adminPanel: "Admin Panel", githubRepo: "GitHub Repository", toggleTheme: "Toggle Theme", toggleLanguage: "Toggle Language", returnToHome: "Return to Home", copyright: "VPS Monitor Panel",
      noServerData: "No server data available. Please log in to the admin panel to add servers.", loading: "Loading...", serverName: "Name", status: "Status", cpu: "CPU", memory: "Memory", disk: "Disk", upload: "Upload", download: "Download", totalUpload: "Total Up", totalDownload: "Total Down", lastUpdate: "Last Update", online: "Online", offline: "Offline", unknown: "Unknown", error: "Error", noDetailedData: "No detailed data", cpuLoad: "CPU Load (1m, 5m, 15m):", total: "Total:", used: "Used:", free: "Free:", diskUsage: "Disk (/):", totalTraffic: "Total Traffic:",
      siteStatusTitle: "Website Status", noSiteData: "No websites are being monitored.", siteNameCol: "Name", siteStatusCol: "Status", siteStatusCodeCol: "Status Code", siteResponseTimeCol: "Response (ms)", siteLastCheckCol: "Last Check", site24hHistoryCol: "24h History", never: "Never", siteStatusUp: "Up", siteStatusDown: "Down", siteStatusTimeout: "Timeout", siteStatusError: "Error", siteStatusPending: "Pending", errorFetchingHistory: "Error fetching", noRecords24h: "No records for last 24h", errorRenderingHistory: "Error rendering",
      loginTitle: "Login - VPS Monitor Panel", adminLoginTitle: "Admin Login", usernameLabel: "Username", passwordLabel: "Password", loginButton: "Login", loginInProgress: "Logging in...", initialCredentials: "Initial: admin / admin", enterUsernamePassword: "Please enter username and password", loginFailedError: "Login failed, please try again later",
      adminPageTitle: "Admin - VPS Monitor Panel", serverManagement: "Server Management", addServer: "Add Server", siteManagement: "Website Monitoring Management", addSite: "Add Monitored Site", telegramSettings: "Telegram Notification Settings", changePassword: "Change Password", logout: "Logout",
      serverColSort: "Order", serverColId: "ID", serverColName: "Name", serverColDesc: "Description", serverColApiKey: "API Key", serverColStatus: "Status", serverColLastUpdate: "Last Update", serverColActions: "Actions", viewApiKey: "View Key", noServerDataAdmin: "No server data yet.",
      siteColSort: "Order", siteColName: "Name", siteColUrl: "URL", noSiteDataAdmin: "No monitored sites yet.",
      close: "Close", save: "Save", delete: "Delete", cancel: "Cancel",
      addServerTitle: "Add Server", editServerTitle: "Edit Server", serverNameLabel: "Server Name", serverDescLabel: "Description (Optional)", serverIDLabel: "Server ID", workerUrlLabel: "Worker URL", apiKeyLabel: "API Key", serverInfoAndKeyTitle: "Server Details & Key",
      addSiteTitle: "Add Monitored Site", editSiteTitle: "Edit Monitored Site", siteNameLabel: "Site Name (Optional)", siteUrlLabel: "Site URL",
      confirmDelete: "Confirm Deletion", confirmDeleteServerMsg: "Are you sure you want to delete server", irreversibleAction: "This action is irreversible. All related monitoring data will also be deleted.", confirmDeleteSiteMsg: "Are you sure you want to stop monitoring site", confirmDeleteSiteMsgEnd: "?",
      changePasswordTitle: "Change Password", currentPasswordLabel: "Current Password", newPasswordLabel: "New Password", confirmNewPasswordLabel: "Confirm New Password", allPasswordFieldsRequired: "All password fields are required.", passwordsMismatch: "New password and confirmation do not match.",
      telegramBotTokenLabel: "Bot Token", telegramChatIdLabel: "Chat ID", enableTelegramNotificationsLabel: "Enable Notifications", saveTelegramSettings: "Save Telegram Settings",
      loadingServersError: "Failed to load server list. Please refresh.", loadingSitesError: "Failed to load site list. Please refresh.", serverNameRequired: "Server name cannot be empty.", saveServerError: "Failed to save server. Please try again.", serverAddedSuccess: "Server added successfully.", serverUpdatedSuccess: "Server updated successfully.", viewApiKeyError: "Failed to retrieve API key.", noServerInfoFound: "Server information not found.", serverDeleteSuccess: "Server deleted successfully.", deleteServerError: "Failed to delete server. Please try again.", passwordChangeSuccess: "Password changed successfully.", passwordChangeError: "Password change failed.", urlRequired: "Please enter the website URL.", urlFormatError: "URL must start with http:// or https://", siteAddedSuccess: "Monitored site added successfully.", siteUpdatedSuccess: "Monitored site updated successfully.", saveSiteError: "Failed to save site.", editSiteNotFound: "Could not find site information to edit.", siteDeleteSuccess: "Site monitoring stopped successfully.", deleteSiteError: "Failed to delete site monitoring.", telegramSettingsLoadedError: "Failed to load Telegram settings.", telegramSettingsSavedSuccess: "Telegram settings saved successfully.", telegramSettingsSaveError: "Failed to save Telegram settings.", telegramTokenChatIdRequiredEnable: "Bot Token and Chat ID cannot be empty to enable notifications. Notifications have been automatically disabled.", telegramTokenChatIdRequired: "When enabling notifications, Bot Token and Chat ID cannot be empty.", serverMovedUp: "Server moved up successfully.", serverMovedDown: "Server moved down successfully.", moveServerError: "Failed to move server", siteMovedUp: "Site moved up successfully.", siteMovedDown: "Site moved down successfully.", moveSiteError: "Failed to move site",
      cpuUsageLast24h: "CPU Usage (Last 24h)", memoryUsageLast24h: "Memory Usage (Last 24h)", siteResponseTimeLast24h: "Response Time (ms, Last 24h)",
      available: "Available", details: "Details",
    },
    zh: {
      vpsMonitorPanel: "VPS监控面板", adminLogin: "管理员登录", adminPanel: "管理后台", githubRepo: "GitHub仓库", toggleTheme: "切换主题", toggleLanguage: "切换语言", returnToHome: "返回首页", copyright: "VPS监控面板",
      noServerData: "暂无服务器数据，请先登录管理后台添加服务器。", loading: "加载中...", serverName: "名称", status: "状态", cpu: "CPU", memory: "内存", disk: "硬盘", upload: "上传", download: "下载", totalUpload: "总上传", totalDownload: "总下载", lastUpdate: "最后更新", online: "在线", offline: "离线", unknown: "未知", error: "错误", noDetailedData: "无详细数据", cpuLoad: "CPU负载 (1m, 5m, 15m):", total: "总计:", used: "已用:", free: "空闲:", diskUsage: "硬盘 (/):", totalTraffic: "总流量:",
      siteStatusTitle: "网站在线状态", noSiteData: "暂无监控网站数据。", siteNameCol: "名称", siteStatusCol: "状态", siteStatusCodeCol: "状态码", siteResponseTimeCol: "响应 (ms)", siteLastCheckCol: "最后检查", site24hHistoryCol: "24h记录", never: "从未", siteStatusUp: "正常", siteStatusDown: "故障", siteStatusTimeout: "超时", siteStatusError: "错误", siteStatusPending: "待检测", errorFetchingHistory: "获取记录出错", noRecords24h: "近24小时无记录", errorRenderingHistory: "渲染记录出错",
      loginTitle: "登录 - VPS监控面板", adminLoginTitle: "管理员登录", usernameLabel: "用户名", passwordLabel: "密码", loginButton: "登录", loginInProgress: "登录中...", initialCredentials: "初始账号密码: admin / admin", enterUsernamePassword: "请输入用户名和密码", loginFailedError: "登录请求失败，请稍后重试",
      adminPageTitle: "管理后台 - VPS监控面板", serverManagement: "服务器管理", addServer: "添加服务器", siteManagement: "网站监控管理", addSite: "添加监控网站", telegramSettings: "Telegram 通知设置", changePassword: "修改密码", logout: "退出登录",
      serverColSort: "排序", serverColId: "ID", serverColName: "名称", serverColDesc: "描述", serverColApiKey: "API密钥", serverColStatus: "状态", serverColLastUpdate: "最后更新", serverColActions: "操作", viewApiKey: "查看密钥", noServerDataAdmin: "暂无服务器数据",
      siteColSort: "排序", siteColName: "名称", siteColUrl: "URL", noSiteDataAdmin: "暂无监控网站",
      close: "关闭", save: "保存", delete: "删除", cancel: "取消",
      addServerTitle: "添加服务器", editServerTitle: "编辑服务器", serverNameLabel: "服务器名称", serverDescLabel: "描述（可选）", serverIDLabel: "服务器ID", workerUrlLabel: "Worker 地址", apiKeyLabel: "API密钥", serverInfoAndKeyTitle: "服务器详细信息与密钥",
      addSiteTitle: "添加监控网站", editSiteTitle: "编辑监控网站", siteNameLabel: "网站名称（可选）", siteUrlLabel: "网站URL",
      confirmDelete: "确认删除", confirmDeleteServerMsg: "确定要删除服务器", irreversibleAction: "此操作不可逆，所有相关的监控数据也将被删除。", confirmDeleteSiteMsg: "确定要停止监控网站", confirmDeleteSiteMsgEnd: "吗？",
      changePasswordTitle: "修改密码", currentPasswordLabel: "当前密码", newPasswordLabel: "新密码", confirmNewPasswordLabel: "确认新密码", allPasswordFieldsRequired: "所有密码字段都必须填写", passwordsMismatch: "新密码和确认密码不匹配",
      telegramBotTokenLabel: "Bot Token", telegramChatIdLabel: "Chat ID", enableTelegramNotificationsLabel: "启用通知", saveTelegramSettings: "保存Telegram设置",
      loadingServersError: "加载服务器列表失败，请刷新页面重试。", loadingSitesError: "加载监控网站列表失败，请刷新页面重试。", serverNameRequired: "服务器名称不能为空", saveServerError: "保存服务器失败，请稍后重试", serverAddedSuccess: "服务器添加成功", serverUpdatedSuccess: "服务器更新成功", viewApiKeyError: "获取API密钥失败", noServerInfoFound: "未找到服务器信息", serverDeleteSuccess: "服务器删除成功", deleteServerError: "删除服务器失败，请稍后重试", passwordChangeSuccess: "密码修改成功", passwordChangeError: "密码修改失败", urlRequired: "请输入网站URL", urlFormatError: "URL必须以 http:// 或 https:// 开头", siteAddedSuccess: "监控网站添加成功", siteUpdatedSuccess: "监控网站更新成功", saveSiteError: "保存网站失败", editSiteNotFound: "未找到要编辑的网站信息。", siteDeleteSuccess: "网站监控已删除", deleteSiteError: "删除网站监控失败。", telegramSettingsLoadedError: "加载Telegram设置失败。", telegramSettingsSavedSuccess: "Telegram设置已成功保存。", telegramSettingsSaveError: "保存Telegram设置失败。", telegramTokenChatIdRequiredEnable: "Bot Token 和 Chat ID 均不能为空才能启用通知。通知已自动禁用。", telegramTokenChatIdRequired: "启用通知时，Bot Token 和 Chat ID 不能为空。", serverMovedUp: "服务器已成功上移", serverMovedDown: "服务器已成功下移", moveServerError: "移动服务器失败", siteMovedUp: "网站已成功上移", siteMovedDown: "网站已成功下移", moveSiteError: "移动网站失败",
      cpuUsageLast24h: "CPU使用率 (近24小时)", memoryUsageLast24h: "内存使用率 (近24小时)", siteResponseTimeLast24h: "响应时间 (ms, 近24小时)",
      available: "可用", details: "详情",
    }
  };
  let currentLanguage = localStorage.getItem(LANGUAGE_KEY) || DEFAULT_LANGUAGE;
  function getTranslation(key, lang = currentLanguage) { return translations[lang]?.[key] || translations[DEFAULT_LANGUAGE]?.[key] || key; }
  function translatePage() {
    document.querySelectorAll('[data-i18n-key]').forEach(el => {
      const key = el.getAttribute('data-i18n-key'); const translation = getTranslation(key);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { if (el.placeholder) el.placeholder = translation; } 
      else if (el.title) { el.title = translation; }
      else { el.textContent = translation; }
    });
    const pageTitleKey = document.body.getAttribute('data-i18n-page-title'); if (pageTitleKey) { document.title = getTranslation(pageTitleKey); }
    const langToggler = document.getElementById('languageToggler'); if (langToggler) { langToggler.textContent = currentLanguage === 'zh' ? 'EN' : '中文'; }
  }
  function toggleLanguage() {
    currentLanguage = (currentLanguage === 'zh') ? 'en' : 'zh'; localStorage.setItem(LANGUAGE_KEY, currentLanguage); translatePage();
    if (typeof loadAllServerStatuses === 'function') loadAllServerStatuses(true); 
    if (typeof loadAllSiteStatuses === 'function') loadAllSiteStatuses(true); 
    if (typeof loadServerList === 'function') loadServerList(); if (typeof loadSiteList === 'function') loadSiteList();
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    const themeTogglerIcon = document.querySelector('#themeToggler i');
    if (themeTogglerIcon) { theme === DARK_THEME ? (themeTogglerIcon.classList.remove('bi-moon-stars-fill'), themeTogglerIcon.classList.add('bi-sun-fill')) : (themeTogglerIcon.classList.remove('bi-sun-fill'), themeTogglerIcon.classList.add('bi-moon-stars-fill')); }
  }
  function toggleTheme() { const currentTheme = document.documentElement.getAttribute('data-bs-theme') || LIGHT_THEME; const newTheme = currentTheme === DARK_THEME ? LIGHT_THEME : DARK_THEME; applyTheme(newTheme); localStorage.setItem(THEME_KEY, newTheme); 
      if (window.Chart && typeof loadAllServerStatuses === 'function') { loadAllServerStatuses(true); }
      if (window.Chart && typeof loadAllSiteStatuses === 'function') { loadAllSiteStatuses(true); }
  }
  function initializeThemeAndLanguage() {
      const storedTheme = localStorage.getItem(THEME_KEY) || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK_THEME : LIGHT_THEME); applyTheme(storedTheme);
      const themeToggler = document.getElementById('themeToggler'); if (themeToggler) themeToggler.addEventListener('click', toggleTheme);
      currentLanguage = localStorage.getItem(LANGUAGE_KEY) || DEFAULT_LANGUAGE; translatePage();
      const languageToggler = document.getElementById('languageToggler'); if (languageToggler) languageToggler.addEventListener('click', toggleLanguage);
  }
  function getAuthHeaders() { const token = localStorage.getItem('auth_token'); return { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${token}\` }; }
  function showAlert(type, messageKey, alertId = 'serverAlert', isKey = true) {
      const alertElement = document.getElementById(alertId); if (!alertElement) return;
      const messageText = isKey ? getTranslation(messageKey) : messageKey;
      alertElement.className = \`alert alert-\${type} alert-dismissible fade show\`;
      alertElement.innerHTML = \`\${messageText}<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>\`;
      alertElement.classList.remove('d-none');
      if (type !== 'danger') { setTimeout(() => { if (alertElement.classList.contains('show')) { const bsAlert = bootstrap.Alert.getInstance(alertElement); if (bsAlert) bsAlert.close(); else alertElement.classList.add('d-none'); } }, 5000); }
  }
  function getChartThemeOptions(isPie = false, chartType = null) {
      const isDarkMode = document.documentElement.getAttribute('data-bs-theme') === 'dark';
      const gridColor = isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
      const textColor = isDarkMode ? '#d0d0d0' : '#555'; 
      const titleColor = isDarkMode ? '#e8e8e8' : '#333';
      const tooltipBg = isDarkMode ? 'rgba(35, 35, 35, 0.95)' : 'rgba(252, 252, 252, 0.95)';
      const pointColor = isDarkMode ? 'rgba(13, 202, 240, 0.8)' : 'rgba(13, 110, 253, 0.8)';
  
      const options = {
          plugins: { 
              legend: { 
                  display: !isPie, 
                  labels: { color: textColor, boxWidth: 12, padding: 10, font: {size: 12} } 
              },
              tooltip: {
                  backgroundColor: tooltipBg,
                  titleColor: titleColor, titleFont: {weight: '600', size: 13},
                  bodyColor: textColor, bodyFont: {size: 12},
                  borderColor: gridColor, borderWidth: 1,
                  padding: 8, boxPadding: 3,
                  usePointStyle: true,
                  multiKeyBackground: 'transparent',
              }
          }
      };
      if (!isPie) {
          options.scales = { 
              x: { 
                  ticks: { color: textColor, font: {size: 10}, maxRotation: 0, autoSkipPadding: 10 }, 
                  grid: { color: gridColor, drawBorder: false } 
              }, 
              y: { 
                  ticks: { color: textColor, font: {size: 10}, callback: function(value) { return value + (chartType === 'responseTime' ? 'ms' : '%'); } }, 
                  grid: { color: gridColor, drawBorder: false }, 
                  min:0, 
                  max: (chartType === 'responseTime' ? undefined : 100) 
              } 
          };
           options.elements = { point: { radius: 0, hoverRadius: 5, hitRadius: 10, backgroundColor: pointColor } };
      } else { 
          options.plugins.tooltip.callbacks = {
              label: function(context) {
                  let label = context.dataset.label || '';
                  if (context.label) { label = context.label } 
                  if (label) { label += ': '; }
                  if (context.parsed !== null) { label += context.parsed.toFixed(1) + '%'; }
                  return label;
              }
          };
      }
      return options;
  }
  `;
  }
  
  function getIndexHtml() {
    return `<!DOCTYPE html>
  <html lang="zh-CN" data-bs-theme="light">
  <head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title data-i18n-key="vpsMonitorPanel">VPS监控面板</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
      <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet">
      <link href="/css/style.css" rel="stylesheet">
  </head>
  <body data-i18n-page-title="vpsMonitorPanel">
      <nav class="navbar navbar-expand-lg sticky-top shadow-sm">
          <div class="container">
              <a class="navbar-brand fw-bold" href="/" data-i18n-key="vpsMonitorPanel">VPS监控面板</a>
              <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav"><span class="navbar-toggler-icon"></span></button>
              <div class="collapse navbar-collapse" id="navbarNav">
                  <ul class="navbar-nav ms-auto align-items-center">
                      <li class="nav-item"><a href="https://github.com/JohnMing143/vps-monitor" target="_blank" rel="noopener noreferrer" class="nav-link" data-i18n-key="githubRepo" title="GitHub仓库"><i class="bi bi-github fs-5"></i> <span class="d-lg-none ms-1" data-i18n-key="githubRepo">GitHub仓库</span></a></li>
                      <li class="nav-item"><button id="themeToggler" class="btn nav-link" data-i18n-key="toggleTheme" title="切换主题"><i class="bi bi-moon-stars-fill fs-5"></i> <span class="d-lg-none ms-1" data-i18n-key="toggleTheme">切换主题</span></button></li>
                      <li class="nav-item"><button id="languageToggler" class="btn nav-link" data-i18n-key="toggleLanguage" title="切换语言">EN</button></li>
                      <li class="nav-item"><a class="nav-link" id="adminAuthLink" href="/login.html" data-i18n-key="adminLogin">管理员登录</a></li>
                  </ul>
              </div>
          </div>
      </nav>
  
      <div class="container mt-4 mb-5">
          <div id="noServers" class="alert alert-info d-none" data-i18n-key="noServerData"></div>
          <div id="serverCardsContainer" class="row row-cols-1 row-cols-md-2 row-cols-xl-3 g-4">
              <!-- Loading Placeholders -->
              <div class="col placeholder-glow" id="loadingPlaceholderCard_1">
                  <div class="card server-card placeholder-card h-100"><div class="card-body pb-2"><div class="d-flex justify-content-between align-items-start mb-2"><h5 class="card-title placeholder col-6"></h5> <span class="badge placeholder col-3"></span></div><div class="row g-1 small"><div class="col-6 placeholder col-5"></div><div class="col-6 placeholder col-5"></div><div class="col-12 placeholder col-7 mt-1"></div></div></div></div>
              </div>
              <div class="col placeholder-glow" id="loadingPlaceholderCard_2">
                  <div class="card server-card placeholder-card h-100"><div class="card-body pb-2"><div class="d-flex justify-content-between align-items-start mb-2"><h5 class="card-title placeholder col-7"></h5> <span class="badge placeholder col-2"></span></div><div class="row g-1 small"><div class="col-6 placeholder col-4"></div><div class="col-6 placeholder col-6"></div><div class="col-12 placeholder col-5 mt-1"></div></div></div></div>
              </div>
              <div class="col placeholder-glow" id="loadingPlaceholderCard_3">
                  <div class="card server-card placeholder-card h-100"><div class="card-body pb-2"><div class="d-flex justify-content-between align-items-start mb-2"><h5 class="card-title placeholder col-5"></h5> <span class="badge placeholder col-3"></span></div><div class="row g-1 small"><div class="col-6 placeholder col-6"></div><div class="col-6 placeholder col-4"></div><div class="col-12 placeholder col-6 mt-1"></div></div></div></div>
              </div>
          </div>
      </div>
  
      <div class="container mb-5">
          <h2 data-i18n-key="siteStatusTitle" class="mb-3">网站在线状态</h2>
          <div id="noSites" class="alert alert-info d-none" data-i18n-key="noSiteData"></div>
          <div class="table-responsive card shadow-sm">
              <div class="card-body p-0">
                  <table class="table table-hover align-middle mb-0 sites-table">
                      <thead><tr><th data-i18n-key="siteNameCol">名称</th><th data-i18n-key="siteStatusCol">状态</th><th data-i18n-key="siteStatusCodeCol">状态码</th><th data-i18n-key="siteResponseTimeCol">响应时间 (ms)</th><th data-i18n-key="siteLastCheckCol">最后检查</th><th class="text-center" data-i18n-key="site24hHistoryCol">24h记录</th></tr></thead>
                      <tbody id="siteStatusTableBody"><tr><td colspan="6" class="text-center py-5" data-i18n-key="loading"><div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">Loading...</span></div></td></tr></tbody>
                  </table>
              </div>
          </div>
      </div>
      
      <template id="serverCardTemplate">
          <div class="col">
              <div class="card server-card h-100">
                  <div class="card-body"> <!-- Main visible part of the card -->
                      <div class="d-flex justify-content-between align-items-start mb-2">
                          <h5 class="card-title server-name mb-0">Server Name</h5>
                          <span class="badge server-status-badge ms-2">Status</span>
                      </div>
                      <div class="row g-1 server-quick-stats">
                          <div class="col-6"><i class="bi bi-arrow-up-short"></i> <span class="server-upload-speed">-</span></div>
                          <div class="col-6"><i class="bi bi-arrow-down-short"></i> <span class="server-download-speed">-</span></div>
                          <div class="col-12 text-muted server-last-update-container"><i class="bi bi-clock-history"></i> <span class="server-last-update">-</span></div>
                      </div>
                  </div>
                  <div class="server-details-section"> <!-- This section expands within the card -->
                      <div class="server-details-content">
                          <h6 class="details-section-title" data-i18n-key="status">状态</h6>
                          <div class="row text-center mb-2 g-2 server-resource-pies">
                              <div class="col-4">
                                  <div class="chart-pie-wrapper"><canvas class="server-cpu-pie-chart"></canvas></div>
                                  <small data-i18n-key="cpu">CPU</small>
                              </div>
                              <div class="col-4">
                                  <div class="chart-pie-wrapper"><canvas class="server-memory-pie-chart"></canvas></div>
                                  <small data-i18n-key="memory">内存</small>
                              </div>
                              <div class="col-4">
                                  <div class="chart-pie-wrapper"><canvas class="server-disk-pie-chart"></canvas></div>
                                  <small data-i18n-key="disk">硬盘</small>
                              </div>
                          </div>
                          <div class="server-text-details small mb-2"></div>
                          <hr class="my-2">
                          <h6 class="details-section-title" data-i18n-key="cpuUsageLast24h">CPU 使用率 (近24小时)</h6>
                          <div class="chart-line-container mb-2"><canvas class="server-cpu-line-chart"></canvas></div>
                          <h6 class="details-section-title" data-i18n-key="memoryUsageLast24h">内存 使用率 (近24小时)</h6>
                          <div class="chart-line-container"><canvas class="server-memory-line-chart"></canvas></div>
                      </div>
                  </div>
              </div>
          </div>
      </template>
  
      <template id="siteDetailsTemplate">
          <tr class="site-details-row d-none"><td colspan="6">
               <div class="card shadow-sm"><div class="card-body chart-container"><canvas class="site-response-chart"></canvas></div></div>
          </td></tr>
      </template>
  
      <footer class="footer mt-auto py-3">
          <div class="container text-center">
              <span data-i18n-key="copyright">VPS监控面板</span> &copy; ${new Date().getFullYear()}
              <a href="https://github.com/JohnMing143/vps-monitor" target="_blank" rel="noopener noreferrer" class="ms-2" data-i18n-key="githubRepo" title="GitHub仓库"><i class="bi bi-github fs-5"></i></a>
          </div>
      </footer>
      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
      <script src="/js/common.js"></script>
      <script src="/js/main.js"></script>
  </body></html>`;
  }
  
  function getLoginHtml() { /* NO CHANGE */ return `<!DOCTYPE html><html lang="zh-CN" data-bs-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title data-i18n-key="loginTitle">登录 - VPS监控面板</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet"><link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet"><link href="/css/style.css" rel="stylesheet"></head><body data-i18n-page-title="loginTitle"><nav class="navbar navbar-expand-lg sticky-top shadow-sm"><div class="container"><a class="navbar-brand fw-bold" href="/" data-i18n-key="vpsMonitorPanel">VPS监控面板</a><button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav"><span class="navbar-toggler-icon"></span></button><div class="collapse navbar-collapse" id="navbarNav"><ul class="navbar-nav ms-auto align-items-center"><li class="nav-item"><button id="themeToggler" class="btn nav-link" data-i18n-key="toggleTheme" title="切换主题"><i class="bi bi-moon-stars-fill fs-5"></i> <span class="d-lg-none ms-1" data-i18n-key="toggleTheme">切换主题</span></button></li><li class="nav-item"><button id="languageToggler" class="btn nav-link" data-i18n-key="toggleLanguage" title="切换语言">EN</button></li><li class="nav-item"><a class="nav-link" href="/" data-i18n-key="returnToHome">返回首页</a></li></ul></div></div></nav><div class="container mt-5"><div class="row justify-content-center"><div class="col-md-6 col-lg-4"><div class="card shadow-lg border-0 rounded-3"><div class="card-header bg-primary text-white text-center"><h4 class="card-title mb-0" data-i18n-key="adminLoginTitle">管理员登录</h4></div><div class="card-body p-4 p-sm-5"><div id="loginAlert" class="alert alert-danger d-none"></div><form id="loginForm"><div class="mb-3"><label for="username" class="form-label" data-i18n-key="usernameLabel">用户名</label><input type="text" class="form-control form-control-lg" id="username" required></div><div class="mb-4"><label for="password" class="form-label" data-i18n-key="passwordLabel">密码</label><input type="password" class="form-control form-control-lg" id="password" required></div><div class="d-grid"><button type="submit" class="btn btn-primary btn-lg" data-i18n-key="loginButton">登录</button></div></form></div><div class="card-footer text-muted text-center py-3"><small data-i18n-key="initialCredentials">初始账号密码: admin / admin</small></div></div></div></div></div><footer class="footer mt-auto py-3"><div class="container text-center"><span data-i18n-key="copyright">VPS监控面板</span> &copy; ${new Date().getFullYear()}<a href="https://github.com/JohnMing143/vps-monitor" target="_blank" rel="noopener noreferrer" class="ms-2" data-i18n-key="githubRepo" title="GitHub仓库"><i class="bi bi-github fs-5"></i></a></div></footer><script src="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js"></script><script src="/js/common.js"></script><script src="/js/login.js"></script></body></html>`; }
  function getAdminHtml() { /* NO CHANGE */ return `<!DOCTYPE html><html lang="zh-CN" data-bs-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title data-i18n-key="adminPageTitle">管理后台 - VPS监控面板</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet"><link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet"><link href="/css/style.css" rel="stylesheet"></head><body data-i18n-page-title="adminPageTitle"><nav class="navbar navbar-expand-lg sticky-top shadow-sm"><div class="container"><a class="navbar-brand fw-bold" href="/" data-i18n-key="vpsMonitorPanel">VPS监控面板</a><button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav"><span class="navbar-toggler-icon"></span></button><div class="collapse navbar-collapse" id="navbarNav"><ul class="navbar-nav me-auto"><li class="nav-item"><a class="nav-link" href="/" data-i18n-key="returnToHome">返回首页</a></li></ul><ul class="navbar-nav ms-auto align-items-center"><li class="nav-item"><a href="https://github.com/JohnMing143/vps-monitor" target="_blank" rel="noopener noreferrer" class="nav-link" data-i18n-key="githubRepo" title="GitHub仓库"><i class="bi bi-github fs-5"></i> <span class="d-lg-none ms-1" data-i18n-key="githubRepo">GitHub仓库</span></a></li><li class="nav-item"><button id="themeToggler" class="btn nav-link" data-i18n-key="toggleTheme" title="切换主题"><i class="bi bi-moon-stars-fill fs-5"></i> <span class="d-lg-none ms-1" data-i18n-key="toggleTheme">切换主题</span></button></li><li class="nav-item"><button id="languageToggler" class="btn nav-link" data-i18n-key="toggleLanguage" title="切换语言">EN</button></li><li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" id="adminActionsDropdown" role="button" data-bs-toggle="dropdown" aria-expanded="false"><i class="bi bi-person-circle fs-5 me-1"></i> <span data-i18n-key="adminPanel">管理后台</span></a><ul class="dropdown-menu dropdown-menu-end shadow border-0" aria-labelledby="adminActionsDropdown"><li><button id="changePasswordBtn" class="dropdown-item" data-i18n-key="changePassword"><i class="bi bi-shield-lock me-2"></i>修改密码</button></li><li><hr class="dropdown-divider"></li><li><button id="logoutBtn" class="dropdown-item text-danger" data-i18n-key="logout"><i class="bi bi-box-arrow-right me-2"></i>退出登录</button></li></ul></li></ul></div></div></nav><div id="alertContainer" class="fixed-alerts-container"><div id="serverAlert" class="alert d-none" role="alert"></div><div id="siteAlert" class="alert d-none" role="alert"></div><div id="telegramSettingsAlert" class="alert d-none" role="alert"></div></div><div class="container mt-4 mb-4"><div class="d-flex justify-content-between align-items-center mb-3"><h2 data-i18n-key="serverManagement">服务器管理</h2><button id="addServerBtn" class="btn btn-primary"><i class="bi bi-plus-circle me-1"></i> <span data-i18n-key="addServer">添加服务器</span></button></div><div class="card shadow-sm"><div class="card-body p-0"><div class="table-responsive"><table class="table table-striped table-hover align-middle mb-0"><thead><tr><th data-i18n-key="serverColSort">排序</th><th data-i18n-key="serverColId">ID</th><th data-i18n-key="serverColName">名称</th><th data-i18n-key="serverColDesc">描述</th><th data-i18n-key="serverColApiKey">API密钥</th><th data-i18n-key="serverColStatus">状态</th><th data-i18n-key="serverColLastUpdate">最后更新</th><th data-i18n-key="serverColActions">操作</th></tr></thead><tbody id="serverTableBody"><tr><td colspan="8" class="text-center" data-i18n-key="loading">加载中...</td></tr></tbody></table></div></div></div></div><div class="container mt-4 mb-4"><div class="d-flex justify-content-between align-items-center mb-3"><h2 data-i18n-key="siteManagement">网站监控管理</h2><button id="addSiteBtn" class="btn btn-success"><i class="bi bi-plus-circle me-1"></i> <span data-i18n-key="addSite">添加监控网站</span></button></div><div class="card shadow-sm"><div class="card-body p-0"><div class="table-responsive"><table class="table table-striped table-hover align-middle mb-0"><thead><tr><th data-i18n-key="siteColSort">排序</th><th data-i18n-key="siteColName">名称</th><th data-i18n-key="siteColUrl">URL</th><th data-i18n-key="siteStatusCol">状态</th><th data-i18n-key="siteStatusCodeCol">状态码</th><th data-i18n-key="siteResponseTimeCol">响应 (ms)</th><th data-i18n-key="siteLastCheckCol">最后检查</th><th data-i18n-key="serverColActions">操作</th></tr></thead><tbody id="siteTableBody"><tr><td colspan="8" class="text-center" data-i18n-key="loading">加载中...</td></tr></tbody></table></div></div></div></div><div class="container mt-4 mb-4"><h2 data-i18n-key="telegramSettings">Telegram 通知设置</h2><div class="card shadow-sm"><div class="card-body"><form id="telegramSettingsForm"><div class="mb-3"><label for="telegramBotToken" class="form-label" data-i18n-key="telegramBotTokenLabel">Bot Token</label><input type="text" class="form-control" id="telegramBotToken" data-i18n-placeholder-key="telegramBotTokenLabel" placeholder="请输入 Telegram Bot Token"></div><div class="mb-3"><label for="telegramChatId" class="form-label" data-i18n-key="telegramChatIdLabel">Chat ID</label><input type="text" class="form-control" id="telegramChatId" data-i18n-placeholder-key="telegramChatIdLabel" placeholder="请输入接收通知的 Chat ID"></div><div class="form-check mb-3"><input class="form-check-input" type="checkbox" id="enableTelegramNotifications"><label class="form-check-label" for="enableTelegramNotifications" data-i18n-key="enableTelegramNotificationsLabel">启用通知</label></div><button type="button" id="saveTelegramSettingsBtn" class="btn btn-info"><i class="bi bi-save me-1"></i> <span data-i18n-key="saveTelegramSettings">保存Telegram设置</span></button></form></div></div></div><div class="modal fade" id="serverModal" tabindex="-1"><div class="modal-dialog modal-dialog-centered"><div class="modal-content border-0 shadow-lg rounded-3"><div class="modal-header bg-light border-bottom-0"><h5 class="modal-title" id="serverModalTitle" data-i18n-key="addServerTitle">添加服务器</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div><div class="modal-body p-4"><form id="serverForm"><input type="hidden" id="serverId"><div class="mb-3"><label for="serverName" class="form-label" data-i18n-key="serverNameLabel">服务器名称</label><input type="text" class="form-control" id="serverName" required></div><div class="mb-3"><label for="serverDescription" class="form-label" data-i18n-key="serverDescLabel">描述（可选）</label><textarea class="form-control" id="serverDescription" rows="2"></textarea></div><div id="serverIdDisplayGroup" class="mb-3 d-none"><label for="serverIdDisplay" class="form-label" data-i18n-key="serverIDLabel">服务器ID</label><div class="input-group"><input type="text" class="form-control" id="serverIdDisplay" readonly><button class="btn btn-outline-secondary" type="button" id="copyServerIdBtn" title="Copy"><i class="bi bi-clipboard"></i></button></div></div><div id="workerUrlDisplayGroup" class="mb-3 d-none"><label for="workerUrlDisplay" class="form-label" data-i18n-key="workerUrlLabel">Worker 地址</label><div class="input-group"><input type="text" class="form-control" id="workerUrlDisplay" readonly><button class="btn btn-outline-secondary" type="button" id="copyWorkerUrlBtn" title="Copy"><i class="bi bi-clipboard"></i></button></div></div><div id="apiKeyGroup" class="mb-3 d-none"><label for="apiKey" class="form-label" data-i18n-key="apiKeyLabel">API密钥</label><div class="input-group"><input type="text" class="form-control" id="apiKey" readonly><button class="btn btn-outline-secondary" type="button" id="copyApiKeyBtn" title="Copy"><i class="bi bi-clipboard"></i></button></div></div></form></div><div class="modal-footer border-top-0"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal" data-i18n-key="close">关闭</button><button type="button" class="btn btn-primary" id="saveServerBtn" data-i18n-key="save">保存</button></div></div></div></div><div class="modal fade" id="siteModal" tabindex="-1"><div class="modal-dialog modal-dialog-centered"><div class="modal-content border-0 shadow-lg rounded-3"><div class="modal-header bg-light border-bottom-0"><h5 class="modal-title" id="siteModalTitle" data-i18n-key="addSiteTitle">添加监控网站</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div><div class="modal-body p-4"><form id="siteForm"><input type="hidden" id="siteId"><div class="mb-3"><label for="siteName" class="form-label" data-i18n-key="siteNameLabel">网站名称（可选）</label><input type="text" class="form-control" id="siteName"></div><div class="mb-3"><label for="siteUrl" class="form-label" data-i18n-key="siteUrlLabel">网站URL</label><input type="url" class="form-control" id="siteUrl" placeholder="https://example.com" required></div></form></div><div class="modal-footer border-top-0"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal" data-i18n-key="close">关闭</button><button type="button" class="btn btn-primary" id="saveSiteBtn" data-i18n-key="save">保存</button></div></div></div></div><div class="modal fade" id="deleteModal" tabindex="-1"><div class="modal-dialog modal-dialog-centered"><div class="modal-content border-0 shadow-lg rounded-3"><div class="modal-header bg-light border-bottom-0"><h5 class="modal-title" data-i18n-key="confirmDelete">确认删除</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div><div class="modal-body p-4"><p><span data-i18n-key="confirmDeleteServerMsg">确定要删除服务器</span> "<strong id="deleteServerName"></strong>"?</p><p class="text-danger small"><i class="bi bi-exclamation-triangle-fill me-1"></i><span data-i18n-key="irreversibleAction">此操作不可逆，所有相关的监控数据也将被删除。</span></p></div><div class="modal-footer border-top-0"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal" data-i18n-key="cancel">取消</button><button type="button" class="btn btn-danger" id="confirmDeleteBtn" data-i18n-key="delete">删除</button></div></div></div></div><div class="modal fade" id="deleteSiteModal" tabindex="-1"><div class="modal-dialog modal-dialog-centered"><div class="modal-content border-0 shadow-lg rounded-3"><div class="modal-header bg-light border-bottom-0"><h5 class="modal-title" data-i18n-key="confirmDelete">确认删除</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div><div class="modal-body p-4"><p><span data-i18n-key="confirmDeleteSiteMsg">确定要停止监控网站</span> "<strong id="deleteSiteName"></strong>" (<code id="deleteSiteUrl"></code>)<span data-i18n-key="confirmDeleteSiteMsgEnd">吗？</span></p></div><div class="modal-footer border-top-0"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal" data-i18n-key="cancel">取消</button><button type="button" class="btn btn-danger" id="confirmDeleteSiteBtn" data-i18n-key="delete">删除</button></div></div></div></div><div class="modal fade" id="passwordModal" tabindex="-1"><div class="modal-dialog modal-dialog-centered"><div class="modal-content border-0 shadow-lg rounded-3"><div class="modal-header bg-light border-bottom-0"><h5 class="modal-title" data-i18n-key="changePasswordTitle">修改密码</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div><div class="modal-body p-4"><div id="passwordAlert" class="alert d-none"></div><form id="passwordForm"><div class="mb-3"><label for="currentPassword" class="form-label" data-i18n-key="currentPasswordLabel">当前密码</label><input type="password" class="form-control" id="currentPassword" required></div><div class="mb-3"><label for="newPassword" class="form-label" data-i18n-key="newPasswordLabel">新密码</label><input type="password" class="form-control" id="newPassword" required></div><div class="mb-3"><label for="confirmPassword" class="form-label" data-i18n-key="confirmNewPasswordLabel">确认新密码</label><input type="password" class="form-control" id="confirmPassword" required></div></form></div><div class="modal-footer border-top-0"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal" data-i18n-key="cancel">取消</button><button type="button" class="btn btn-primary" id="savePasswordBtn" data-i18n-key="save">保存</button></div></div></div></div><footer class="footer mt-auto py-3"><div class="container text-center"><span data-i18n-key="copyright">VPS监控面板</span> &copy; ${new Date().getFullYear()}<a href="https://github.com/JohnMing143/vps-monitor" target="_blank" rel="noopener noreferrer" class="ms-2" data-i18n-key="githubRepo" title="GitHub仓库"><i class="bi bi-github fs-5"></i></a></div></footer><script src="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js"></script><script src="/js/common.js"></script><script src="/js/admin.js"></script></body></html>`;}
  
  function getStyleCss() {
    const gaBlue = '#4285F4'; const gaGreen = '#34A853'; const gaYellow = '#FBBC05'; const gaRed = '#EA4335';
    const lightBg = '#f4f6f8'; const darkBg = '#1c1e21'; const darkCardBg = '#282a2d'; 
    const darkText = '#e4e6eb'; const lightText = '#1c1e21'; 
    return `
  :root {
      --primary-color: ${gaBlue}; --primary-hover-color: #3367D6;
      --success-color: ${gaGreen}; --warning-color: ${gaYellow}; --danger-color: ${gaRed};
      --light-bg: ${lightBg}; --dark-bg: ${darkBg};
      --card-bg-light: #ffffff; --card-bg-dark: ${darkCardBg};
      --text-color-light: ${lightText}; --text-color-dark: ${darkText};
      --border-color-light: #e0e0e0; --border-color-dark: #383a3c;
      --muted-color-light: #5f6368; --muted-color-dark: #9aa0a6;
      --bs-body-font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
      --bs-body-line-height: 1.6; --bs-border-radius: .4rem; --bs-card-border-radius: .6rem;
      --navbar-height: 60px; 
      --bs-primary-rgb: 66,133,244; /* For rgba() background on charts */
      --bs-success-rgb: 52,168,83;
  }
  [data-bs-theme="light"] { --bs-body-color: var(--text-color-light); --bs-body-bg: var(--light-bg); --bs-tertiary-bg: #eef0f2; --card-bg: var(--card-bg-light); --bs-border-color: var(--border-color-light); --text-muted-custom: var(--muted-color-light); }
  [data-bs-theme="dark"] { --bs-body-color: var(--text-color-dark); --bs-body-bg: var(--dark-bg); --bs-tertiary-bg: #222427; --card-bg: var(--card-bg-dark); --bs-border-color: var(--border-color-dark); --text-muted-custom: var(--muted-color-dark); }
  body { min-height: 100vh; display: flex; flex-direction: column; transition: background-color 0.2s ease-in-out, color 0.2s ease-in-out; }
  .navbar { background-color: var(--card-bg); transition: background-color 0.2s ease-in-out; height: var(--navbar-height); }
  .navbar-brand { color: var(--bs-body-color) !important; font-weight: 600;}
  .nav-link { color: var(--bs-body-color) !important; opacity: 0.9; font-weight: 500;}
  .nav-link:hover, .nav-link:focus { opacity: 1; color: var(--primary-color) !important; }
  .nav-link .bi, .btn .bi { vertical-align: -0.1em; } #languageToggler { min-width: 50px; text-align: center; }
  .footer { background-color: var(--card-bg); border-top: 1px solid var(--bs-border-color); padding: 1rem 0; font-size: 0.9em; color: var(--text-muted-custom); transition: background-color 0.2s ease-in-out, border-color 0.2s ease-in-out; }
  .footer a { color: var(--text-muted-custom); text-decoration: none; } .footer a:hover { color: var(--primary-color); }
  h1, h2, h3, h4, h5, h6 { color: var(--bs-body-color); font-weight: 600; }
  h2 { margin-bottom: 1.5rem; font-size: 1.85rem; }
  .card { background-color: var(--card-bg); border: 1px solid var(--bs-border-color); border-radius: var(--bs-card-border-radius); box-shadow: 0 2px 10px rgba(0,0,0, .04); transition: all 0.25s ease-in-out; }
  [data-bs-theme="dark"] .card { box-shadow: 0 2px 10px rgba(0,0,0, .1); }
  .card-header { background-color: transparent; border-bottom: 1px solid var(--bs-border-color); padding: 0.85rem 1.25rem; font-weight: 500; }
  .table { color: var(--bs-body-color); } .table th { font-weight: 500; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted-custom); border-bottom-width: 1px; padding: 0.85rem 1rem;}
  .table td { font-size: 0.9rem; vertical-align: middle; padding: 0.85rem 1rem;}
  .sites-table tr:hover { background-color: var(--bs-tertiary-bg); }
  .badge { font-size: 0.82em; padding: 0.45em 0.7em; font-weight: 500; line-height: 1; }
  .bg-success { background-color: var(--success-color) !important; } .bg-danger { background-color: var(--danger-color) !important; }
  .bg-warning { background-color: var(--warning-color) !important; color: #212529 !important; } .bg-secondary { background-color: var(--text-muted-custom) !important; }
  
  .server-card {
      display: flex; flex-direction: column; /* For h-100 and internal flex behavior */
      transition: box-shadow 0.3s ease-in-out, transform 0.3s ease-in-out;
  }
  .server-card.details-visible { /* Applied on hover */
      transform: translateY(-5px) scale(1.01); /* Lift and slightly enlarge */
      box-shadow: 0 15px 35px rgba(0,0,0, .12);
      z-index: 10; /* Bring to front */
  }
  [data-bs-theme="dark"] .server-card.details-visible { box-shadow: 0 15px 35px rgba(0,0,0, .25); }
  
  .server-card .card-body { 
      padding: 1rem 1.25rem; 
      flex-shrink: 0; 
  }
  .server-card .card-title { font-size: 1.2rem; color: var(--bs-body-color); }
  .server-quick-stats { font-size: 0.9em; color: var(--text-muted-custom); }
  .server-quick-stats .bi { margin-right: 0.3rem; font-size: 1.05em; }
  .server-last-update-container { color: var(--text-muted-custom); font-size: 0.8em; }
  
  .server-details-section {
      max-height: 0;
      opacity: 0;
      overflow: hidden;
      border-top: 1px solid transparent;
      background-color: var(--bs-tertiary-bg);
      transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), 
                  opacity 0.3s ease-in-out,
                  padding-top 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                  padding-bottom 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                  margin-top 0.4s cubic-bezier(0.4, 0, 0.2, 1), 
                  border-color 0.3s ease-in-out;
  }
  .server-card.details-visible .server-details-section {
      max-height: 800px; /* Increased to ensure all content fits */
      opacity: 1;
      padding-top: 1rem; 
      padding-bottom: 1rem;
      margin-top: 0; /* Details section is part of card, no top margin */
      border-top-color: var(--bs-border-color);
  }
  .server-details-content { padding-left: 1.25rem; padding-right: 1.25rem; }
  .details-section-title { font-size: 0.85rem; font-weight: 600; margin-bottom: 0.6rem; text-align: center; color: var(--text-muted-custom); text-transform: uppercase; letter-spacing: 0.05em;}
  .server-text-details p { margin-bottom: 0.4rem; font-size: 0.875rem; }
  .server-text-details strong { font-weight: 500; color: var(--bs-body-color); }
  .server-resource-pies .col-4 { flex: 0 0 auto; width: 33.33333333%; }
  
  
  .chart-container { position: relative; height: 200px; width: 100%; }
  .chart-pie-wrapper { position: relative; height: 70px; width: 100%; margin: 0 auto 0.1rem auto; max-width: 80px; } /* Slightly smaller pie */
  .chart-line-container { position: relative; height: 160px; width: 100%; }
  
  .site-details-row td { padding: 1rem; background-color: var(--bs-tertiary-bg); }
  .history-bar-container { display: flex; flex-direction: row-reverse; align-items: center; justify-content: flex-start; height: 20px; gap: 2px; min-width: calc(24 * (5px + 1px)); }
  .history-bar { width: 5px; height: 18px; border-radius: 1px; opacity: 0.85; transition: opacity 0.2s ease-in-out; } .history-bar:hover { opacity: 1; }
  .history-bar-up { background-color: var(--success-color); } .history-bar-down { background-color: var(--danger-color); } 
  .history-bar-pending { background-color: var(--text-muted-custom); }
  
  .fixed-alerts-container { position: fixed; top: calc(var(--navbar-height) + 1rem); right: 1rem; z-index: 1055; width: auto; max-width: 380px; }
  .fixed-alerts-container .alert { margin-bottom: 0.75rem; box-shadow: 0 .5rem 1rem rgba(0,0,0,.15)!important; border-radius: var(--bs-border-radius); }
  @media (max-width: 768px) { .fixed-alerts-container { left: 1rem; right: 1rem; max-width: none; width: calc(100% - 2rem); } }
  .placeholder-card { background-color: var(--card-bg) !important; opacity: 0.7; }
  .placeholder-glow .placeholder { background-color: var(--bs-tertiary-bg); border-radius: .25rem; }
  
  /* Modal and Admin page styles for modern look */
  .modal-content { border-radius: var(--bs-card-border-radius); box-shadow: 0 .5rem 1rem rgba(0,0,0,.15)!important; }
  .modal-header { border-bottom: 1px solid var(--bs-border-color); }
  .modal-footer { border-top: 1px solid var(--bs-border-color); }
  .form-control, .form-select { border-radius: var(--bs-border-radius); }
  .btn { border-radius: var(--bs-border-radius); font-weight: 500; padding: .5rem 1rem; }
  .btn-primary { background-color: var(--primary-color); border-color: var(--primary-color); }
  .btn-primary:hover { background-color: var(--primary-hover-color); border-color: var(--primary-hover-color); }
  `;
  }
  
  function getMainJs() {
    return `
  document.addEventListener('DOMContentLoaded', function() {
      initializeThemeAndLanguage();
      showLoadingPlaceholders(3);
      loadAllServerStatuses();
      loadAllSiteStatuses();
      setInterval(() => { loadAllServerStatuses(); loadAllSiteStatuses(); }, 60000);
      
      const serverCardsContainer = document.getElementById('serverCardsContainer');
      serverCardsContainer.addEventListener('mouseenter', handleServerCardHover, true);
      serverCardsContainer.addEventListener('mouseleave', handleServerCardHover, true);
      
      document.getElementById('siteStatusTableBody').addEventListener('click', handleSiteRowClick);
      updateAdminLink();
  });
  
  let serverDataCache = {}; 
  let siteDataCache = {};
  let serverCardChartInstances = {}; 
  let siteLineChartInstances = {};
  let cardHoverTimeout = null; 
  let currentlyExpandedCard = null; 
  
  function showLoadingPlaceholders(count = 3) {
      const container = document.getElementById('serverCardsContainer');
      const placeholderTemplate = document.getElementById('loadingPlaceholderCard_1');
      if (!container || !placeholderTemplate) return;
      container.innerHTML = ''; 
      for (let i = 0; i < count; i++) {
          const placeholder = placeholderTemplate.cloneNode(true);
          placeholder.id = \`loadingPlaceholderCard_clone_\${i+1}\`; 
          container.appendChild(placeholder);
      }
  }
  function hideLoadingPlaceholders() {
      const placeholders = document.querySelectorAll('#serverCardsContainer .placeholder-glow');
      placeholders.forEach(p => p.remove());
  }
  
  async function updateAdminLink() { 
      const adminLink = document.getElementById('adminAuthLink'); if (!adminLink) return;
      try {
          const token = localStorage.getItem('auth_token');
          if (!token) { adminLink.setAttribute('data-i18n-key', 'adminLogin'); adminLink.href = '/login.html'; translatePage(); return; }
          const response = await fetch('/api/auth/status', { headers: { 'Authorization': \`Bearer \${token}\` } });
          if (response.ok) {
              const data = await response.json();
              if (data.authenticated) { adminLink.setAttribute('data-i18n-key', 'adminPanel'); adminLink.href = '/admin.html'; }
              else { adminLink.setAttribute('data-i18n-key', 'adminLogin'); adminLink.href = '/login.html'; localStorage.removeItem('auth_token'); }
          } else { adminLink.setAttribute('data-i18n-key', 'adminLogin'); adminLink.href = '/login.html'; }
      } catch (error) { console.error('Error checking auth status:', error); adminLink.setAttribute('data-i18n-key', 'adminLogin'); adminLink.href = '/login.html'; }
      translatePage();
  }
  
  function handleServerCardHover(event) {
      const card = event.target.closest('.server-card');
      if (!card || card.classList.contains('placeholder-card')) return;
  
      const serverId = card.getAttribute('data-server-id');
      
      if (event.type === 'mouseenter') {
          clearTimeout(cardHoverTimeout);
  
          // If the hovered card is not the currently expanded one, collapse the old one
          if (currentlyExpandedCard && currentlyExpandedCard !== card) {
              currentlyExpandedCard.classList.remove('details-visible');
          }
          
          // Expand the new card
          card.classList.add('details-visible');
          currentlyExpandedCard = card;
  
          if(serverCardChartInstances[serverId]) {
              Object.values(serverCardChartInstances[serverId]).forEach(chart => {
                  if (chart && typeof chart.resize === 'function') chart.resize();
              });
          }
          fetchAndRenderServerLineCharts(serverId, card, false); 
      } else if (event.type === 'mouseleave') {
          cardHoverTimeout = setTimeout(() => {
              // Check if the mouse has moved to an element that is NOT a child of the current card.
              // This ensures that if the mouse moves onto the expanded details, it doesn't immediately close.
              if (!card.contains(event.relatedTarget)) {
                   card.classList.remove('details-visible');
                   if(currentlyExpandedCard === card) {
                      currentlyExpandedCard = null;
                   }
              }
          }, 200); // Slightly shorter delay
      }
  }
  
  
  function handleSiteRowClick(event) {
      const clickedRow = event.target.closest('tr.site-row'); if (!clickedRow) return;
      const siteId = clickedRow.getAttribute('data-site-id');
      const detailsRow = clickedRow.nextElementSibling;
      if (detailsRow && detailsRow.classList.contains('site-details-row')) {
          detailsRow.classList.toggle('d-none');
          if (!detailsRow.classList.contains('d-none')) {
              fetchAndRenderSiteLineChart(siteId, detailsRow);
          }
      }
  }
  
  async function loadAllServerStatuses(forceChartRefresh = false) {
      try {
          const serversResponse = await fetch('/api/servers');
          if (!serversResponse.ok) throw new Error('Failed to get server list');
          const serversData = await serversResponse.json(); const servers = serversData.servers || [];
          const noServersAlert = document.getElementById('noServers');
          const serverCardsContainer = document.getElementById('serverCardsContainer');
  
          if (servers.length === 0) {
              noServersAlert.classList.remove('d-none'); serverCardsContainer.innerHTML = '';
              hideLoadingPlaceholders();
              return;
          }
          noServersAlert.classList.add('d-none');
          const statusPromises = servers.map(server => fetch(\`/api/status/\${server.id}\`).then(res => res.ok ? res.json() : Promise.resolve({ server: server, metrics: null, error: true })).catch(() => Promise.resolve({ server: server, metrics: null, error: true })));
          const allStatuses = await Promise.all(statusPromises);
          hideLoadingPlaceholders(); 
          allStatuses.forEach(data => { serverDataCache[data.server.id] = data; });
          renderServerCards(allStatuses, forceChartRefresh);
      } catch (error) { 
          console.error('Error loading server statuses:', error); 
          hideLoadingPlaceholders(); 
          document.getElementById('serverCardsContainer').innerHTML = \`<div class="col-12"><div class="alert alert-danger">\${getTranslation('loadingServersError')}</div></div>\`; 
      }
  }
  
  function renderServerCards(allStatuses, forceChartRefresh = false) {
      const container = document.getElementById('serverCardsContainer');
      container.innerHTML = ''; 
      const cardTemplate = document.getElementById('serverCardTemplate');
  
      allStatuses.forEach(data => {
          const serverId = data.server.id;
          const cardClone = cardTemplate.content.cloneNode(true);
          const cardElement = cardClone.querySelector('.server-card');
          cardElement.setAttribute('data-server-id', serverId);
          cardElement.querySelector('.server-name').textContent = data.server.name;
          
          let statusText = getTranslation('unknown'); let statusBadgeClass = 'bg-secondary';
          let uploadSpeed = '-', downloadSpeed = '-', lastUpdate = '-';
          let cpuPercent = 0, memoryPercent = 0, diskPercent = 0;
  
          if (data.error) { statusText = getTranslation('error'); statusBadgeClass = 'bg-danger'; }
          else if (data.metrics) {
              const lastReportTime = new Date(data.metrics.timestamp * 1000);
              const diffMinutes = (Date.now() - lastReportTime.getTime()) / (1000 * 60);
              statusText = (diffMinutes <= 5) ? getTranslation('online') : getTranslation('offline');
              statusBadgeClass = (diffMinutes <= 5) ? 'bg-success' : 'bg-danger';
              uploadSpeed = formatNetworkSpeed(data.metrics.network.upload_speed);
              downloadSpeed = formatNetworkSpeed(data.metrics.network.download_speed);
              lastUpdate = lastReportTime.toLocaleString(currentLanguage === 'zh' ? 'zh-CN' : 'en-US', {dateStyle: 'short', timeStyle: 'short'});
              cpuPercent = data.metrics.cpu?.usage_percent || 0;
              memoryPercent = data.metrics.memory?.usage_percent || 0;
              diskPercent = data.metrics.disk?.usage_percent || 0;
              const textDetailsDiv = cardElement.querySelector('.server-text-details');
              let detailsHtml = '';
              if (data.metrics.cpu && data.metrics.cpu.load_avg) { detailsHtml += \`<p><strong>\${getTranslation('cpuLoad')}</strong> \${data.metrics.cpu.load_avg.join(', ')}</p>\`; }
              if (data.metrics.memory) { detailsHtml += \`<p><strong>\${getTranslation('memory')}:</strong> \${getTranslation('total')} \${formatDataSize(data.metrics.memory.total * 1024)}, \${getTranslation('used')} \${formatDataSize(data.metrics.memory.used * 1024)}</p>\`; }
              if (data.metrics.disk) { detailsHtml += \`<p><strong>\${getTranslation('diskUsage')}</strong> \${getTranslation('total')} \${data.metrics.disk.total.toFixed(1)} GB, \${getTranslation('used')} \${data.metrics.disk.used.toFixed(1)} GB</p>\`; }
              if (data.metrics.network) { detailsHtml += \`<p><strong>\${getTranslation('totalTraffic')}</strong> \${getTranslation('upload')}: \${formatDataSize(data.metrics.network.total_upload)}, \${getTranslation('download')}: \${formatDataSize(data.metrics.network.total_download)}</p>\`; }
              textDetailsDiv.innerHTML = detailsHtml || \`<p class="text-muted">\${getTranslation('noDetailedData')}</p>\`;
          }
          
          cardElement.querySelector('.server-status-badge').textContent = statusText;
          cardElement.querySelector('.server-status-badge').className = \`badge server-status-badge \${statusBadgeClass}\`;
          cardElement.querySelector('.server-upload-speed').textContent = uploadSpeed;
          cardElement.querySelector('.server-download-speed').textContent = downloadSpeed;
          cardElement.querySelector('.server-last-update').textContent = lastUpdate;
          container.appendChild(cardClone);
  
          renderServerResourcePieChart(cardElement, serverId, 'cpu', cpuPercent, forceChartRefresh);
          renderServerResourcePieChart(cardElement, serverId, 'memory', memoryPercent, forceChartRefresh);
          renderServerResourcePieChart(cardElement, serverId, 'disk', diskPercent, forceChartRefresh);
      });
      translatePage();
  }
  
  function renderServerResourcePieChart(cardElement, serverId, type, percentage, forceChartRefresh = false) {
      if (!window.Chart) return;
      const canvas = cardElement.querySelector(\`.server-\${type}-pie-chart\`);
      if (!canvas) return;
      if (!serverCardChartInstances[serverId]) serverCardChartInstances[serverId] = {};
      const chartInstanceKey = \`\${type}Pie\`;
  
      if (forceChartRefresh && serverCardChartInstances[serverId][chartInstanceKey]) {
          serverCardChartInstances[serverId][chartInstanceKey].destroy();
          serverCardChartInstances[serverId][chartInstanceKey] = null;
      }
      
      const used = parseFloat(percentage) || 0;
      const available = Math.max(0, 100 - used);
      let usedColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim() || '#0d6efd';
      if (used > 85) usedColor = getComputedStyle(document.documentElement).getPropertyValue('--danger-color').trim() ||'#dc3545';
      else if (used > 65) usedColor = getComputedStyle(document.documentElement).getPropertyValue('--warning-color').trim() || '#ffc107';
      
      const pieData = {
          labels: [getTranslation('used'), getTranslation('available')],
          datasets: [{
              data: [used, available],
              backgroundColor: [usedColor, document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'],
              borderColor: cardElement.style.backgroundColor || (document.documentElement.getAttribute('data-bs-theme') === 'dark' ? '#282a2d' : '#fff'), 
              borderWidth: 1.5, hoverOffset: 4
          }]
      };
      const pieOptions = { responsive: true, maintainAspectRatio: false, cutout: '70%', ...getChartThemeOptions(true) }; 
      
      if (!serverCardChartInstances[serverId][chartInstanceKey]) {
          serverCardChartInstances[serverId][chartInstanceKey] = new Chart(canvas, { type: 'doughnut', data: pieData, options: pieOptions });
      } else {
          serverCardChartInstances[serverId][chartInstanceKey].data = pieData;
          serverCardChartInstances[serverId][chartInstanceKey].options = pieOptions; 
          serverCardChartInstances[serverId][chartInstanceKey].update();
      }
  }
  
  async function loadAllSiteStatuses(forceChartRefresh = false) { 
      try {
          const response = await fetch('/api/sites/status'); if (!response.ok) throw new Error('Failed to get website status list');
          const data = await response.json(); const sites = data.sites || []; siteDataCache = sites; 
          const noSitesAlert = document.getElementById('noSites'); const siteStatusTableBody = document.getElementById('siteStatusTableBody');
          if (sites.length === 0) { noSitesAlert.classList.remove('d-none'); siteStatusTableBody.innerHTML = \`<tr><td colspan="6" class="text-center py-4">\${getTranslation('noSiteData')}</td></tr>\`; return; }
          noSitesAlert.classList.add('d-none');
          renderSiteStatusTable(sites);
      } catch (error) { console.error('Error loading website statuses:', error); document.getElementById('siteStatusTableBody').innerHTML = \`<tr><td colspan="6" class="text-center text-danger py-4">\${getTranslation('loadingSitesError')}</td></tr>\`; }
  }
  async function renderSiteStatusTable(sites) { 
      const tableBody = document.getElementById('siteStatusTableBody'); tableBody.innerHTML = ''; const detailsTemplate = document.getElementById('siteDetailsTemplate');
      if (sites.length === 0) { tableBody.innerHTML = \`<tr><td colspan="6" class="text-center py-4">\${getTranslation('noSiteData')}</td></tr>\`; return; }
      for (const site of sites) {
          const row = document.createElement('tr'); row.classList.add('site-row'); row.setAttribute('data-site-id', site.id);
          const statusInfo = getSiteStatusBadge(site.last_status); const lastCheckTime = site.last_checked ? new Date(site.last_checked * 1000).toLocaleString(currentLanguage === 'zh' ? 'zh-CN' : 'en-US', {dateStyle: 'short', timeStyle: 'short'}) : getTranslation('never');
          const responseTime = site.last_response_time_ms !== null ? \`\${site.last_response_time_ms} ms\` : '-'; const historyCell = document.createElement('td'); historyCell.classList.add('text-center'); historyCell.innerHTML = '<div class="history-bar-container mx-auto"></div>';
          row.innerHTML = \`<td>\${site.name || '-'}</td><td><span class="badge \${statusInfo.class}">\${statusInfo.text}</span></td><td>\${site.last_status_code || '-'}</td><td>\${responseTime}</td><td>\${lastCheckTime}</td>\`;
          row.appendChild(historyCell); tableBody.appendChild(row);
          fetchAndRenderSiteHistoryBars(site.id, historyCell.querySelector('.history-bar-container'));
          const detailsRow = detailsTemplate.content.cloneNode(true).querySelector('tr'); detailsRow.setAttribute('data-site-id', \`\${site.id}-details\`);
          tableBody.appendChild(detailsRow);
      }
  }
  async function fetchAndRenderSiteHistoryBars(siteId, containerElement) { 
      try {
          const response = await fetch(\`/api/sites/\${siteId}/history\`); if (!response.ok) { containerElement.innerHTML = \`<small class="text-muted">\${getTranslation('errorFetchingHistory')}</small>\`; return; }
          const data = await response.json(); const fetchedHistory = data.history || []; let historyHtml = ''; const now = new Date();
          for (let i = 0; i < 24; i++) {
              const slotTime = new Date(now); slotTime.setHours(now.getHours() - i); const slotStart = new Date(slotTime); slotStart.setMinutes(0, 0, 0); const slotEnd = new Date(slotTime); slotEnd.setMinutes(59, 59, 999);
              const slotStartTimestamp = Math.floor(slotStart.getTime() / 1000); const slotEndTimestamp = Math.floor(slotEnd.getTime() / 1000);
              const recordForHour = fetchedHistory.find(r => r.timestamp >= slotStartTimestamp && r.timestamp <= slotEndTimestamp);
              let barClass = 'history-bar-pending'; let titleText = \`\${String(slotStart.getHours()).padStart(2, '0')}:00 - \${String((slotStart.getHours() + 1) % 24).padStart(2, '0')}:00: \${getTranslation('noRecords24h')}\`;
              if (recordForHour) {
                  if (recordForHour.status === 'UP') barClass = 'history-bar-up'; else if (['DOWN', 'TIMEOUT', 'ERROR'].includes(recordForHour.status)) barClass = 'history-bar-down';
                  const recordDate = new Date(recordForHour.timestamp * 1000); titleText = \`\${recordDate.toLocaleString(currentLanguage === 'zh' ? 'zh-CN' : 'en-US')}: \${getSiteStatusBadge(recordForHour.status).text} (\${recordForHour.status_code || 'N/A'}), \${recordForHour.response_time_ms || '-'}ms\`;
              }
              historyHtml += \`<div class="history-bar \${barClass}" title="\${titleText}"></div>\`;
          }
          containerElement.innerHTML = historyHtml || \`<small class="text-muted">\${getTranslation('noRecords24h')}</small>\`;
      } catch (error) { console.error(\`Error fetching/rendering history for site \${siteId}:\`, error); containerElement.innerHTML = \`<small class="text-muted">\${getTranslation('errorRenderingHistory')}</small>\`; }
  }
  function getSiteStatusBadge(status) {
      switch (status) { case 'UP': return { class: 'bg-success', text: getTranslation('siteStatusUp') }; case 'DOWN': return { class: 'bg-danger', text: getTranslation('siteStatusDown') }; case 'TIMEOUT': return { class: 'bg-warning text-dark', text: getTranslation('siteStatusTimeout') }; case 'ERROR': return { class: 'bg-danger', text: getTranslation('siteStatusError') }; case 'PENDING': return { class: 'bg-secondary', text: getTranslation('siteStatusPending') }; default: return { class: 'bg-secondary', text: getTranslation('unknown') }; }
  }
  function formatNetworkSpeed(bytesPerSecond) { 
      if (typeof bytesPerSecond !== 'number' || isNaN(bytesPerSecond)) return '-'; const units = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s']; let i = 0; while (bytesPerSecond >= 1024 && i < units.length - 1) { bytesPerSecond /= 1024; i++; } return \`\${bytesPerSecond.toFixed(1)} \${units[i]}\`;
  }
  function formatDataSize(bytes) { 
      if (typeof bytes !== 'number' || isNaN(bytes)) return '-'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; } return \`\${bytes.toFixed(1)} \${units[i]}\`;
  }
  
  async function fetchAndRenderServerLineCharts(serverId, cardElement, forceRefresh = false) {
      if (!window.Chart) return;
      try {
          let historyToRender;
          const chartsExist = serverCardChartInstances[serverId]?.cpuLine && serverCardChartInstances[serverId]?.memLine;
  
          if (!forceRefresh && chartsExist && serverCardChartInstances[serverId]?.historyData) {
              historyToRender = serverCardChartInstances[serverId].historyData;
          } else {
              const response = await fetch(\`/api/servers/\${serverId}/history\`); 
              if (!response.ok) throw new Error('Failed to fetch server history');
              const data = await response.json(); 
              historyToRender = data.history || [];
              if (!serverCardChartInstances[serverId]) serverCardChartInstances[serverId] = {};
              serverCardChartInstances[serverId].historyData = historyToRender;
          }
          
          const cpuCanvas = cardElement.querySelector('.server-cpu-line-chart');
          const memoryCanvas = cardElement.querySelector('.server-memory-line-chart');
  
          if (!historyToRender || historyToRender.length === 0) {
              // Clear existing charts if no data
              if (serverCardChartInstances[serverId]?.cpuLine) serverCardChartInstances[serverId].cpuLine.destroy();
              if (serverCardChartInstances[serverId]?.memLine) serverCardChartInstances[serverId].memLine.destroy();
              serverCardChartInstances[serverId].cpuLine = null;
              serverCardChartInstances[serverId].memLine = null;
              // Optionally display a "no data" message in chart containers via DOM manipulation if needed
              return;
          }
  
          const labels = historyToRender.map(h => new Date(h.timestamp * 1000).toLocaleTimeString(currentLanguage === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' }));
          const cpuData = historyToRender.map(h => h.cpu_percent); 
          const memoryData = historyToRender.map(h => h.memory_percent);
          
          const lineChartOptions = (titleKey, chartTypeParam = null) => ({ ...getChartThemeOptions(false, chartTypeParam), plugins: { ...getChartThemeOptions(false, chartTypeParam).plugins, title: { display: true, text: getTranslation(titleKey), color: getChartThemeOptions().plugins.legend.labels.color, font: {size: 13, weight: '500'} }} });
  
          if (serverCardChartInstances[serverId].cpuLine) serverCardChartInstances[serverId].cpuLine.destroy();
          serverCardChartInstances[serverId].cpuLine = new Chart(cpuCanvas, { type: 'line', data: { labels: labels, datasets: [{ label: getTranslation('cpu'), data: cpuData, borderColor: 'var(--primary-color)', tension: 0.3, fill: true, backgroundColor: 'rgba(var(--bs-primary-rgb), 0.07)', pointRadius: 0, pointHoverRadius: 4, borderWidth: 1.5 }] }, options: lineChartOptions('cpuUsageLast24h') });
          
          if (serverCardChartInstances[serverId].memLine) serverCardChartInstances[serverId].memLine.destroy();
          serverCardChartInstances[serverId].memLine = new Chart(memoryCanvas, { type: 'line', data: { labels: labels, datasets: [{ label: getTranslation('memory'), data: memoryData, borderColor: 'var(--success-color)', tension: 0.3, fill: true, backgroundColor: 'rgba(var(--bs-success-rgb), 0.07)', pointRadius: 0, pointHoverRadius: 4, borderWidth: 1.5 }] }, options: lineChartOptions('memoryUsageLast24h') });
      
      } catch (error) { console.error(\`Error rendering server line charts for \${serverId}:\`, error); }
  }
  async function fetchAndRenderSiteLineChart(siteId, detailsRowElement) { 
      if (!window.Chart) return;
      try {
          const response = await fetch(\`/api/sites/\${siteId}/history\`); if (!response.ok) throw new Error('Failed to fetch site history');
          const data = await response.json(); const history = (data.history || []).sort((a,b) => a.timestamp - b.timestamp);
          const responseCanvas = detailsRowElement.querySelector('.site-response-chart');
          const labels = history.map(h => new Date(h.timestamp * 1000).toLocaleTimeString(currentLanguage === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit'}));
          const responseTimeData = history.map(h => h.response_time_ms);
          const chartKey = \`site-\${siteId}-response\`;
          
          const lineChartOptions = { ...getChartThemeOptions(false, 'responseTime'), plugins: { ...getChartThemeOptions(false, 'responseTime').plugins, title: { display: true, text: getTranslation('siteResponseTimeLast24h'), color: getChartThemeOptions().plugins.legend.labels.color, font: {size: 13, weight: '500'} }} };
  
          if (siteLineChartInstances[chartKey]) siteLineChartInstances[chartKey].destroy();
          siteLineChartInstances[chartKey] = new Chart(responseCanvas, { type: 'line', data: { labels: labels, datasets: [{ label: getTranslation('siteResponseTimeCol'), data: responseTimeData, borderColor: '#0dcaf0', tension: 0.3, fill: true, backgroundColor: 'rgba(13,202,240,0.07)', pointRadius:0, pointHoverRadius:4, borderWidth: 1.5 }] }, options: lineChartOptions });
      } catch (error) { console.error(\`Error rendering site line chart for \${siteId}:\`, error); }
  }
  `;
  }
  
  function getLoginJs() { /* NO CHANGE */ return `
  document.addEventListener('DOMContentLoaded', function() {
      initializeThemeAndLanguage();
      const loginForm = document.getElementById('loginForm');
      loginForm.addEventListener('submit', function(e) {
          e.preventDefault(); const username = document.getElementById('username').value.trim(); const password = document.getElementById('password').value.trim();
          if (!username || !password) { showAlert('danger', 'enterUsernamePassword', 'loginAlert'); return; } login(username, password);
      }); checkLoginStatus();
  });
  async function checkLoginStatus() { try { const token = localStorage.getItem('auth_token'); if (!token) return; const response = await fetch('/api/auth/status', { headers: { 'Authorization': \`Bearer \${token}\` } }); if (response.ok) { const data = await response.json(); if (data.authenticated) window.location.href = 'admin.html'; } } catch (error) { console.error('Error checking login status:', error); } }
  async function login(username, password) { const submitBtn = document.querySelector('#loginForm button[type="submit"]'); const originalBtnText = submitBtn.innerHTML; submitBtn.disabled = true; submitBtn.innerHTML = \`<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> \${getTranslation('loginInProgress')}\`; try { const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }); if (response.ok) { const data = await response.json(); localStorage.setItem('auth_token', data.token); window.location.href = 'admin.html'; } else { const data = await response.json(); showAlert('danger', data.message || getTranslation('loginFailedError'), 'loginAlert', !data.message); } } catch (error) { console.error('Login error:', error); showAlert('danger', 'loginFailedError', 'loginAlert'); } finally { submitBtn.disabled = false; submitBtn.innerHTML = originalBtnText; const loginButtonKey = submitBtn.getAttribute('data-i18n-key'); if (loginButtonKey) submitBtn.textContent = getTranslation(loginButtonKey); } }
  `; }
  function getAdminJs() { /* NO CHANGE */ return `
  let currentServerId = null; let currentSiteId = null; let serverList = []; let siteList = [];
  let serverModal, siteModal, deleteModal, deleteSiteModal, passwordModal;
  document.addEventListener('DOMContentLoaded', function() { initializeThemeAndLanguage(); checkLoginStatusAndInit(); });
  async function checkLoginStatusAndInit() { try { const token = localStorage.getItem('auth_token'); if (!token) { window.location.href = 'login.html'; return; } const response = await fetch('/api/auth/status', { headers: getAuthHeaders() }); if (response.ok) { const data = await response.json(); if (!data.authenticated) { window.location.href = 'login.html'; return; } initializeAdminPage(); } else { window.location.href = 'login.html'; } } catch (error) { console.error('Error checking admin login status:', error); window.location.href = 'login.html'; } }
  function initializeAdminPage() { initEventListeners(); loadServerList(); loadSiteList(); loadTelegramSettings(); if (document.getElementById('serverModal')) serverModal = new bootstrap.Modal(document.getElementById('serverModal')); if (document.getElementById('siteModal')) siteModal = new bootstrap.Modal(document.getElementById('siteModal')); if (document.getElementById('deleteModal')) deleteModal = new bootstrap.Modal(document.getElementById('deleteModal')); if (document.getElementById('deleteSiteModal')) deleteSiteModal = new bootstrap.Modal(document.getElementById('deleteSiteModal')); if (document.getElementById('passwordModal')) passwordModal = new bootstrap.Modal(document.getElementById('passwordModal')); }
  function initEventListeners() { document.getElementById('addServerBtn').addEventListener('click', () => showServerModal()); document.getElementById('saveServerBtn').addEventListener('click', saveServer); function setupCopyButton(buttonId, inputId) { const button = document.getElementById(buttonId); const input = document.getElementById(inputId); if (button && input) { button.addEventListener('click', function() { navigator.clipboard.writeText(input.value).then(() => { const originalIcon = button.innerHTML; button.innerHTML = '<i class="bi bi-check-lg text-success"></i>'; setTimeout(() => { button.innerHTML = originalIcon; }, 2000); }).catch(err => console.error('Failed to copy:', err)); }); } } setupCopyButton('copyApiKeyBtn', 'apiKey'); setupCopyButton('copyServerIdBtn', 'serverIdDisplay'); setupCopyButton('copyWorkerUrlBtn', 'workerUrlDisplay'); document.getElementById('confirmDeleteBtn').addEventListener('click', () => { if (currentServerId) deleteServer(currentServerId); }); document.getElementById('changePasswordBtn').addEventListener('click', showPasswordModal); document.getElementById('savePasswordBtn').addEventListener('click', changePassword); document.getElementById('logoutBtn').addEventListener('click', logout); document.getElementById('addSiteBtn').addEventListener('click', () => showSiteModal()); document.getElementById('saveSiteBtn').addEventListener('click', saveSite); document.getElementById('confirmDeleteSiteBtn').addEventListener('click', () => { if (currentSiteId) deleteSite(currentSiteId); }); document.getElementById('saveTelegramSettingsBtn').addEventListener('click', saveTelegramSettings); }
  async function loadServerList() { try { const response = await fetch('/api/admin/servers', { headers: getAuthHeaders() }); if (!response.ok) throw new Error(getTranslation('loadingServersError')); const data = await response.json(); serverList = data.servers || []; renderServerTable(serverList); } catch (error) { console.error('Error loading server list:', error); showAlert('danger', 'loadingServersError', 'serverAlert'); } }
  function renderServerTable(servers) { const tableBody = document.getElementById('serverTableBody'); tableBody.innerHTML = ''; if (servers.length === 0) { tableBody.innerHTML = \`<tr><td colspan="8" class="text-center">\${getTranslation('noServerDataAdmin')}</td></tr>\`; return; } servers.forEach((server, index) => { const row = document.createElement('tr'); let lastUpdateText = getTranslation('never'); let statusText = getTranslation('unknown'); let statusBadgeClass = 'bg-secondary'; if (server.last_report) { const lastUpdate = new Date(server.last_report * 1000); lastUpdateText = lastUpdate.toLocaleString(currentLanguage === 'zh' ? 'zh-CN' : 'en-US'); const diffMinutes = (Date.now() - lastUpdate.getTime()) / (1000 * 60); if (diffMinutes <= 5) { statusText = getTranslation('online'); statusBadgeClass = 'bg-success'; } else { statusText = getTranslation('offline'); statusBadgeClass = 'bg-danger'; } } row.innerHTML = \`<td><div class="btn-group btn-group-sm"><button class="btn btn-outline-secondary move-server-btn" data-id="\${server.id}" data-direction="up" title="\${getTranslation('serverMovedUp','en').split(' ')[1]}" \${index === 0 ? 'disabled' : ''}><i class="bi bi-arrow-up"></i></button><button class="btn btn-outline-secondary move-server-btn" data-id="\${server.id}" data-direction="down" title="\${getTranslation('serverMovedDown','en').split(' ')[1]}" \${index === servers.length - 1 ? 'disabled' : ''}><i class="bi bi-arrow-down"></i></button></div></td><td><small>\${server.id}</small></td><td>\${server.name}</td><td>\${server.description || '-'}</td><td><button class="btn btn-sm btn-outline-info view-key-btn" data-id="\${server.id}"><i class="bi bi-key-fill"></i> \${getTranslation('viewApiKey')}</button></td><td><span class="badge \${statusBadgeClass}">\${statusText}</span></td><td>\${lastUpdateText}</td><td><div class="btn-group btn-group-sm"><button class="btn btn-outline-primary edit-server-btn" data-id="\${server.id}" title="\${getTranslation('editServerTitle','en')}"><i class="bi bi-pencil-fill"></i></button><button class="btn btn-outline-danger delete-server-btn" data-id="\${server.id}" data-name="\${server.name}" title="\${getTranslation('delete')}"><i class="bi bi-trash-fill"></i></button></div></td>\`; tableBody.appendChild(row); }); attachTableButtonListeners('.view-key-btn', (id) => viewApiKey(id)); attachTableButtonListeners('.edit-server-btn', (id) => editServer(id)); attachTableButtonListeners('.delete-server-btn', (id, name) => showDeleteConfirmation(id, name)); attachTableButtonListeners('.move-server-btn', (id, direction) => moveServer(id, direction), true); }
  function attachTableButtonListeners(selector, callback, passDirection = false) { document.querySelectorAll(selector).forEach(btn => { btn.addEventListener('click', function() { const id = this.getAttribute('data-id'); if (passDirection) { const direction = this.getAttribute('data-direction'); callback(id, direction); } else { const name = this.getAttribute('data-name'); callback(id, name); } }); }); }
  async function moveServer(serverId, direction) { try { const response = await fetch(\`/api/admin/servers/\${serverId}/reorder\`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ direction }) }); if (!response.ok) { const errorData = await response.json().catch(() => ({})); throw new Error(errorData.message || getTranslation('moveServerError')); } await loadServerList(); showAlert('success', direction === 'up' ? 'serverMovedUp' : 'serverMovedDown', 'serverAlert'); } catch (error) { console.error('Error moving server:', error); showAlert('danger', error.message || getTranslation('moveServerError'), 'serverAlert', !error.message); } }
  function showServerModal(serverToEdit = null) { document.getElementById('serverForm').reset(); const modalTitleEl = document.getElementById('serverModalTitle'); const serverIdInput = document.getElementById('serverId'); document.getElementById('apiKeyGroup').classList.add('d-none'); document.getElementById('serverIdDisplayGroup').classList.add('d-none'); document.getElementById('workerUrlDisplayGroup').classList.add('d-none'); if (serverToEdit) { modalTitleEl.setAttribute('data-i18n-key', 'editServerTitle'); serverIdInput.value = serverToEdit.id; document.getElementById('serverName').value = serverToEdit.name; document.getElementById('serverDescription').value = serverToEdit.description || ''; } else { modalTitleEl.setAttribute('data-i18n-key', 'addServerTitle'); serverIdInput.value = ''; } translatePage(); serverModal.show(); }
  function editServer(serverId) { const server = serverList.find(s => s.id === serverId); if (server) showServerModal(server); }
  async function saveServer() { const serverId = document.getElementById('serverId').value; const serverName = document.getElementById('serverName').value.trim(); const serverDescription = document.getElementById('serverDescription').value.trim(); if (!serverName) { showAlert('warning', 'serverNameRequired', 'serverAlert'); return; } const endpoint = serverId ? \`/api/admin/servers/\${serverId}\` : '/api/admin/servers'; const method = serverId ? 'PUT' : 'POST'; try { const response = await fetch(endpoint, { method: method, headers: getAuthHeaders(), body: JSON.stringify({ name: serverName, description: serverDescription }) }); if (!response.ok) { const errorData = await response.json().catch(() => ({})); throw new Error(errorData.message || getTranslation('saveServerError')); } const data = await response.json(); serverModal.hide(); if (!serverId && data.server && data.server.api_key) { showApiKey(data.server); await loadServerList(); } else { await loadServerList(); showAlert('success', serverId ? 'serverUpdatedSuccess' : 'serverAddedSuccess', 'serverAlert'); } } catch (error) { console.error('Error saving server:', error); showAlert('danger', error.message || getTranslation('saveServerError'), 'serverAlert', !error.message); } }
  async function viewApiKey(serverId) { try { const response = await fetch(\`/api/admin/servers/\${serverId}/key\`, { headers: getAuthHeaders() }); if (!response.ok) throw new Error(getTranslation('viewApiKeyError')); const data = await response.json(); const server = serverList.find(s => s.id === serverId); if (server && data.api_key) { showApiKey({ ...server, api_key: data.api_key }); } else { showAlert('warning', 'noServerInfoFound', 'serverAlert'); } } catch (error) { console.error('Error viewing API key:', error); showAlert('danger', error.message || getTranslation('viewApiKeyError'), 'serverAlert', !error.message); } }
  function showApiKey(server) { document.getElementById('serverForm').reset(); document.getElementById('serverModalTitle').setAttribute('data-i18n-key', 'serverInfoAndKeyTitle'); translatePage(); document.getElementById('serverId').value = server.id; document.getElementById('serverName').value = server.name; document.getElementById('serverName').readOnly = true; document.getElementById('serverDescription').value = server.description || ''; document.getElementById('serverDescription').readOnly = true; document.getElementById('apiKey').value = server.api_key; document.getElementById('apiKeyGroup').classList.remove('d-none'); document.getElementById('serverIdDisplay').value = server.id; document.getElementById('serverIdDisplayGroup').classList.remove('d-none'); document.getElementById('workerUrlDisplay').value = window.location.origin; document.getElementById('workerUrlDisplayGroup').classList.remove('d-none'); document.getElementById('saveServerBtn').classList.add('d-none'); serverModal.show(); const modalElement = document.getElementById('serverModal'); modalElement.addEventListener('hidden.bs.modal', () => { document.getElementById('serverName').readOnly = false; document.getElementById('serverDescription').readOnly = false; document.getElementById('saveServerBtn').classList.remove('d-none'); }, { once: true }); }
  function showDeleteConfirmation(serverId, serverName) { currentServerId = serverId; document.getElementById('deleteServerName').textContent = serverName; deleteModal.show(); }
  async function deleteServer(serverId) { try { const response = await fetch(\`/api/admin/servers/\${serverId}\`, { method: 'DELETE', headers: getAuthHeaders() }); if (!response.ok) throw new Error(getTranslation('deleteServerError')); deleteModal.hide(); await loadServerList(); showAlert('success', 'serverDeleteSuccess', 'serverAlert'); } catch (error) { console.error('Error deleting server:', error); showAlert('danger', error.message || getTranslation('deleteServerError'), 'serverAlert', !error.message); } }
  async function loadSiteList() { try { const response = await fetch('/api/admin/sites', { headers: getAuthHeaders() }); if (!response.ok) throw new Error(getTranslation('loadingSitesError')); const data = await response.json(); siteList = data.sites || []; renderSiteTable(siteList); } catch (error) { console.error('Error loading site list:', error); showAlert('danger', 'loadingSitesError', 'siteAlert'); } }
  function renderSiteTable(sites) { const tableBody = document.getElementById('siteTableBody'); tableBody.innerHTML = ''; if (sites.length === 0) { tableBody.innerHTML = \`<tr><td colspan="8" class="text-center">\${getTranslation('noSiteDataAdmin')}</td></tr>\`; return; } sites.forEach((site, index) => { const row = document.createElement('tr'); const statusInfo = getSiteStatusAdminBadge(site.last_status); const lastCheckTime = site.last_checked ? new Date(site.last_checked * 1000).toLocaleString(currentLanguage === 'zh' ? 'zh-CN' : 'en-US') : getTranslation('never'); const responseTime = site.last_response_time_ms !== null ? \`\${site.last_response_time_ms} ms\` : '-'; row.innerHTML = \`<td><div class="btn-group btn-group-sm"><button class="btn btn-outline-secondary move-site-btn" data-id="\${site.id}" data-direction="up" title="\${getTranslation('siteMovedUp','en').split(' ')[1]}" \${index === 0 ? 'disabled' : ''}><i class="bi bi-arrow-up"></i></button><button class="btn btn-outline-secondary move-site-btn" data-id="\${site.id}" data-direction="down" title="\${getTranslation('siteMovedDown','en').split(' ')[1]}" \${index === sites.length - 1 ? 'disabled' : ''}><i class="bi bi-arrow-down"></i></button></div></td><td>\${site.name || '-'}</td><td><a href="\${site.url}" target="_blank" rel="noopener noreferrer">\${site.url}</a></td><td><span class="badge \${statusInfo.class}">\${statusInfo.text}</span></td><td>\${site.last_status_code || '-'}</td><td>\${responseTime}</td><td>\${lastCheckTime}</td><td><div class="btn-group btn-group-sm"><button class="btn btn-outline-primary edit-site-btn" data-id="\${site.id}" title="\${getTranslation('editSiteTitle','en')}"><i class="bi bi-pencil-fill"></i></button><button class="btn btn-outline-danger delete-site-btn" data-id="\${site.id}" data-name="\${site.name || site.url}" data-url="\${site.url}" title="\${getTranslation('delete')}"><i class="bi bi-trash-fill"></i></button></div></td>\`; tableBody.appendChild(row); }); attachSiteButtonListeners('.edit-site-btn', (id) => editSite(id)); attachSiteButtonListeners('.delete-site-btn', (id, name, url) => showDeleteSiteConfirmation(id, name, url), true); attachSiteButtonListeners('.move-site-btn', (id, direction) => moveSite(id, direction), true); }
  function attachSiteButtonListeners(selector, callback, passDirectionOrUrl = false) { document.querySelectorAll(selector).forEach(btn => { btn.addEventListener('click', function() { const id = this.getAttribute('data-id'); if (passDirectionOrUrl && this.classList.contains('move-site-btn')) { const direction = this.getAttribute('data-direction'); callback(id, direction); } else if (passDirectionOrUrl && this.classList.contains('delete-site-btn')) { const name = this.getAttribute('data-name'); const url = this.getAttribute('data-url'); callback(id, name, url); } else { callback(id); } }); }); }
  async function moveSite(siteId, direction) { try { const response = await fetch(\`/api/admin/sites/\${siteId}/reorder\`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ direction }) }); if (!response.ok) { const errorData = await response.json().catch(() => ({})); throw new Error(errorData.message || getTranslation('moveSiteError')); } await loadSiteList(); showAlert('success', direction === 'up' ? 'siteMovedUp' : 'siteMovedDown', 'siteAlert'); } catch (error) { console.error('Error moving site:', error); showAlert('danger', error.message || getTranslation('moveSiteError'), 'siteAlert', !error.message); } }
  function getSiteStatusAdminBadge(status) { return getSiteStatusBadge(status); }
  function showSiteModal(siteIdToEdit = null) { document.getElementById('siteForm').reset(); const modalTitleEl = document.getElementById('siteModalTitle'); const siteIdInput = document.getElementById('siteId'); if (siteIdToEdit) { const site = siteList.find(s => s.id === siteIdToEdit); if (site) { modalTitleEl.setAttribute('data-i18n-key', 'editSiteTitle'); siteIdInput.value = site.id; document.getElementById('siteName').value = site.name || ''; document.getElementById('siteUrl').value = site.url; } else { showAlert('danger', 'editSiteNotFound', 'siteAlert'); return; } } else { modalTitleEl.setAttribute('data-i18n-key', 'addSiteTitle'); siteIdInput.value = ''; } translatePage(); siteModal.show(); }
  function editSite(siteId) { showSiteModal(siteId); }
  async function saveSite() { const siteId = document.getElementById('siteId').value; const siteName = document.getElementById('siteName').value.trim(); const siteUrl = document.getElementById('siteUrl').value.trim(); if (!siteUrl) { showAlert('warning', 'urlRequired', 'siteAlert'); return; } if (!siteUrl.startsWith('http://') && !siteUrl.startsWith('https://')) { showAlert('warning', 'urlFormatError', 'siteAlert'); return; } const endpoint = siteId ? \`/api/admin/sites/\${siteId}\` : '/api/admin/sites'; const method = siteId ? 'PUT' : 'POST'; try { const response = await fetch(endpoint, { method: method, headers: getAuthHeaders(), body: JSON.stringify({ url: siteUrl, name: siteName }) }); if (!response.ok) { const errorData = await response.json().catch(() => ({})); throw new Error(errorData.message || getTranslation('saveSiteError')); } siteModal.hide(); await loadSiteList(); showAlert('success', siteId ? 'siteUpdatedSuccess' : 'siteAddedSuccess', 'siteAlert'); } catch (error) { console.error('Error saving site:', error); showAlert('danger', error.message || getTranslation('saveSiteError'), 'siteAlert', !error.message); } }
  function showDeleteSiteConfirmation(siteId, siteName, siteUrl) { currentSiteId = siteId; document.getElementById('deleteSiteName').textContent = siteName; document.getElementById('deleteSiteUrl').textContent = siteUrl; deleteSiteModal.show(); }
  async function deleteSite(siteId) { try { const response = await fetch(\`/api/admin/sites/\${siteId}\`, { method: 'DELETE', headers: getAuthHeaders() }); if (!response.ok) { const errorData = await response.json().catch(() => ({})); throw new Error(errorData.message || getTranslation('deleteSiteError')); } deleteSiteModal.hide(); await loadSiteList(); showAlert('success', 'siteDeleteSuccess', 'siteAlert'); currentSiteId = null; } catch (error) { console.error('Error deleting site:', error); showAlert('danger', error.message || getTranslation('deleteSiteError'), 'siteAlert', !error.message); } }
  function showPasswordModal() { document.getElementById('passwordForm').reset(); document.getElementById('passwordAlert').innerHTML = ''; document.getElementById('passwordAlert').classList.add('d-none'); passwordModal.show(); }
  async function changePassword() { const currentPassword = document.getElementById('currentPassword').value; const newPassword = document.getElementById('newPassword').value; const confirmPassword = document.getElementById('confirmPassword').value; const passwordAlertEl = document.getElementById('passwordAlert'); function displayPasswordAlert(type, messageKey) { passwordAlertEl.textContent = getTranslation(messageKey); passwordAlertEl.className = \`alert alert-\${type}\`; passwordAlertEl.classList.remove('d-none'); } if (!currentPassword || !newPassword || !confirmPassword) { displayPasswordAlert('warning', 'allPasswordFieldsRequired'); return; } if (newPassword !== confirmPassword) { displayPasswordAlert('warning', 'passwordsMismatch'); return; } try { const response = await fetch('/api/auth/change-password', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) }); if (response.ok) { passwordModal.hide(); showAlert('success', 'passwordChangeSuccess', 'serverAlert'); } else { const data = await response.json(); displayPasswordAlert('danger', data.message || 'passwordChangeError'); } } catch (error) { console.error('Error changing password:', error); displayPasswordAlert('danger', 'passwordChangeError'); } }
  function logout() { localStorage.removeItem('auth_token'); window.location.href = 'login.html'; }
  async function loadTelegramSettings() { try { const response = await fetch('/api/admin/telegram-settings', { headers: getAuthHeaders() }); if (!response.ok) throw new Error(getTranslation('telegramSettingsLoadedError')); const settings = await response.json(); if (settings) { document.getElementById('telegramBotToken').value = settings.bot_token || ''; document.getElementById('telegramChatId').value = settings.chat_id || ''; document.getElementById('enableTelegramNotifications').checked = !!settings.enable_notifications; } } catch (error) { console.error('Error loading Telegram settings:', error); showAlert('danger', 'telegramSettingsLoadedError', 'telegramSettingsAlert'); } }
  async function saveTelegramSettings() { const botToken = document.getElementById('telegramBotToken').value.trim(); const chatId = document.getElementById('telegramChatId').value.trim(); let enableNotifications = document.getElementById('enableTelegramNotifications').checked; if (enableNotifications && (!botToken || !chatId)) { showAlert('warning', 'telegramTokenChatIdRequired', 'telegramSettingsAlert'); document.getElementById('enableTelegramNotifications').checked = false; enableNotifications = false; } try { const response = await fetch('/api/admin/telegram-settings', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ bot_token: botToken, chat_id: chatId, enable_notifications: enableNotifications }) }); if (!response.ok) { const errorData = await response.json().catch(() => ({})); throw new Error(errorData.message || getTranslation('telegramSettingsSaveError')); } showAlert('success', 'telegramSettingsSavedSuccess', 'telegramSettingsAlert'); } catch (error) { console.error('Error saving Telegram settings:', error); showAlert('danger', error.message || getTranslation('telegramSettingsSaveError'), 'telegramSettingsAlert', !error.message); } }
  function getSiteStatusBadge(status) { switch (status) { case 'UP': return { class: 'bg-success', text: getTranslation('siteStatusUp') }; case 'DOWN': return { class: 'bg-danger', text: getTranslation('siteStatusDown') }; case 'TIMEOUT': return { class: 'bg-warning text-dark', text: getTranslation('siteStatusTimeout') }; case 'ERROR': return { class: 'bg-danger', text: getTranslation('siteStatusError') }; case 'PENDING': return { class: 'bg-secondary', text: getTranslation('siteStatusPending') }; default: return { class: 'bg-secondary', text: getTranslation('unknown') }; } }
  `;}