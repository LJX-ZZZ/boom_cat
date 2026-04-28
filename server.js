// ============================================================
//  炸弹猫 - 联机服务器（支持局域网 & 云部署）
//  用法: node server.js [--port 8080]
//  环境变量: PORT（云平台自动设置）
// ============================================================
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const PORT = parseInt(process.env.PORT) || parseInt(args[args.indexOf('--port') + 1]) || 8080;

// ---- HTTP 静态文件 ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  // CORS 支持（允许前端页面跨域连接）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 默认提供 bomb-cat.html
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/' || urlPath === '/index.html') urlPath = '/bomb-cat.html';

  const filePath = path.join(__dirname, urlPath);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---- WebSocket ----
const wss = new WebSocket.Server({ server });

// 房间管理
const rooms = new Map(); // roomCode -> { hostWs, clients: Map<playerId, ws>, settings, playerNames: Map<id, {name,emoji,imageUrl}> }

const genCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
};

const send = (ws, msg) => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

const broadcastRoom = (room, msg, excludeWs) => {
  const data = JSON.stringify(msg);
  // 发给房主
  if (room.hostWs !== excludeWs) send(room.hostWs, data);
  // 发给所有客户端
  room.clients.forEach((ws) => {
    if (ws !== excludeWs) {
      try { ws.send(data); } catch(e) {}
    }
  });
};

// 获取房间内所有 WebSocket
const allWs = (room) => {
  const result = [room.hostWs];
  room.clients.forEach(ws => result.push(ws));
  return result.filter(ws => ws && ws.readyState === WebSocket.OPEN);
};

wss.on('connection', (ws) => {
  let roomCode = null;
  let playerId = -1;
  let isHost = false;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch(e) { return; }

    switch (msg.type) {

      // ---- 创建房间 ----
      case 'create_room': {
        const code = genCode();
        const settings = msg.settings || { playerCount: 4 };
        rooms.set(code, {
          hostWs: ws,
          clients: new Map(),
          settings,
          playerNames: new Map([[0, { name: msg.myName || '房主', emoji: msg.myEmoji || '😸', imageUrl: msg.myImageUrl || null }]]),
        });
        roomCode = code;
        playerId = 0;
        isHost = true;

        // 获取本机IP用于提示
        const ips = Object.values(require('os').networkInterfaces())
          .flat().filter(i => !i.internal && i.family === 'IPv4').map(i => i.address);
        send(ws, { type: 'room_created', roomCode: code, playerId: 0, localIPs: ips, port: PORT });
        console.log(`[房间 ${code}] 房主创建 (期望${settings.playerCount}人)`);
        break;
      }

      // ---- 加入房间 ----
      case 'join_room': {
        const code = (msg.roomCode || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) { send(ws, { type: 'error', message: '房间不存在' }); return; }

        // 分配 playerId（从1开始）
        let newId = 1;
        while (room.playerNames.has(newId)) newId++;

        if (newId >= room.settings.playerCount) {
          send(ws, { type: 'error', message: '房间已满' });
          return;
        }

        roomCode = code;
        playerId = newId;
        room.clients.set(newId, ws);
        room.playerNames.set(newId, {
          name: msg.myName || `玩家${newId}`,
          emoji: msg.myEmoji || '😸',
          imageUrl: msg.myImageUrl || null,
        });

        // 通知房主有新人加入
        send(room.hostWs, {
          type: 'player_joined',
          playerId: newId,
          playerInfo: room.playerNames.get(newId),
          currentCount: room.playerNames.size,
          maxCount: room.settings.playerCount,
        });

        // 通知新人加入成功
        send(ws, {
          type: 'room_joined',
          roomCode: code,
          playerId: newId,
          playerNames: Object.fromEntries(room.playerNames),
          currentCount: room.playerNames.size,
          maxCount: room.settings.playerCount,
        });

        console.log(`[房间 ${code}] 玩家${newId} 加入 (${room.playerNames.size}/${room.settings.playerCount})`);
        break;
      }

      // ---- 房主开始游戏 ----
      case 'start_game': {
        const room = rooms.get(roomCode);
        if (!room || !isHost) return;
        broadcastRoom(room, {
          type: 'game_starting',
          playerCount: room.playerNames.size,
          playerNames: Object.fromEntries(room.playerNames),
        });
        console.log(`[房间 ${code}] 游戏开始 (${room.playerNames.size}人)`);
        break;
      }

      // ---- 房主广播游戏状态 ----
      case 'game_state': {
        const room = rooms.get(roomCode);
        if (!room || !isHost) return;
        // 房主可能为每个玩家发送不同的状态（手牌隐私）
        if (msg.perPlayer) {
          // msg.perPlayer: { playerId: stateData }
          for (const [pid, stateData] of Object.entries(msg.perPlayer)) {
            const clientWs = pid == 0 ? room.hostWs : room.clients.get(parseInt(pid));
            if (clientWs) send(clientWs, { type: 'game_state', state: stateData });
          }
        } else {
          // 广播相同状态
          broadcastRoom(room, { type: 'game_state', state: msg.state });
        }
        break;
      }

      // ---- 客户端发送动作给房主 ----
      case 'player_action': {
        const room = rooms.get(roomCode);
        if (!room || isHost) return;
        send(room.hostWs, {
          type: 'player_action',
          playerId,
          action: msg.action,
          data: msg.data,
        });
        break;
      }

      // ---- 聊天 ----
      case 'chat': {
        const room = rooms.get(roomCode);
        if (!room) return;
        broadcastRoom(room, {
          type: 'chat',
          playerId,
          playerName: room.playerNames.get(playerId)?.name || `玩家${playerId}`,
          message: msg.message,
        });
        break;
      }

      // ---- 请求完整状态（重连/刚加入时）----
      case 'request_full_state': {
        const room = rooms.get(roomCode);
        if (!room || !isHost) return;
        // 转发给房主处理
        send(room.hostWs, { type: 'request_full_state', requestingPlayerId: playerId });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    if (isHost) {
      // 房主离开：通知所有人并关闭房间
      broadcastRoom(room, { type: 'host_left' });
      rooms.delete(roomCode);
      console.log(`[房间 ${roomCode}] 房主离开，房间关闭`);
    } else {
      // 客户端离开
      room.clients.delete(playerId);
      room.playerNames.delete(playerId);
      send(room.hostWs, {
        type: 'player_left',
        playerId,
        currentCount: room.playerNames.size,
      });
      broadcastRoom(room, { type: 'player_left_broadcast', playerId }, room.hostWs);
      console.log(`[房间 ${roomCode}] 玩家${playerId} 离开 (剩余${room.playerNames.size})`);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const ips = Object.values(os.networkInterfaces())
    .flat().filter(i => !i.internal && i.family === 'IPv4').map(i => i.address);

  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║     💣 炸弹猫 - 局域网联机服务器    ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log(`  本机访问: http://localhost:${PORT}`);
  ips.forEach(ip => {
    console.log(`  局域网:   http://${ip}:${PORT}`);
  });
  console.log('');
  console.log('  其他玩家在浏览器中打开局域网地址即可加入');
  console.log('  按 Ctrl+C 停止服务器');
  console.log('');
});
