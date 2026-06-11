<template>
  <div v-if="!loggedIn" class="auth-page">
    <section class="auth-panel">
      <div class="auth-brand">
        <div class="brand-mark">Q</div>
        <div>
          <h1>QQChat</h1>
          <p>登录后进入即时聊天系统</p>
        </div>
      </div>

      <div class="auth-tabs">
        <button :class="{ active: authMode === 'login' }" @click="switchAuthMode('login')">登录</button>
        <button :class="{ active: authMode === 'register' }" @click="switchAuthMode('register')">注册</button>
      </div>

      <form class="auth-form" @submit.prevent="submitAuth">
        <label>
          <span>用户名</span>
          <input v-model.trim="loginUsername" autocomplete="username" placeholder="请输入用户名" />
        </label>

        <label v-if="authMode === 'register'">
          <span>昵称</span>
          <input v-model.trim="registerNickname" autocomplete="nickname" placeholder="可选，默认使用用户名" />
        </label>

        <label>
          <span>密码</span>
          <input
            v-model="loginPassword"
            type="password"
            autocomplete="current-password"
            placeholder="请输入密码"
          />
        </label>

        <p class="auth-hint">
          {{ authMode === 'login' ? '内置演示账号 user1 / user2 / user3，密码都是 123456。' : '用户名至少 3 个字符，密码至少 6 位。' }}
        </p>

        <p v-if="authError" class="auth-error">{{ authError }}</p>
        <button class="primary-auth-button" :disabled="authLoading">
          {{ authLoading ? '处理中...' : authMode === 'login' ? '登录并进入聊天' : '创建账号并进入聊天' }}
        </button>
      </form>
    </section>
  </div>

  <div v-else class="page">
    <aside class="sidebar">
      <div class="profile">
        <div class="avatar">{{ currentUserInitial }}</div>
        <div class="profile-main">
          <div class="nickname">{{ currentNickname }}</div>
          <div class="status" :class="{ online: connected }">
            {{ connected ? '在线' : '离线' }}
          </div>
        </div>
        <button class="logout-button" title="退出登录" @click="logout">退出</button>
      </div>

      <div class="contact-title">联系人</div>
      <button
        v-for="contact in contacts"
        :key="contact.userId"
        class="contact"
        :class="{ active: activeContactId === contact.userId }"
        @click="selectContact(contact.userId)"
      >
        <span class="contact-avatar">{{ contact.userId.slice(0, 1).toUpperCase() }}</span>
        <span class="contact-info">
          <span>{{ contact.name }}</span>
          <small>{{ isOnline(contact.userId) ? '在线' : '离线' }}</small>
        </span>
      </button>
    </aside>

    <main class="chat">
      <header class="chat-header">
        <div>
          <h1>{{ activeContactName }}</h1>
          <p>正在与 {{ activeContactId }} 聊天</p>
        </div>
        <span class="online-count">在线 {{ onlineUsers.length }} 人</span>
      </header>

      <section ref="messagePanelRef" class="message-panel">
        <div v-if="loadingMessages" class="empty-state">正在加载历史消息...</div>
        <div v-else-if="messages.length === 0" class="empty-state">暂无消息，发一句开始聊天吧。</div>

        <div
          v-for="message in messages"
          :key="message.id"
          class="message-row"
          :class="{ mine: message.from === currentUserId }"
        >
          <div class="bubble">
            <div v-if="message.type === 'image'" class="image-message">
              <img :src="message.content" alt="聊天图片" />
            </div>
            <div v-else class="message-content">{{ message.content }}</div>
            <div class="message-time">{{ formatTime(message.timestamp) }}</div>
          </div>
        </div>
      </section>

      <footer class="composer">
        <div class="toolbar">
          <button class="tool-button" :disabled="!canChat" @click="showEmojiPanel = !showEmojiPanel">😊</button>
          <label class="tool-button" :class="{ disabled: !canChat }">
            🖼
            <input type="file" accept="image/*" :disabled="!canChat" @change="sendImage" />
          </label>
          <div v-if="showEmojiPanel" class="emoji-panel">
            <button v-for="emoji in emojiList" :key="emoji" @click="sendEmoji(emoji)">{{ emoji }}</button>
          </div>
        </div>

        <div class="input-row">
          <textarea
            v-model="draft"
            :disabled="!canChat"
            placeholder="输入消息，Enter 发送，Shift + Enter 换行"
            @keydown.enter.exact.prevent="sendText"
          ></textarea>
          <button class="send-button" :disabled="!canChat || !draft.trim()" @click="sendText">发送</button>
        </div>
      </footer>
    </main>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const apiUrl = 'http://localhost:3000'
const wsUrl = 'ws://localhost:3000'
const defaultContacts = [
  { userId: 'user1', name: 'user1' },
  { userId: 'user2', name: 'user2' },
  { userId: 'user3', name: 'user3' }
]
const emojiList = ['😀', '😁', '😂', '😊', '😍', '😎', '😭', '😡', '👍', '🎉', '❤️', '🔥']

const socket = ref(null)
const authMode = ref('login')
const loginUsername = ref(localStorage.getItem('qqchat:lastUsername') || '')
const loginPassword = ref('')
const registerNickname = ref('')
const authToken = ref(localStorage.getItem('qqchat:token') || '')
const authError = ref('')
const authLoading = ref(false)
const currentUserId = ref('')
const currentNickname = ref('')
const activeContactId = ref('user2')
const onlineUsers = ref([])
const messages = ref([])
const draft = ref('')
const connected = ref(false)
const loggedIn = ref(false)
const loadingMessages = ref(false)
const showEmojiPanel = ref(false)
const messagePanelRef = ref(null)

const contacts = computed(() => {
  const ids = new Set(defaultContacts.map((item) => item.userId))
  onlineUsers.value.forEach((userId) => ids.add(userId))
  if (currentUserId.value) {
    ids.delete(currentUserId.value)
  }
  return Array.from(ids).map((userId) => ({ userId, name: userId }))
})

const currentUserInitial = computed(() => (currentNickname.value || '?').slice(0, 1).toUpperCase())
const activeContactName = computed(() => activeContactId.value || '聊天窗口')
const canChat = computed(() => connected.value && activeContactId.value)

watch(activeContactId, () => {
  if (loggedIn.value) {
    loadMessages()
  }
})

if (authToken.value) {
  restoreSession()
}

function switchAuthMode(mode) {
  authMode.value = mode
  authError.value = ''
}

async function submitAuth() {
  if (authMode.value === 'login') {
    await authenticate('/api/login')
  } else {
    await authenticate('/api/register')
  }
}

async function authenticate(path) {
  const username = loginUsername.value.trim()
  const password = loginPassword.value.trim()
  const nickname = registerNickname.value.trim()

  authError.value = ''
  if (!username || !password) {
    authError.value = '请输入用户名和密码'
    return
  }

  authLoading.value = true
  try {
    const data = await apiRequest(path, {
      method: 'POST',
      body: { username, password, nickname }
    })
    enterApp(data.user, data.token)
    loginPassword.value = ''
  } catch (error) {
    authError.value = error.message
  } finally {
    authLoading.value = false
  }
}

async function restoreSession() {
  try {
    const data = await apiRequest('/api/me')
    enterApp(data.user, authToken.value)
  } catch {
    localStorage.removeItem('qqchat:token')
    authToken.value = ''
  }
}

function enterApp(user, token) {
  currentUserId.value = user.id
  currentNickname.value = user.nickname || user.username
  loginUsername.value = user.username
  authToken.value = token
  loggedIn.value = true
  localStorage.setItem('qqchat:token', token)
  localStorage.setItem('qqchat:lastUsername', user.username)

  if (activeContactId.value === user.id) {
    activeContactId.value = defaultContacts.find((item) => item.userId !== user.id)?.userId || ''
  }

  connectWebSocket(token)
  loadMessages()
}

function logout() {
  if (socket.value) {
    socket.value.close()
  }
  socket.value = null
  connected.value = false
  loggedIn.value = false
  currentUserId.value = ''
  currentNickname.value = ''
  onlineUsers.value = []
  messages.value = []
  draft.value = ''
  authToken.value = ''
  localStorage.removeItem('qqchat:token')
}

function connectWebSocket(token) {
  if (socket.value) {
    socket.value.close()
  }

  socket.value = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`)

  socket.value.onopen = () => {
    connected.value = true
  }

  socket.value.onmessage = (event) => {
    const data = JSON.parse(event.data)

    if (data.type === 'onlineUsers') {
      onlineUsers.value = data.users
      return
    }

    if (data.type === 'messageSaved') {
      upsertLocalMessage(data.message)
      return
    }

    if (data.type === 'message') {
      saveMessageToCache(data.message)
      if (isCurrentChatMessage(data.message)) {
        upsertLocalMessage(data.message)
        scrollToBottom()
      }
    }
  }

  socket.value.onclose = () => {
    connected.value = false
  }

  socket.value.onerror = () => {
    connected.value = false
  }
}

function selectContact(userId) {
  activeContactId.value = userId
  showEmojiPanel.value = false
}

function sendText() {
  const content = draft.value.trim()
  if (!content) return

  sendChatMessage('text', content)
  draft.value = ''
}

function sendEmoji(emoji) {
  sendChatMessage('emoji', emoji)
  showEmojiPanel.value = false
}

function sendImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return

  const reader = new FileReader()
  reader.onload = () => {
    sendChatMessage('image', reader.result)
  }
  reader.readAsDataURL(file)
}

function sendChatMessage(type, content) {
  if (!canChat.value) return

  const message = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    from: currentUserId.value,
    to: activeContactId.value,
    type,
    content,
    timestamp: Date.now()
  }

  socket.value.send(JSON.stringify({ type: 'message', message }))
  saveMessageToCache(message)
  upsertLocalMessage(message)
  scrollToBottom()
}

function storageKey(userA = currentUserId.value, userB = activeContactId.value) {
  return `qqchat:messages:${[userA, userB].sort().join(':')}`
}

async function loadMessages() {
  if (!currentUserId.value || !activeContactId.value) {
    messages.value = []
    return
  }

  const cached = loadCachedMessages()
  messages.value = cached
  scrollToBottom()

  if (!authToken.value) return

  loadingMessages.value = true
  try {
    const data = await apiRequest(`/api/messages?targetId=${encodeURIComponent(activeContactId.value)}`)
    messages.value = data.messages
    localStorage.setItem(storageKey(), JSON.stringify(data.messages))
    scrollToBottom()
  } catch (error) {
    authError.value = error.message
  } finally {
    loadingMessages.value = false
  }
}

function loadCachedMessages() {
  const raw = localStorage.getItem(storageKey())
  return raw ? JSON.parse(raw) : []
}

function saveMessageToCache(message) {
  const raw = localStorage.getItem(storageKey(message.from, message.to))
  const history = raw ? JSON.parse(raw) : []

  if (!history.some((item) => item.id === message.id)) {
    history.push(message)
    localStorage.setItem(storageKey(message.from, message.to), JSON.stringify(history))
  }
}

function upsertLocalMessage(message) {
  const index = messages.value.findIndex((item) => item.id === message.id)
  if (index >= 0) {
    messages.value.splice(index, 1, message)
  } else if (isCurrentChatMessage(message)) {
    messages.value.push(message)
  }
}

function isCurrentChatMessage(message) {
  return (
    (message.from === currentUserId.value && message.to === activeContactId.value) ||
    (message.from === activeContactId.value && message.to === currentUserId.value)
  )
}

function isOnline(userId) {
  return onlineUsers.value.includes(userId)
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken.value ? { Authorization: `Bearer ${authToken.value}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || '请求失败')
  }

  return data
}

function scrollToBottom() {
  nextTick(() => {
    if (messagePanelRef.value) {
      messagePanelRef.value.scrollTop = messagePanelRef.value.scrollHeight
    }
  })
}

onBeforeUnmount(() => {
  if (socket.value) {
    socket.value.close()
  }
})
</script>
