const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 80;

const chatRooms = new Map();
const userIPs = new Map();
const debug = false

function getClientIp(req) {
    if (debug) return crypto.randomBytes(4).toString('hex')
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, debug ? 'index.html' : 'index2.html'));
});

wss.on('connection', (ws, req) => {
    const ip = getClientIp(req);
    let roomId = null;
    let userName = null;

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'create':
                if (userIPs.has(ip)) {
                    ws.send(JSON.stringify({ type: 'error', message: 'ladies, ladies, one room at a time' }));
                    return;
                }
                roomId = crypto.randomBytes(16).toString("hex");
                chatRooms.set(roomId, { 
                    users: new Map(), 
                    messages: [], 
                    sharedKey: crypto.randomBytes(169).toString(), 
                    creator: ip,
                    name: `AssChat - ${roomId.substr(0, 6)}`,
                    timeout: null
                });
                userIPs.set(ip, roomId);
                ws.send(JSON.stringify({ type: 'roomCreated', roomId }));
                break;

            case 'join':
                roomId = data.roomId;
                userName = data.userName;

                if (!chatRooms.has(roomId)) {
                    return ws.send(JSON.stringify({ type: 'error', message: 'room not found' }));
                }

                const room = chatRooms.get(roomId);
                room.users.set(ip, { userName, ws });

                ws.send(JSON.stringify({
                    type: 'joined',
                    userName,
                    messages: room.messages,
                    sharedKey: room.sharedKey,
                    users: Array.from(room.users.values()).map(u => u.userName)
                }));

                room.users.forEach((user) => {
                    if (user.ws !== ws && user.ws.readyState === WebSocket.OPEN) {
                        user.ws.send(JSON.stringify({ 
                            type: 'userJoined', 
                            users: Array.from(room.users.values()).map(u => u.userName)
                        }));
                    }
                });
                break;

            case 'message':
                if (roomId && chatRooms.has(roomId)) {
                    const room = chatRooms.get(roomId);
                    const timestamp = new Date().toISOString();
                    const message = { userName, content: data.content, timestamp };
                    room.messages.push(message);

                    room.users.forEach((user) => {
                        if (user.ws.readyState === WebSocket.OPEN) {
                            user.ws.send(JSON.stringify({ type: 'message', ...message }));
                        }
                    });
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
                chatRooms.delete(roomId);
                userIPs.delete(ip);
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
