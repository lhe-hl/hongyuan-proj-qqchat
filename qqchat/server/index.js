import express from 'express'
import http from 'http'
import { createHash, randomBytes, randomUUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import initSqlJs from 'sql.js'
import { fileURLToPath } from 'url'
import { WebSocket, WebSocketServer } from 'ws'

const app = express()
const server = http.createServer(app)
const wss = new WebSocketServer({ server })
const PORT = 3000

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDir = path.join(__dirname, 'data')
const dbFile = path.join(dataDir, 'qqchat.sqlite')

const onlineUsers = new Map()
let db

app.use(express.json({ limit: '12mb' }))

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')

  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }

  next()
})

await initDatabase()

app.get('/', (req, res) => {
  res.send('QQChat SQLite server is running.')
})

app.post('/api/register', async (req, res) => {
  const username = normalizeUsername(req.body?.username)
  const password = String(req.body?.password || '')
  const nickname = normalizeNickname(req.body?.nickname) || username

  if (!username || !password) {
    res.status(400).json({ message: '请输入用户名和密码' })
    return
  }

  if (username.length < 3) {
    res.status(400).json({ message: '用户名至少 3 个字符' })
    return
  }

  if (password.length < 6) {
    res.status(400).json({ message: '密码至少 6 位' })
    return
  }

  if (findUserByUsername(username)) {
    res.status(409).json({ message: '用户名已存在' })
    return
  }

  const user = createUser(username, password, nickname)
  await persistDatabase()

  res.status(201).json({ user: publicUser(user), token: user.token })
})

app.post('/api/login', async (req, res) => {
  const username = normalizeUsername(req.body?.username)
  const password = String(req.body?.password || '')
  const user = findUserByUsername(username)

  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    res.status(401).json({ message: '用户名或密码错误' })
    return
  }

  const token = randomUUID()
  db.run('UPDATE users SET token = ? WHERE id = ?', [token, user.id])
  await persistDatabase()

  res.json({ user: publicUser({ ...user, token }), token })
})

app.get('/api/me', async (req, res) => {
  const user = getUserByRequest(req)
  if (!user) {
    res.status(401).json({ message: '登录已失效，请重新登录' })
    return
  }

  res.json({ user: publicUser(user) })
})

app.get('/api/messages', async (req, res) => {
  const user = getUserByRequest(req)
  const targetId = normalizeUsername(req.query.targetId)

  if (!user) {
    res.status(401).json({ message: '登录已失效，请重新登录' })
    return
  }

  if (!targetId) {
    res.status(400).json({ message: '缺少 targetId' })
    return
  }

  res.json({ messages: getConversationMessages(user.id, targetId) })
})

app.post('/api/messages', async (req, res) => {
  const user = getUserByRequest(req)

  if (!user) {
    res.status(401).json({ message: '登录已失效，请重新登录' })
    return
  }

  const message = normalizeMessage(req.body?.message, user.id)
  if (!message) {
    res.status(400).json({ message: '消息格式不正确' })
    return
  }

  const savedMessage = await saveMessage(message)
  res.status(201).json({ message: savedMessage })
})

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const token = url.searchParams.get('token')
  const user = getUserByToken(token)

  if (!user) {
    ws.close(1008, 'Unauthorized')
    return
  }

  onlineUsers.set(user.id, ws)
  console.log(`${user.id} connected`)
  broadcastOnlineUsers()

  ws.on('message', async (raw) => {
    try {
      const data = JSON.parse(raw.toString())

      if (data.type === 'message' && data.message) {
        const message = normalizeMessage(data.message, user.id)
        if (!message) return

        const savedMessage = await saveMessage(message)
        sendJson(ws, { type: 'messageSaved', message: savedMessage })
        forwardMessage(savedMessage)
      }
    } catch (error) {
      console.error('Invalid message:', error.message)
    }
  })

  ws.on('close', () => {
    const current = onlineUsers.get(user.id)
    if (current === ws) {
      onlineUsers.delete(user.id)
    }
    console.log(`${user.id} disconnected`)
    broadcastOnlineUsers()
  })
})

function forwardMessage(message) {
  const targetSocket = onlineUsers.get(message.to)

  if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
    sendJson(targetSocket, { type: 'message', message })
  }
}

function broadcastOnlineUsers() {
  const payload = {
    type: 'onlineUsers',
    users: Array.from(onlineUsers.keys())
  }

  for (const ws of onlineUsers.values()) {
    sendJson(ws, payload)
  }
}

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

async function initDatabase() {
  await mkdir(dataDir, { recursive: true })

  const SQL = await initSqlJs()
  const databaseBytes = await readFile(dbFile).catch(() => null)
  db = databaseBytes ? new SQL.Database(databaseBytes) : new SQL.Database()

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      nickname TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      token TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      from_user TEXT NOT NULL,
      to_user TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_messages_pair_time
      ON messages(from_user, to_user, timestamp);
  `)

  seedDefaultUsers()
  await persistDatabase()
}

function seedDefaultUsers() {
  for (const username of ['user1', 'user2', 'user3']) {
    if (!findUserByUsername(username)) {
      createUser(username, '123456', username, 1700000000000, '')
    }
  }
}

function createUser(username, password, nickname, createdAt = Date.now(), token = randomUUID()) {
  const salt = randomBytes(16).toString('hex')
  const passwordHash = hashPassword(password, salt)

  db.run(
    `
      INSERT INTO users (id, username, nickname, password_salt, password_hash, token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [username, username, nickname, salt, passwordHash, token, createdAt]
  )

  return findUserByUsername(username)
}

async function persistDatabase() {
  const data = db.export()
  await writeFile(dbFile, Buffer.from(data))
}

function findUserByUsername(username) {
  if (!username) return null
  return getSingleRow(
    `
      SELECT id, username, nickname, password_salt, password_hash, token, created_at
      FROM users
      WHERE username = ?
    `,
    [username]
  )
}

function getUserByToken(token) {
  if (!token) return null
  return getSingleRow(
    `
      SELECT id, username, nickname, password_salt, password_hash, token, created_at
      FROM users
      WHERE token = ?
    `,
    [token]
  )
}

function getUserByRequest(req) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  return getUserByToken(token)
}

function getConversationMessages(userId, targetId) {
  const rows = getRows(
    `
      SELECT id, from_user, to_user, type, content, timestamp, status, read
      FROM messages
      WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)
      ORDER BY timestamp ASC
    `,
    [userId, targetId, targetId, userId]
  )

  return rows.map(rowToMessage)
}

async function saveMessage(message) {
  const existing = getSingleRow('SELECT * FROM messages WHERE id = ?', [message.id])
  if (existing) {
    return rowToMessage(existing)
  }

  db.run(
    `
      INSERT INTO messages (id, from_user, to_user, type, content, timestamp, status, read)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      message.id,
      message.from,
      message.to,
      message.type,
      message.content,
      message.timestamp,
      message.status || 'sent',
      message.read ? 1 : 0
    ]
  )
  await persistDatabase()

  return message
}

function getSingleRow(sql, params = []) {
  const rows = getRows(sql, params)
  return rows[0] || null
}

function getRows(sql, params = []) {
  const statement = db.prepare(sql)
  try {
    statement.bind(params)
    const rows = []
    while (statement.step()) {
      rows.push(statement.getAsObject())
    }
    return rows
  } finally {
    statement.free()
  }
}

function rowToMessage(row) {
  return {
    id: String(row.id),
    from: String(row.from_user),
    to: String(row.to_user),
    type: String(row.type),
    content: String(row.content),
    timestamp: Number(row.timestamp),
    status: String(row.status),
    read: Boolean(row.read)
  }
}

function normalizeMessage(rawMessage, fromUserId) {
  const to = normalizeUsername(rawMessage?.to)
  const type = ['text', 'emoji', 'image'].includes(rawMessage?.type) ? rawMessage.type : 'text'
  const content = String(rawMessage?.content || '')

  if (!to || !content) return null

  return {
    id: String(rawMessage?.id || randomUUID()),
    from: fromUserId,
    to,
    type,
    content,
    timestamp: Number(rawMessage?.timestamp) || Date.now(),
    status: 'sent',
    read: Boolean(rawMessage?.read)
  }
}

function normalizeUsername(value) {
  return String(value || '').trim()
}

function normalizeNickname(value) {
  return String(value || '').trim()
}

function hashPassword(password, salt) {
  return createHash('sha256').update(`${salt}:${password}`).digest('hex')
}

function verifyPassword(password, salt, expectedHash) {
  return hashPassword(password, salt) === expectedHash
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname || user.username
  }
}

server.listen(PORT, () => {
  console.log(`QQChat server listening on http://localhost:${PORT}`)
})
