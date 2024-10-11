// global variables
let socket, roomId, userName, sharedKey, owner, ping
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

// xss remover thing
function escape(input) {
    if (typeof input !== 'string') input = String(input);

    return input
    .replace(/\n/g, '<br>')         // Convert newlines to <br>
    .replace(/&/g, '&amp;')        // Encode ampersands
    .replace(/</g, '&lt;')         // Encode less than
    .replace(/>/g, '&gt;')         // Encode greater than
    .replace(/"/g, '&quot;')       // Encode double quotes
    .replace(/'/g, '&#39;')        // Encode single quotes
    .replace(/javascript:/gi, '')   // Strip JavaScript protocol
    .replace(/on\w+="[^"]*"/gi, '') // Remove inline event handlers with double quotes
    .replace(/on\w+='[^']*'/gi, '') // Remove inline event handlers with single quotes
    .replace(/data:/gi, '')         // Strip data URIs
    .replace(/href=[^'"]+/gi, '')   // Remove href attributes
    .replace(/src=[^'"]+/gi, '')    // Remove src attributes
    .replace(/style=[^'"]+/gi, '')  // Remove style attributes
    .replace(/svg/gi, '')            // Remove svg elements
    .replace(/<\/?[^>]+(>|$)/g, '') // Remove any remaining tags
    .replace(/&#47;&#47;/g, '')     // Strip double forward slashes
    .replace(/&#/g, '&_#')          // Prevent character references
    .replace(/\s+/g, ' ')            // Collapse multiple spaces
    .trim();                         // Trim whitespace
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
function encryptMessage(message) {
    const deadData = CryptoJS.lib.WordArray.random(2).toString();
    const salt = CryptoJS.lib.WordArray.random(4).toString();
    const iv = CryptoJS.lib.WordArray.random(4).toString();
    const compositeKey = CryptoJS.SHA256(sharedKey + roomId).toString();
    const combinedKey = CryptoJS.PBKDF2(compositeKey, salt, {
        keySize: 256 / 32,
        iterations: 1000
    });
    const encrypted = CryptoJS.AES.encrypt(deadData + message + deadData, combinedKey, {
        iv: CryptoJS.enc.Utf16.parse(iv)
    });
    const finalData = salt + iv + encrypted.toString();
    return "ASSCRYPT_"+CryptoJS.enc.Utf16.stringify(CryptoJS.enc.Utf8.parse(finalData));
}

function decryptMessage(ciphertext) {
    ciphertext = ciphertext.replace("ASSCRYPT_", "")
    try {
        const decodedText = CryptoJS.enc.Utf16.parse(ciphertext).toString(CryptoJS.enc.Utf8);
        const salt = decodedText.substr(0, 8);
        const iv = decodedText.substr(8, 8);
        const encrypted = decodedText.substr(16);
        const compositeKey = CryptoJS.SHA256(sharedKey + roomId).toString();
        const combinedKey = CryptoJS.PBKDF2(compositeKey, salt, {
            keySize: 256 / 32,
            iterations: 1000
        });
        const decrypted = CryptoJS.AES.decrypt(encrypted, combinedKey, {
            iv: CryptoJS.enc.Utf16.parse(iv)
        });
        const fullMessage = decrypted.toString(CryptoJS.enc.Utf8);
        return fullMessage.substr(4, fullMessage.length - 8);
    } catch(kys) {
        console.log(kys)
        return "ASSCRYPT ERROR CHECK CONSOLE";
    }
}

// WebSocket functions
function connectWebSocket() {
    return new Promise((resolve, reject) => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(`${protocol}//${window.location.host}`);

        socket.onopen = () => {
            console.log('connected to AssChat server');
            setupSocketHandlers();
            resolve();
        };

        socket.onerror = (error) => {
            console.error(error);
            reject(error);
        };

        socket.onclose = () => {
            popnotif('Connection to server closed', 'error');
            location.href = "/";
        };

        // pinger
        setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    type: 'ping'
                }));
                ping = Date.now();
                console.log("ping")
            }
        }, 1000 * 20);
    });
}

function setupSocketHandlers() {
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
                window.history.pushState(null, '', `/?room=${roomId}`);
                break;
            case 'joined':
                sharedKey = data.sharedKey;
                joinContainer.style.display = 'none';
                chatContainer.style.display = 'block';
                updateUserList(data.users);
                data.messages.forEach(msg => showmsg(msg.userName, decryptMessage(msg.content), new Date(msg.timestamp)));

                owner = data.isCreator;
                settingsBtn.style.display = owner ? 'inline-block' : 'none';
                break;
            case 'message':
                showmsg(data.userName, decryptMessage(data.content), new Date(data.timestamp));

                if (data.userName !== userName && !document.hasFocus()) {
                    new Audio("assets/noti.mp3").play()
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
                window.history.pushState(null, '', `/`);
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
            content: encryptMessage(message)
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
        <input id="invite-link" type="text" readonly class="bg-transparent flex-grow mr-2 outline-none" value="${window.location.origin}/?room=${roomId}">
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
    messageInput.style.height = 'auto';
    lucide.createIcons();
});