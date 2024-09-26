const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({
    server // why do i set it to the http server? good question, but as a random user on stackoverflow said, "it helps fix weird errors"
});

const PORT = process.env.PORT || 80;

// am so pro
const chatRooms = new Map();
const ipMappings = new Map();

// this shit took em way too long :sob:
function getClientIp(req) {
    return req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

wss.on('connection', (ws, req) => {
    const ip = getClientIp(req); // get IP from req during connection

    ws.req = req; // we do NOT need this :sob:
    let roomId = null;
    let userName = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'create') {
                if (ipMappings.has(ip)) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'ladies, ladies, one at a time'
                    }));
                    return;
                }
                roomId = crypto.randomBytes(16).toString('hex')();
                chatRooms.set(roomId, {
                    users: new Map(),
                    messages: [],
                    lastActivity: Date.now(),
                    timeoutId: setTimeout(() => chatRooms.delete(roomId), 30000)
                });
                ipMappings.set(ip, roomId);
                ws.send(JSON.stringify({
                    type: 'roomCreated',
                    roomId
                }));
            } else if (data.type === 'join') {
                roomId = data.roomId;
                userName = data.userName;

                if (!chatRooms.has(roomId)) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'where da fuq is that room id!??!'
                    }));
                    return;
                }

                const room = chatRooms.get(roomId);
                clearTimeout(room.timeoutId);
                room.lastActivity = Date.now();

                if (room.users.has(ip)) {
                    userName = room.users.get(ip);
                } else {
                    room.users.set(ip, userName);
                }

                ws.send(JSON.stringify({
                    type: 'joined',
                    userName,
                    messages: room.messages
                }));
            } else if (data.type === 'message' && roomId) {
                const room = chatRooms.get(roomId);
                if (room && room.users.has(ip)) {
                    const timestamp = Date.now();
                    if (room.messages.length > 0 && timestamp - room.messages[room.messages.length - 1].timestamp < 1000) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'fuck u 429 bahahaha'
                        }));
                        return;
                    }

                    room.messages.push({
                        userName,
                        content: data.content,
                        timestamp
                    });
                    room.lastActivity = timestamp;
                    room.users.forEach((_, userIp) => {
                        wss.clients.forEach((client) => {
                            if (client.readyState === WebSocket.OPEN && getClientIp(client.req) === userIp) {
                                client.send(JSON.stringify({
                                    type: 'message',
                                    userName,
                                    content: data.content
                                }));
                            }
                        });
                    });
                }
            }
        } catch (error) {
            console.error(error);
        }
    });

    ws.on('close', () => {
        if (roomId) {
            const room = chatRooms.get(roomId);
            if (room) {
                room.users.delete(ip);
                if (room.users.size === 0) {
                    room.timeoutId = setTimeout(() => chatRooms.delete(roomId), 30000);
                }
            }
            ipMappings.delete(ip);
        }
    });
});

server.listen(PORT, () => {
    console.log(`asschat running http://localhost:${PORT}`);
});