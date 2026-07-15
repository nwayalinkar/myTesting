// BroadcastChannel name for the app
const CHANNEL_NAME = 'pulse_chat_realtime';

// Default initial chat rooms
const DEFAULT_ROOMS = ['general', 'random', 'help', 'project-updates'];

class PulseChatApp {
  constructor() {
    this.userId = this.getOrCreateUserId();
    this.username = localStorage.getItem('pulse_chat_username') || '';
    this.avatarBg = localStorage.getItem('pulse_chat_avatar_bg') || this.generateRandomColor();
    this.currentRoom = 'general';
    
    // Application State
    this.rooms = this.loadRooms();
    this.messages = this.loadMessages();
    this.activeUsers = new Map(); // userId -> {username, avatarBg, lastSeen, isTyping}
    this.typingTimeout = null;
    this.heartbeatInterval = null;
    
    // Broadcast Channel for Real-time communication
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    
    // DOM Elements
    this.dom = {
      themeToggle: document.getElementById('themeToggle'),
      usernameInput: document.getElementById('usernameInput'),
      setNameBtn: document.getElementById('setNameBtn'),
      userAvatar: document.getElementById('userAvatar'),
      roomList: document.getElementById('roomList'),
      addRoomBtn: document.getElementById('addRoomBtn'),
      onlineUsersList: document.getElementById('onlineUsersList'),
      currentRoomName: document.getElementById('currentRoomName'),
      messagesContainer: document.getElementById('messagesContainer'),
      messageInput: document.getElementById('messageInput'),
      sendBtn: document.getElementById('sendBtn'),
      typingIndicator: document.getElementById('typingIndicator'),
      sidebar: document.getElementById('sidebar'),
      sidebarToggle: document.getElementById('sidebarToggle')
    };

    this.init();
  }

  // --- Core Initialization ---
  init() {
    this.setupTheme();
    this.setupEventListeners();
    this.setupBroadcastChannel();
    
    // Init rooms list
    this.renderRooms();
    
    // Set up username state
    if (this.username) {
      this.dom.usernameInput.value = this.username;
      this.updateProfileAvatar(this.username, this.avatarBg);
      this.enableChat();
      this.startPresence();
    } else {
      this.disableChat();
      this.updateProfileAvatar('?', '#94a3b8');
    }

    // Initial render of messages
    this.renderMessages();
    
    // Periodically update timestamps and purge offline users
    setInterval(() => {
      this.updateRelativeTimestamps();
      this.checkUserPresence();
    }, 5000);
  }

  // --- UUID helper ---
  getOrCreateUserId() {
    let id = localStorage.getItem('pulse_chat_user_id');
    if (!id) {
      id = 'user_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('pulse_chat_user_id', id);
    }
    return id;
  }

  generateRandomColor() {
    const colors = [
      '#6366f1', '#4f46e5', '#3b82f6', '#2563eb', 
      '#10b981', '#059669', '#f59e0b', '#d97706',
      '#ef4444', '#dc2626', '#8b5cf6', '#7c3aed',
      '#ec4899', '#db2777'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  // --- Theme Management ---
  setupTheme() {
    const savedTheme = localStorage.getItem('pulse_chat_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    this.dom.themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
  }

  toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('pulse_chat_theme', newTheme);
    this.dom.themeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
  }

  // --- Data Loading & Storage ---
  loadRooms() {
    const rooms = localStorage.getItem('pulse_chat_rooms');
    return rooms ? JSON.parse(rooms) : [...DEFAULT_ROOMS];
  }

  saveRooms() {
    localStorage.setItem('pulse_chat_rooms', JSON.stringify(this.rooms));
  }

  loadMessages() {
    const msgs = localStorage.getItem('pulse_chat_messages');
    return msgs ? JSON.parse(msgs) : [];
  }

  saveMessages() {
    localStorage.setItem('pulse_chat_messages', JSON.stringify(this.messages));
  }

  // --- Profile Flow ---
  updateProfileAvatar(name, color) {
    const initials = name ? name.trim().charAt(0).toUpperCase() : '?';
    this.dom.userAvatar.textContent = initials;
    this.dom.userAvatar.style.backgroundColor = color;
    this.dom.userAvatar.className = 'avatar' + (this.username ? ' online' : '');
  }

  handleSetName() {
    const rawVal = this.dom.usernameInput.value.trim();
    if (!rawVal) return;

    const oldUsername = this.username;
    this.username = rawVal;
    localStorage.setItem('pulse_chat_username', this.username);
    localStorage.setItem('pulse_chat_avatar_bg', this.avatarBg);

    this.updateProfileAvatar(this.username, this.avatarBg);
    this.enableChat();
    this.startPresence();

    // Broadcast update or initial arrival
    if (!oldUsername) {
      this.sendSystemMessage(`${this.username} joined the chat room.`);
    } else if (oldUsername !== this.username) {
      this.sendSystemMessage(`${oldUsername} renamed themselves to ${this.username}.`);
    }
  }

  enableChat() {
    this.dom.messageInput.removeAttribute('disabled');
    this.dom.sendBtn.removeAttribute('disabled');
    this.dom.messageInput.placeholder = "Type a message...";
  }

  disableChat() {
    this.dom.messageInput.setAttribute('disabled', 'true');
    this.dom.sendBtn.setAttribute('disabled', 'true');
    this.dom.messageInput.placeholder = "Please enter your name to start chatting...";
  }

  // --- Presence & Live Status updates ---
  startPresence() {
    // Send heartbeat immediately, then periodically
    this.sendHeartbeat();
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), 4000);
  }

  sendHeartbeat(isTyping = false) {
    if (!this.username) return;
    this.broadcast({
      type: 'heartbeat',
      userId: this.userId,
      username: this.username,
      avatarBg: this.avatarBg,
      isTyping: isTyping
    });
  }

  checkUserPresence() {
    const now = Date.now();
    let presenceChanged = false;
    for (const [uid, user] of this.activeUsers.entries()) {
      // If user hasn't sent a heartbeat for more than 10 seconds, remove them
      if (now - user.lastSeen > 10000) {
        this.activeUsers.delete(uid);
        presenceChanged = true;
      }
    }
    if (presenceChanged) {
      this.renderOnlineUsers();
    }
  }

  renderOnlineUsers() {
    this.dom.onlineUsersList.innerHTML = '';
    
    // Add current user first
    if (this.username) {
      const selfItem = document.createElement('li');
      selfItem.className = 'user-item';
      selfItem.innerHTML = `
        <span class="user-status-dot online"></span>
        <span><strong>${this.username} (You)</strong></span>
      `;
      this.dom.onlineUsersList.appendChild(selfItem);
    }

    // Add other active users
    this.activeUsers.forEach((user) => {
      const userItem = document.createElement('li');
      userItem.className = 'user-item';
      const isUserTyping = user.isTyping;
      userItem.innerHTML = `
        <span class="user-status-dot ${isUserTyping ? 'typing' : 'online'}"></span>
        <span>${user.username}</span>
      `;
      this.dom.onlineUsersList.appendChild(userItem);
    });
  }

  // --- Chat Messaging & Storage UI ---
  renderRooms() {
    this.dom.roomList.innerHTML = '';
    this.rooms.forEach((room) => {
      const li = document.createElement('li');
      li.className = `room-item ${room === this.currentRoom ? 'active' : ''}`;
      li.innerHTML = `
        <span># ${room}</span>
        <span class="room-badge" id="badge-${room}">0</span>
      `;
      li.addEventListener('click', () => this.switchRoom(room));
      this.dom.roomList.appendChild(li);
    });
  }

  switchRoom(roomName) {
    this.currentRoom = roomName;
    this.dom.currentRoomName.textContent = `# ${roomName}`;
    this.renderRooms();
    this.renderMessages();
    
    // Clear badge
    const badge = document.getElementById(`badge-${roomName}`);
    if (badge) {
      badge.textContent = '0';
      badge.className = 'room-badge';
    }

    // Close mobile drawer if open
    this.dom.sidebar.classList.remove('open');
  }

  handleAddRoom() {
    const roomName = prompt("Enter new channel/room name:").trim().toLowerCase().replace(/\s+/g, '-');
    if (!roomName) return;

    if (this.rooms.includes(roomName)) {
      alert("This room already exists.");
      return;
    }

    this.rooms.push(roomName);
    this.saveRooms();
    this.renderRooms();
    
    this.broadcast({
      type: 'room_created',
      roomName: roomName
    });

    this.switchRoom(roomName);
  }

  sendMessage() {
    const text = this.dom.messageInput.value.trim();
    if (!text || !this.username) return;

    const message = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      userId: this.userId,
      username: this.username,
      avatarBg: this.avatarBg,
      room: this.currentRoom,
      type: 'user',
      text: text,
      timestamp: Date.now(),
      reactions: {} // emoji -> [userIds]
    };

    this.messages.push(message);
    this.saveMessages();
    this.renderMessages();
    
    this.broadcast({
      type: 'message',
      message: message
    });

    this.dom.messageInput.value = '';
    this.dom.messageInput.style.height = 'auto';
    this.stopTyping();
  }

  sendSystemMessage(text) {
    const message = {
      id: 'sys_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      room: this.currentRoom,
      type: 'system',
      text: text,
      timestamp: Date.now()
    };

    this.messages.push(message);
    this.saveMessages();
    this.renderMessages();
    
    this.broadcast({
      type: 'message',
      message: message
    });
  }

  renderMessages() {
    this.dom.messagesContainer.innerHTML = '';
    
    // Filter messages for current room
    const roomMessages = this.messages.filter(m => m.room === this.currentRoom);
    
    if (roomMessages.length === 0) {
      const emptyInfo = document.createElement('div');
      emptyInfo.className = 'system-notification';
      emptyInfo.textContent = `Welcome to the start of the #${this.currentRoom} channel!`;
      this.dom.messagesContainer.appendChild(emptyInfo);
    }

    roomMessages.forEach((msg) => {
      if (msg.type === 'system') {
        const div = document.createElement('div');
        div.className = 'system-notification';
        div.textContent = msg.text;
        this.dom.messagesContainer.appendChild(div);
      } else {
        const isSelf = msg.userId === this.userId;
        const initials = msg.username.charAt(0).toUpperCase();
        
        const group = document.createElement('div');
        group.className = `message-group ${isSelf ? 'self' : 'other'}`;
        group.dataset.messageId = msg.id;

        // Avatar
        const avatar = document.createElement('div');
        avatar.className = 'msg-avatar';
        avatar.style.backgroundColor = msg.avatarBg;
        avatar.textContent = initials;
        group.appendChild(avatar);

        // Content Wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'message-content-wrapper';

        // Meta Info
        const meta = document.createElement('div');
        meta.className = 'message-meta';
        meta.innerHTML = `
          <span class="message-sender">${msg.username}</span>
          <span class="message-time" data-timestamp="${msg.timestamp}">${this.formatRelativeTime(msg.timestamp)}</span>
        `;
        wrapper.appendChild(meta);

        // Bubble
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.textContent = msg.text;
        wrapper.appendChild(bubble);

        // Reactions View
        const rxnsContainer = document.createElement('div');
        rxnsContainer.className = 'reactions-container';
        this.renderReactions(msg, rxnsContainer);
        wrapper.appendChild(rxnsContainer);

        // Reaction Picker Trigger
        const trigger = document.createElement('button');
        trigger.className = 'reaction-picker-trigger';
        trigger.innerHTML = '☺';
        trigger.title = 'Add reaction';
        trigger.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showEmojiPopover(trigger, msg.id);
        });
        wrapper.appendChild(trigger);

        group.appendChild(wrapper);
        this.dom.messagesContainer.appendChild(group);
      }
    });

    // Auto-scroll to bottom
    this.dom.messagesContainer.scrollTop = this.dom.messagesContainer.scrollHeight;
  }

  // --- Emoji Reactions Implementation ---
  renderReactions(message, container) {
    container.innerHTML = '';
    const reactions = message.reactions || {};
    
    Object.entries(reactions).forEach(([emoji, userIds]) => {
      if (userIds.length === 0) return;
      
      const badge = document.createElement('div');
      const hasSelfReacted = userIds.includes(this.userId);
      badge.className = `reaction-badge ${hasSelfReacted ? 'user-reacted' : ''}`;
      badge.innerHTML = `<span>${emoji}</span> <span style="font-weight: 600;">${userIds.length}</span>`;
      
      badge.addEventListener('click', () => {
        this.toggleReaction(message.id, emoji);
      });
      container.appendChild(badge);
    });
  }

  showEmojiPopover(triggerElement, messageId) {
    // Remove existing popovers
    document.querySelectorAll('.emoji-popover').forEach(p => p.remove());

    const popover = document.createElement('div');
    popover.className = 'emoji-popover';
    
    const emojis = ['👍', '❤️', '😂', '🎉', '😮', '😢'];
    emojis.forEach((emoji) => {
      const option = document.createElement('span');
      option.className = 'emoji-option';
      option.textContent = emoji;
      option.addEventListener('click', () => {
        this.toggleReaction(messageId, emoji);
        popover.remove();
      });
      popover.appendChild(option);
    });

    triggerElement.parentElement.appendChild(popover);

    // Auto-remove popover when clicking anywhere else
    const closeHandler = () => {
      popover.remove();
      document.removeEventListener('click', closeHandler);
    };
    setTimeout(() => {
      document.addEventListener('click', closeHandler);
    }, 10);
  }

  toggleReaction(messageId, emoji) {
    const msg = this.messages.find(m => m.id === messageId);
    if (!msg) return;

    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];

    const index = msg.reactions[emoji].indexOf(this.userId);
    if (index > -1) {
      // Remove reaction
      msg.reactions[emoji].splice(index, 1);
    } else {
      // Add reaction
      msg.reactions[emoji].push(this.userId);
    }

    this.saveMessages();
    this.renderMessages();

    // Broadcast the update
    this.broadcast({
      type: 'reaction_update',
      messageId: messageId,
      reactions: msg.reactions
    });
  }

  // --- Real-time Realization (BroadcastChannel) ---
  setupBroadcastChannel() {
    this.channel.onmessage = (event) => {
      const data = event.data;
      
      switch (data.type) {
        case 'message':
          // Add external message if it's not already in storage
          if (!this.messages.find(m => m.id === data.message.id)) {
            this.messages.push(data.message);
            this.saveMessages();
            
            // Increment room badge if we're not currently looking at it
            if (data.message.room !== this.currentRoom) {
              const badge = document.getElementById(`badge-${data.message.room}`);
              if (badge) {
                const count = parseInt(badge.textContent || '0') + 1;
                badge.textContent = count;
                badge.className = 'room-badge visible';
              }
            } else {
              this.renderMessages();
            }
          }
          break;
          
        case 'heartbeat':
          // Update details about active user
          this.activeUsers.set(data.userId, {
            username: data.username,
            avatarBg: data.avatarBg,
            lastSeen: Date.now(),
            isTyping: data.isTyping
          });
          this.renderOnlineUsers();
          this.updateTypingIndicator();
          break;
          
        case 'typing':
          if (this.activeUsers.has(data.userId)) {
            const user = this.activeUsers.get(data.userId);
            user.isTyping = data.isTyping;
            user.lastSeen = Date.now();
            this.renderOnlineUsers();
            this.updateTypingIndicator();
          }
          break;

        case 'reaction_update':
          const msg = this.messages.find(m => m.id === data.messageId);
          if (msg) {
            msg.reactions = data.reactions;
            this.saveMessages();
            if (msg.room === this.currentRoom) {
              this.renderMessages();
            }
          }
          break;

        case 'room_created':
          if (!this.rooms.includes(data.roomName)) {
            this.rooms.push(data.roomName);
            this.saveRooms();
            this.renderRooms();
          }
          break;
      }
    };
  }

  broadcast(payload) {
    try {
      this.channel.postMessage(payload);
    } catch (e) {
      console.warn("Unable to broadcast message:", e);
    }
  }

  // --- Typing Indicator ---
  handleTyping() {
    this.sendHeartbeat(true);
    this.broadcast({
      type: 'typing',
      userId: this.userId,
      isTyping: true
    });

    if (this.typingTimeout) clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => this.stopTyping(), 2000);
  }

  stopTyping() {
    if (this.typingTimeout) clearTimeout(this.typingTimeout);
    this.broadcast({
      type: 'typing',
      userId: this.userId,
      isTyping: false
    });
  }

  updateTypingIndicator() {
    const typingUsers = [];
    this.activeUsers.forEach((user) => {
      if (user.isTyping) {
        typingUsers.push(user.username);
      }
    });

    if (typingUsers.length === 0) {
      this.dom.typingIndicator.textContent = '';
    } else if (typingUsers.length === 1) {
      this.dom.typingIndicator.textContent = `${typingUsers[0]} is typing...`;
    } else if (typingUsers.length === 2) {
      this.dom.typingIndicator.textContent = `${typingUsers[0]} and ${typingUsers[1]} are typing...`;
    } else {
      this.dom.typingIndicator.textContent = 'Multiple people are typing...';
    }
  }

  // --- Date/Time Helpers ---
  formatRelativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    if (diff < 10000) return 'just now';
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  updateRelativeTimestamps() {
    document.querySelectorAll('.message-time').forEach((el) => {
      const ts = parseInt(el.getAttribute('data-timestamp'));
      if (ts) el.textContent = this.formatRelativeTime(ts);
    });
  }

  // --- Listeners Setup ---
  setupEventListeners() {
    // Theme toggle
    this.dom.themeToggle.addEventListener('click', () => this.toggleTheme());

    // Profile Setup
    this.dom.setNameBtn.addEventListener('click', () => this.handleSetName());
    this.dom.usernameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleSetName();
    });

    // Add Room Button
    this.dom.addRoomBtn.addEventListener('click', () => this.handleAddRoom());

    // Message input text auto-grow and Send listener
    this.dom.messageInput.addEventListener('input', () => {
      this.dom.messageInput.style.height = 'auto';
      this.dom.messageInput.style.height = (this.dom.messageInput.scrollHeight - 20) + 'px';
      this.handleTyping();
    });

    this.dom.messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.dom.sendBtn.addEventListener('click', () => this.sendMessage());

    // Mobile sidebar toggle
    this.dom.sidebarToggle.addEventListener('click', () => {
      this.dom.sidebar.classList.toggle('open');
    });
  }
}

// Instantiate the app
window.addEventListener('DOMContentLoaded', () => {
  window.chatApp = new PulseChatApp();
});
