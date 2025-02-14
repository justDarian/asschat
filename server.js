const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// DEBUG MODE
const debug = false

const PORT = process.env.PORT || 80;
// limit rules
const MAX_LEN = { USER: 20, MSG: 2000 };
const RATE = { PER_USER: 7, WINDOW: 1000 };
// data store
const chatRooms = new Map();
const userIPs = new Map();

function getClientIp(req) {
    if (debug) return crypto.randomBytes(4).toString('hex')
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
}

app.use(express.static(path.join(__dirname, '/public/'), {
    extensions: ['html'],
    setHeaders: (res, path) => {
        res.setHeader('Cache-Control', `public, max-age=${60 * 10}`) 
    }
}))

wss.on('connection', (ws, req) => {
    const ip = getClientIp(req);
    let roomId = null;
    let userName = null;

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message)
        } catch {return}

        switch (data.type) {
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong'}));
                break
            case 'create':
                if (userIPs.get(ip) >= 2) {
                    ws.send(JSON.stringify({ type: 'error', message: 'ladies, ladies, one room at a time' }));
                    return;
                }
                roomId = crypto.randomBytes(12).toString("hex");
                chatRooms.set(roomId, { 
                    users: new Map(), 
                    messages: [], 
                    creator: ip,
                    name: `AssChat Room`,
                    timeout: null,
                    userMsgs: new Map(),
                    handshake: null
                });
                userIPs.set(ip, roomId);
                ws.send(JSON.stringify({ type: 'roomCreated', roomId }));
                break;

            case 'handshake':
                if (roomId && chatRooms.has(roomId) && chatRooms.get(roomId).creator === ip) {
                    const room = chatRooms.get(roomId);
                    room.handshake = data.content;
                }
                break;

            case 'join':
                roomId = data.roomId;
                userName = data.userName.substring(0, MAX_LEN.USER);

                if (!chatRooms.has(roomId)) {
                    return ws.send(JSON.stringify({ type: 'error', message: 'room not found' }));
                }

                const room = chatRooms.get(roomId);

                // check username if taken
                for (const [userIp, user] of room.users.entries()) {
                    if (user.userName === userName && userIp !== ip) {
                        return ws.send(JSON.stringify({ type: 'error', message: 'username already taken' }));
                    }
                }

                // anti spam muahahah
                if (room.users.has(ip)) {
                    return ws.send(JSON.stringify({ type: 'error', message: 'already joined this room' }));
                }

                if (room.deletionTimeout) {
                    clearTimeout(room.deletionTimeout);
                    room.deletionTimeout = null;
                }
                room.users.set(ip, { userName, ws });

                ws.send(JSON.stringify({
                    type: 'joined',
                    userName,
                    messages: room.messages,
                    users: Array.from(room.users.values()).map(u => u.userName),
                    isCreator: room.creator === ip
                }));

                if (room.handshake) {
                    ws.send(JSON.stringify({
                        type: 'handshake',
                        content: room.handshake
                    }));
                }

                room.users.forEach((user) => {
                    if (user.ws !== ws && user.ws.readyState === WebSocket.OPEN) {
                        user.ws.send(JSON.stringify({ 
                            type: 'userJoined', 
                            users: Array.from(room.users.values()).map(u => u.userName)
                        }));
                    }
                });

                ws.send(JSON.stringify({ type: 'roomRenamed', newName: room.name }));
                break;

            case 'message':
                if (roomId && chatRooms.has(roomId)) {
                    // check length of message so its not *too* big
                    if (data.content.length > MAX_LEN.MSG) {
                        return  ws.send(JSON.stringify({ type: 'error', message: 'message too long' }));
                    }

                    const room = chatRooms.get(roomId);
                    const now = Date.now();
                    
                    room.userMsgs = room.userMsgs || new Map();
                    const userMsgs = room.userMsgs.get(ip) || [];
                    const recentMsgs = userMsgs.filter(t => now - t < RATE.WINDOW);
            
                    if (recentMsgs.length >= RATE.PER_USER) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }));
                        return;
                    }
                    recentMsgs.push(now);
                    room.userMsgs.set(ip, recentMsgs);

                    const msg = { 
                        userName, 
                        content: data.content, 
                        timestamp: new Date().toISOString() 
                    };
                    room.messages.push(msg);
            
                    room.users.forEach(u => u.ws.readyState === WebSocket.OPEN && 
                        u.ws.send(JSON.stringify({ type: 'message', ...msg })));
                }
                break;

            case 'renameRoom':
                if (roomId && chatRooms.has(roomId) && chatRooms.get(roomId).creator === ip) {
                    const room = chatRooms.get(roomId);
                    room.name = "AssChat - " + data.newName;
                    room.users.forEach((user) => {
                        if (user.ws.readyState === WebSocket.OPEN) {
                            user.ws.send(JSON.stringify({ type: 'roomRenamed', newName: room.name }));
                        }
                    });
                }
                break;

            case 'closeRoom':
                if (roomId && chatRooms.has(roomId) && chatRooms.get(roomId).creator === ip) {
                    const room = chatRooms.get(roomId);
                    room.users.forEach((user) => {
                        if (user.ws.readyState === WebSocket.OPEN) {
                            user.ws.send(JSON.stringify({ type: 'roomClosed' }));
                            user.ws.close();
                        }
                    });
                    chatRooms.delete(roomId);
                    userIPs.delete(ip);
                }
                break;

            case 'setTimeout':
                if (roomId && chatRooms.has(roomId) && chatRooms.get(roomId).creator === ip) {
                    const room = chatRooms.get(roomId);
                    const timeout = parseInt(data.timeout) * 60 * 1000;
                    if (room.timeout) clearTimeout(room.timeout);
                    room.timeout = setTimeout(() => {
                        room.users.forEach((user) => {
                            if (user.ws.readyState === WebSocket.OPEN) {
                                user.ws.send(JSON.stringify({ type: 'roomClosed' }));
                                user.ws.close();
                            }
                        });
                        chatRooms.delete(roomId);
                        userIPs.delete(ip);
                    }, timeout);
                }
                break;
        }
    });

    ws.on('close', () => {
        if (roomId && chatRooms.has(roomId)) {
            const room = chatRooms.get(roomId);
            room.users.delete(ip);
            if (room.users.size === 0) {
                if (room.timeout) clearTimeout(room.timeout);
                room.deletionTimeout = setTimeout(() => {
                    chatRooms.delete(roomId);
                    userIPs.delete(ip);
                }, 10000);
            } else {
                room.users.forEach((user) => {
                    if (user.ws.readyState === WebSocket.OPEN) {
                        user.ws.send(JSON.stringify({ 
                            type: 'userLeft', 
                            users: Array.from(room.users.values()).map(u => u.userName)
                        }));
                    }
                });
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`ass on port ${PORT}`);
});
