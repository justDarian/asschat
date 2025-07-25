// global variables
let socket, roomId, userName, sharedKey, owner, ping, connecting, notificationSound = null
let attempts = 0
const users = new Map();


// dom elements
const joinContainer = document.getElementById('join-container');
const chatContainer = document.getElementById('chat-container');
const createRoomBtn = document.getElementById('create-room-btn');
const sendBtn = document.getElementById('send-btn');
const usernameInput = document.getElementById('username-input');
const messageInput = document.getElementById('message-input');
const chatMessages = document.getElementById('chat-messages');
const userList = document.getElementById('user-list');
const toastContainer = document.getElementById('toast-container');
const inviteBtn = document.getElementById('invite-btn');
const inviteModal = document.getElementById('invite-modal');
const inviteModalContent = document.getElementById('invite-modal-content');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsModal = document.getElementById('close-settings-modal');

// xss remover thing credits to someone on stackoverflow
function escape(input) {
    if (typeof input !== 'string') input = String(input);
    return input
        .replace(/<[^>]*>/gi, 'HTML NOT ALLOWED')
        .replace(/\b(href|src|style)\s*=\s*(['"]?)\s*(?:javascript|data|vbscript):/gi, 'XSS PREVENTED')
        .replace(/javascript:/gi, '')
        .replace(/[\[\]\(\)]/g, '');
}


// event listeners
createRoomBtn.addEventListener('click', createRoom);
sendBtn.addEventListener('click', sendMessage);
inviteBtn.addEventListener('click', showInviteModal);
settingsBtn.addEventListener('click', showSettingsModal);
closeSettingsModal.addEventListener('click', closeSettingsModalHandler);
messageInput.addEventListener('keydown', handleMessageInputKeydown);
messageInput.addEventListener('input', autoResizeInput);
document.getElementById('rename-room-btn').addEventListener('click', renameRoom);
document.getElementById('set-timeout-btn').addEventListener('click', setRoomTimeout);
document.getElementById('close-room-btn').addEventListener('click', closeRoom);

// encryption functions
function encryptMessage(message, sharedKey, roomId) {
    const salt = CryptoJS.lib.WordArray.random(4).toString();
    const iv = CryptoJS.lib.WordArray.random(4).toString();

    const compositeKey = CryptoJS.SHA256(sharedKey + roomId).toString();
    const combinedKey = CryptoJS.PBKDF2(compositeKey, salt, {
        keySize: 256 / 32,
        iterations: 1000
    });
    const encrypted = CryptoJS.AES.encrypt(message, combinedKey, {
        iv: CryptoJS.enc.Utf8.parse(iv)
    });

    const finalData = salt + iv + encrypted.toString();
    return "ASSCRYPT_" + CryptoJS.enc.Utf16.stringify(CryptoJS.enc.Utf8.parse(finalData));
}

function decryptMessage(ciphertext, sharedKey, roomId) {
    // remove "ASSCRYPT_"
    ciphertext = ciphertext.slice(9)
    // fix utf16
    ciphertext = CryptoJS.enc.Utf16.parse(ciphertext).toString(CryptoJS.enc.Utf8);

    try {
        const salt = ciphertext.substr(0, 8);
        const iv = ciphertext.substr(8, 8);
        const encrypted = ciphertext.substr(16);

        const compositeKey = CryptoJS.SHA256(sharedKey + roomId).toString();
        const combinedKey = CryptoJS.PBKDF2(compositeKey, salt, {
            keySize: 256 / 32,
            iterations: 1000
        });
        const decrypted = CryptoJS.AES.decrypt(encrypted, combinedKey, {
            iv: CryptoJS.enc.Utf8.parse(iv)
        });

        try {
            // why the fuck does this not work (sometimes)
            //console.log(decrypted)
            return decrypted.toString(CryptoJS.enc.Utf8);
        } catch {
            console.log("some shit happened, using this stupid ass latin1 stupid ass stupid ass method");
            // why the fuck does this work (most times)
            return decrypted.toString(CryptoJS.enc.Latin1);
        }
    } catch (error) {
        console.log(error);
        return "ASSCRYPT ERROR CHECK CONSOLE";
    }
}

// WebSocket functions
function connectWebSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        return true;
    }

    if (connecting) {
        return new Promise((resolve) => {
            const check = setInterval(() => {
                if (socket && socket.readyState === WebSocket.OPEN) {
                    clearInterval(check);
                    resolve(true);
                }
            }, 100);
        });
    }

    connecting = true;

    return new Promise((resolve, reject) => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(`${protocol}//${window.location.host}`);

        socket.onopen = () => {
            console.log('connected to AssChat server');
            popnotif('connected to AssChat server', 'success');
            setupSocketHandlers();
            connecting = false;
            resolve(true);
        };

        socket.onerror = (error) => {
            console.error(error);
            connecting = false;
            reject(error);
        };

        socket.onclose = () => {
            connecting = false;
            if (attempts > 4) {
                popnotif('Failed to connect to AssChat server', 'error');
                return setTimeout(() => {
                    location.href = "/";
                }, 3000);
            }
            popnotif('Connection to server closed, attempting to reconnect', 'error');
            attempts++;
            setTimeout(() => {
                connectWebSocket();
            }, 1000);
        };

        // pinger
        setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    type: 'ping'
                }));
                ping = Date.now();
            }
        }, 1000 * 20);
    });
}

function setupSocketHandlers() {
    // cutesey welcome
    let meow = new Date()
    meow.setHours(4, 20, 0, 0)
    showmsg("System", "Welcome to AssChat! All of your messages are encrypted and this conversation is fully secure.", meow);

    // set onmessage to the socket handlers
    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        switch (data.type) {
            case 'pong':
                console.log(`ping: ${Date.now() - ping}ms`);
                ping = null
                break;
            case 'roomCreated':
                owner = true;
                roomId = data.roomId;
                socket.send(JSON.stringify({
                    type: 'join',
                    userName,
                    roomId
                }));
                window.history.pushState(null, '', `/?room=${roomId}&key=${encodeURIComponent(sharedKey)}`);
                // emit a handshake packet to verify the key/room for other users!?
                socket.send(JSON.stringify({
                    type: 'handshake',
                    content: encryptMessage(roomId, sharedKey, roomId)
                }));
                break;
            case 'handshake':
                // verify the key/room with the handshake message
                if (decryptMessage(data.content, sharedKey, roomId) !== roomId) {
                    popnotif('Incorrect key', 'error');
                    setTimeout(() => {
                        location.href = "/";
                    }, 1500);
                }
                break;
            case 'joined':
                joinContainer.style.display = 'none';
                chatContainer.style.display = 'block';
                updateUserList(data.users);
                data.messages.forEach(msg => showmsg(msg.userName, decryptMessage(msg.content, sharedKey, roomId), new Date(msg.timestamp)));

                owner = data.isCreator;
                settingsBtn.style.display = owner ? 'inline-block' : 'none';
                break;
            case 'message':
                showmsg(data.userName, decryptMessage(data.content, sharedKey, roomId), new Date(data.timestamp));

                // really cool notification sound
                if (data.userName !== userName && !document.hasFocus()) {
                    notificationSound.currentTime = 0 // reset
                    notificationSound.play()
                }
                break;
            case 'userJoined':
                updateUserList(data.users);
                break;
            case 'userLeft':
                updateUserList(data.users);
                break;
            case 'roomClosed':
                popnotif('Room closed', 'error');
                window.location.href = "/";
                break;
            case 'roomRenamed':
                document.getElementById('room-name').textContent = data.newName;
                break;
            case 'error':
                if (data.message.toString().includes("not found")) {
                    popnotif("Room not found", "error");
                    return location.href = "/";
                }
                popnotif(data.message, "error");
                break;
        }
    };
}

// room functions
async function createRoom() {
    userName = usernameInput.value.trim();
    if (!userName) return popnotif('Username is empty', 'warning');
    localStorage.setItem('username', userName.substring(0, 20));

    sharedKey = crypto.getRandomValues(new Uint8Array(16)).reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');

    try {
        await connectWebSocket();
        socket.send(JSON.stringify({
            type: 'create'
        }));
    } catch (error) {
        popnotif('Failed to connect to AssChat server', 'error');
    }
}

async function joinRoom() {
    if (!userName) {
        joinContainer.innerHTML = `
            <h2 class="text-2xl font-bold mb-4">Join Room</h2>
            <input type="text" id="username-input" placeholder="Enter your username" class="w-full p-3 mb-4 rounded-lg border border-gray-600 bg-gray-800">
            <button id="join-room-btn" class="w-full p-3 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition-colors">Join Room</button>
        `;

        document.getElementById('join-room-btn').addEventListener('click', () => {
            userName = document.getElementById('username-input').value.trim();
            if (userName) {
                localStorage.setItem('username', userName.substring(0, 20));
                window.location.reload();
            } else {
                popnotif('Please enter a username', 'warning');
            }
        });
    } else {
        try {
            await connectWebSocket();

            if (!sharedKey) {
                popnotif('Invalid invite link', 'error');
                return;
            }

            socket.send(JSON.stringify({
                type: 'join',
                userName,
                roomId
            }));
        } catch (error) {
            popnotif('Failed to join room', 'error');
        }
    }
}

function renameRoom() {
    const newName = document.getElementById('room-name-input').value.trim();
    if (newName) {
        socket.send(JSON.stringify({
            type: 'renameRoom',
            newName
        }));
    }
    closeSettingsModalHandler();
}

function setRoomTimeout() {
    const timeout = document.getElementById('timeout-input').value;
    if (timeout) {
        socket.send(JSON.stringify({
            type: 'setTimeout',
            timeout
        }));
    }
    closeSettingsModalHandler();
}

function closeRoom() {
    socket.send(JSON.stringify({
        type: 'closeRoom'
    }));
    closeSettingsModalHandler();
}

// msg functions
function sendMessage() {
    const message = messageInput.value.trim();
    if (message && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'message',
            content: encryptMessage(message, sharedKey, roomId)
        }));
        messageInput.value = '';
        autoResizeInput();
    }
}

function showmsg(user, content, timestamp) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${user === userName ? 'sent' : 'received'}`;

    messageElement.innerHTML = `
        ${user !== userName ? `<div class="message-avatar">${escape(user)[0].toUpperCase()}</div>` : ''}
        <div class="message-content">
            ${user !== userName ? `<div class="message-username">${escape(user)}</div>` : ''}
            <div class="message-text">${ marked.parse(escape(content)) }</div>
            <div class="message-time">${escape(timestamp.toLocaleTimeString())}</div>
        </div>
    `;

    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// UI functions
function updateUserList(currentUsers) {
    let activity = {};
    try {
        activity = JSON.parse(localStorage.getItem('activity')) || {};
    } catch (e) {}

    if (!(activity.roomId === roomId)) {
        activity = {
            roomId
        }
        localStorage.activity = JSON.stringify(activity)
    }

    userList.innerHTML = '';
    const currentUserElement = document.createElement('div');

    Object.entries(activity).forEach(([user, status]) => {
        if (user !== 'roomId') users.set(user, status);
    });

    currentUsers.forEach(user => users.set(user, 'Online'));

    users.forEach((status, user) => {
        if (user === 'roomId') return;

        if (!currentUsers.includes(user)) users.set(user, 'Offline');

        const userElement = document.createElement('div');
        userElement.className = 'user-item';
        const initials = user.split(' ').map(w => w[0] ? w[0].toUpperCase() : '').join('').slice(0, 2);

        userElement.innerHTML = `
    <div class="user-avatar ${user === userName ? 'current-user' : ''}">${escape(initials)}</div>
    <div class="user-info">
        <span class="user-name">${escape(user)}</span>
        <span class="user-status">${escape(users.get(user))}</span>
    </div>
`;

        (user === userName ? currentUserElement : userList).appendChild(userElement);
        activity[user] = users.get(user);
    });

    userList.prepend(currentUserElement);
    localStorage.setItem('activity', JSON.stringify(activity));
}


function popnotif(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-content">${message}</div>
        <span class="toast-close">&times;</span>
    `;
    toastContainer.appendChild(toast);
    toast.offsetHeight;
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    setTimeout(() => {
        toast.classList.add('hide');
        toast.addEventListener('transitionend', () => {
            toast.remove();
        });
    }, duration);
    toast.querySelector('.toast-close').addEventListener('click', () => {
        toast.classList.add('hide');
        toast.addEventListener('transitionend', () => {
            toast.remove();
        });
    });
}

function autoResizeInput() {
    messageInput.style.height = 'auto';
    messageInput.style.height = (messageInput.scrollHeight) + 'px';
}

// handlers
function handleMessageInputKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

// init
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');
if (urlParams.get('key')) {
    sharedKey = decodeURIComponent(urlParams.get('key'));
}
if (roomParam) {
    roomId = roomParam;
    userName = localStorage.getItem('username') || null
    joinRoom();
}

inviteModal.addEventListener('click', (e) => {
    if (e.target === inviteModal) {
        inviteModal.classList.remove('show');
        inviteModal.addEventListener('transitionend', () => {
            inviteModal.classList.add('hidden');
        }, {
            once: true
        });
    }
});

settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        settingsModal.classList.remove('show');
        settingsModal.addEventListener('transitionend', () => {
            settingsModal.classList.add('hidden');
        }, {
            once: true
        });
    }
});

function showInviteModal() {
    inviteModalContent.innerHTML = `
    <div class="flex justify-between items-center mb-4">
        <h3 class="text-xl font-bold">Invite Users</h3>
        <button id="close-invite-modal" class="text-gray-300 hover:text-gray-100">
            <i data-lucide="x"></i>
        </button>
    </div>
    <p class="mb-4">Share this link for users to join you in chat:</p>
    <div class="flex items-center bg-gray-700 rounded-lg p-2">
        <input id="invite-link" type="text" readonly class="bg-transparent flex-grow mr-2 outline-none" value="${window.location.origin}/?room=${roomId}&key=${encodeURIComponent(sharedKey)}">
        <button id="copy-link" class="bg-indigo-500 text-white p-2 rounded-lg hover:bg-indigo-600 transition-colors">
            <i data-lucide="copy"></i>
        </button>
    </div>
    `;
    inviteModal.classList.remove('hidden');
    setTimeout(() => {
        inviteModal.classList.add('show');
    }, 10);

    document.getElementById('close-invite-modal').addEventListener('click', closeInviteModal);
    const copyLinkBtn = document.getElementById('copy-link');
    if (copyLinkBtn) {
        copyLinkBtn.addEventListener('click', () => {
            const inviteLinkInput = document.getElementById('invite-link');
            inviteLinkInput.select();
            document.execCommand('copy');
            popnotif('Link copied to clipboard', 'success');
        });
    }

    lucide.createIcons();
}

function closeInviteModal() {
    inviteModal.classList.remove('show');
    inviteModal.addEventListener('transitionend', () => {
        inviteModal.classList.add('hidden');
    }, {
        once: true
    });
}

function showSettingsModal() {
    settingsModal.classList.remove('hidden');
    setTimeout(() => {
        settingsModal.classList.add('show');
    }, 10);
}

function closeSettingsModalHandler() {
    settingsModal.classList.remove('show');
    settingsModal.addEventListener('transitionend', () => {
        settingsModal.classList.add('hidden');
    }, {
        once: true
    });
}

document.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();

    messageInput.style.height = 'auto';
    lucide.createIcons();

    // cache notifcation sound
    if (notificationSound === null) {
        notificationSound = new Audio("assets/noti.mp3");
        notificationSound.load();
    }
});

// for mobile
document.addEventListener('DOMContentLoaded', function() {
    const toggleUsersBtn = document.getElementById('toggle-users-btn');
    const userListContainer = document.querySelector('.user-list-container');

    if (toggleUsersBtn && userListContainer) {
        toggleUsersBtn.addEventListener('click', function(eventt) {
            eventt.stopPropagation();
            userListContainer.classList.toggle('show');
        });

        // close the user list when u click out the box shit
        document.querySelector('.chat-container').addEventListener('click', function(e) {
            if (!userListContainer.contains(e.target) &&
                !toggleUsersBtn.contains(e.target) &&
                userListContainer.classList.contains('show')) {
                userListContainer.classList.remove('show');
            }
        });
    }
});
