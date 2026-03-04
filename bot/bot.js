const mineflayer = require('mineflayer')
const axios = require('axios')
const express = require('express')
const path = require('path')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalFollow, GoalNear, GoalBlock } = goals

const HOSTILE_MOBS = [
  'zombie', 'skeleton', 'spider', 'creeper', 'witch',
  'drowned', 'husk', 'phantom', 'stray', 'zombie_villager'
]

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'Nemobot',
  version: '1.21.11'
})

bot.loadPlugin(pathfinder)

const BRAIN_URL = 'http://localhost:5005/ask'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ========== 斧管理 ==========
const AXE_NAMES = ['wooden_axe', 'stone_axe', 'iron_axe', 'golden_axe', 'diamond_axe', 'netherite_axe']

function isAxe(item) {
  return AXE_NAMES.includes(item.name)
}

async function equipAxe() {
  const axe = bot.inventory.items().find(isAxe)
  if (axe) {
    try { await bot.equip(axe, 'hand') } catch (e) { /* ignore */ }
  }
}

// ========== 停止フラグ ==========
let stopped = false

// ========== ATTACK (単体) ==========
let currentAttack = null

async function attackEntity(entityName) {
  const target = bot.nearestEntity(e => e.name === entityName)
  if (!target) {
    bot.chat(`${entityName} が見つかりません。`)
    return
  }
  await equipAxe()
  bot.chat(`${entityName} を攻撃します!`)
  bot.pathfinder.setGoal(new GoalFollow(target, 2), true)

  if (currentAttack) clearInterval(currentAttack)
  currentAttack = setInterval(() => {
    const t = bot.nearestEntity(e => e.name === entityName)
    if (!t || !t.isValid) {
      clearInterval(currentAttack)
      currentAttack = null
      bot.pathfinder.setGoal(null)
      bot.chat('倒しました!')
      return
    }
    if (bot.entity.position.distanceTo(t.position) < 4) {
      bot.attack(t)
    }
  }, 500)

  setTimeout(() => {
    if (currentAttack) {
      clearInterval(currentAttack)
      currentAttack = null
      bot.pathfinder.setGoal(null)
    }
  }, 30000)
}

// ========== HUNT (複数狩り) ==========
async function huntAll(mobName) {
  let count = 0
  const target = bot.nearestEntity(e => e.name === mobName)
  if (!target) {
    bot.chat(`${mobName} が見つかりません。`)
    return
  }
  await equipAxe()
  bot.chat(`周りの ${mobName} を狩ります!`)

  while (count < 20 && !stopped) {
    const t = bot.nearestEntity(e => e.name === mobName && e.isValid)
    if (!t) break

    bot.pathfinder.setGoal(new GoalFollow(t, 2), true)
    let attempts = 0
    while (t.isValid && attempts < 30 && !stopped) {
      if (bot.entity.position.distanceTo(t.position) < 4) {
        bot.attack(t)
      }
      await sleep(500)
      attempts++
    }
    if (!t.isValid) count++
  }

  bot.pathfinder.setGoal(null)
  bot.chat(`${count}匹倒しました!`)
}

// ========== DIG_TREE ==========
async function digTree() {
  const logNames = [
    'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
    'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'
  ]
  const logIds = logNames
    .map(name => bot.registry.blocksByName[name]?.id)
    .filter(id => id !== undefined)

  const logBlock = bot.findBlock({ matching: logIds, maxDistance: 32 })
  if (!logBlock) {
    bot.chat('近くに木が見つかりません。')
    return
  }

  await equipAxe()
  bot.chat('木を切りに行きます!')
  try {
    await bot.pathfinder.goto(new GoalNear(logBlock.position.x, logBlock.position.y, logBlock.position.z, 1))
    // 幹を下から上に全部切る
    let block = logBlock
    let cut = 0
    while (block && logIds.includes(block.type) && !stopped) {
      await bot.dig(block)
      cut++
      block = bot.blockAt(block.position.offset(0, 1, 0))
    }
    bot.chat(`木を${cut}ブロック切りました!`)
  } catch (e) {
    console.error('Dig error:', e.message)
    bot.chat('うまくいきませんでした...')
  }
}

// ========== GUARD (ボディガード) ==========
let guardInterval = null

function startGuard(username) {
  const player = bot.players[username]?.entity
  if (!player) {
    bot.chat(`${username} が見つかりません。`)
    return
  }

  stopAllActions()
  bot.chat(`${username} をガードします! 敵が来たら倒します!`)

  guardInterval = setInterval(() => {
    const hostile = bot.nearestEntity(e =>
      e.type === 'mob' &&
      HOSTILE_MOBS.includes(e.name) &&
      bot.entity.position.distanceTo(e.position) < 16
    )

    if (hostile) {
      bot.pathfinder.setGoal(new GoalFollow(hostile, 2), true)
      if (bot.entity.position.distanceTo(hostile.position) < 4) {
        bot.attack(hostile)
      }
    } else {
      const p = bot.players[username]?.entity
      if (p) {
        bot.pathfinder.setGoal(new GoalFollow(p, 3), true)
      }
    }
  }, 500)
}

// ========== DANCE ==========
async function dance() {
  bot.chat('ダンスします!')
  for (let i = 0; i < 4; i++) {
    bot.setControlState('jump', true)
    await bot.look(i * Math.PI / 2, 0)
    await sleep(300)
    bot.setControlState('jump', false)
    bot.setControlState('sneak', true)
    await sleep(200)
    bot.setControlState('sneak', false)
    await sleep(200)
  }
  // スピン
  for (let i = 0; i < 16; i++) {
    await bot.look(i * Math.PI / 8, 0)
    bot.setControlState('jump', i % 4 === 0)
    await sleep(100)
  }
  bot.setControlState('jump', false)
  bot.chat('ダンス完了!')
}

// ========== LOOK_AROUND ==========
function lookAround() {
  const entities = Object.values(bot.entities)
  const nearby = entities.filter(e =>
    e !== bot.entity &&
    bot.entity.position.distanceTo(e.position) < 32
  )

  const players = nearby.filter(e => e.type === 'player').map(e => e.username)
  const mobs = nearby.filter(e => e.type === 'mob' || e.type === 'animal')

  const mobCounts = {}
  mobs.forEach(e => {
    mobCounts[e.name] = (mobCounts[e.name] || 0) + 1
  })

  let report = ''
  if (players.length > 0) report += `Players: ${players.join(', ')}. `

  const mobList = Object.entries(mobCounts).map(([name, count]) => `${name} x${count}`)
  if (mobList.length > 0) report += `Mobs: ${mobList.join(', ')}.`
  else report += 'Mobは見当たりません。'

  const pos = bot.entity.position
  report += ` (My pos: ${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`

  bot.chat(report)
}

// ========== GO_TO ==========
async function goToCoords(coordStr) {
  const parts = coordStr.replace(/,/g, ' ').trim().split(/\s+/).map(Number)
  if (parts.length < 3 || parts.some(isNaN)) {
    bot.chat('座標がわかりません。"GO_TO(100 64 200)" の形式で指定してください。')
    return
  }
  const [x, y, z] = parts
  bot.chat(`(${x}, ${y}, ${z}) に向かいます!`)
  try {
    await bot.pathfinder.goto(new GoalNear(x, y, z, 2))
    bot.chat('到着しました!')
  } catch (e) {
    bot.chat('たどり着けませんでした...')
  }
}

// ========== DIG_DOWN (階段掘り) ==========
async function digDown(depth) {
  const d = Math.min(parseInt(depth) || 5, 20)
  bot.chat(`${d}ブロック階段を掘ります!`)
  try {
    const startPos = bot.entity.position.clone()
    for (let i = 0; i < d && !stopped; i++) {
      // 足元と前方を掘る
      const below = bot.blockAt(bot.entity.position.offset(0, -1, 0))
      if (below && below.name !== 'air' && below.name !== 'bedrock') {
        await bot.dig(below)
      }
      // 前方(現在向いている方向)の壁を掘る
      const yaw = bot.entity.yaw
      const dx = -Math.sin(yaw)
      const dz = -Math.cos(yaw)
      const front = bot.blockAt(bot.entity.position.offset(Math.round(dx), -1, Math.round(dz)))
      if (front && front.name !== 'air' && front.name !== 'bedrock') {
        await bot.dig(front)
      }
      // 前方の頭の高さも掘る
      const frontHead = bot.blockAt(bot.entity.position.offset(Math.round(dx), 0, Math.round(dz)))
      if (frontHead && frontHead.name !== 'air' && frontHead.name !== 'bedrock') {
        await bot.dig(frontHead)
      }
      // 前に進む
      bot.setControlState('forward', true)
      await sleep(400)
      bot.setControlState('forward', false)
      await sleep(200)
    }
    bot.chat(`${d}ブロック掘りました!`)
  } catch (e) {
    console.error('Dig down error:', e.message)
    bot.chat('掘れませんでした...')
  }
}

// ========== COLLECT (アイテム拾い) ==========
async function collectItems() {
  const items = Object.values(bot.entities).filter(e =>
    e.name === 'item' && bot.entity.position.distanceTo(e.position) < 32
  )
  if (items.length === 0) {
    bot.chat('近くにアイテムが落ちていません。')
    return
  }
  bot.chat(`${items.length}個のアイテムを拾いに行きます!`)
  let collected = 0
  for (const item of items) {
    if (!item.isValid) continue
    try {
      await bot.pathfinder.goto(new GoalNear(item.position.x, item.position.y, item.position.z, 0))
      collected++
      await sleep(300)
    } catch (e) { /* skip unreachable */ }
  }
  await equipAxe()
  bot.chat(`${collected}個拾いました!`)
}

// ========== GIVE (プレイヤーに渡す) ==========
async function giveItems(username) {
  const items = bot.inventory.items()
  if (items.length === 0) {
    bot.chat('持ち物がありません。')
    return
  }
  let target = bot.players[username]?.entity
  if (!target) {
    target = bot.nearestEntity(e => e.type === 'player')
  }
  if (!target) {
    bot.chat('プレイヤーが見つかりません。')
    return
  }
  bot.chat(`${username} にアイテムを渡しに行きます!`)
  try {
    await bot.pathfinder.goto(new GoalNear(target.position.x, target.position.y, target.position.z, 2))
  } catch (e) { /* best effort */ }
  for (const item of bot.inventory.items()) {
    if (isAxe(item)) continue
    try { await bot.tossStack(item) } catch (e) { /* ignore */ }
  }
  bot.chat('渡しました!')
}

// ========== DROP_ITEMS ==========
async function dropItems() {
  const items = bot.inventory.items()
  if (items.length === 0) {
    bot.chat('持ち物がありません。')
    return
  }
  const toDrop = items.filter(item => !isAxe(item))
  if (toDrop.length === 0) {
    bot.chat('斧以外の持ち物がありません。')
    return
  }
  bot.chat(`${toDrop.length}種類のアイテムを落とします! (斧はキープ)`)
  for (const item of toDrop) {
    try {
      await bot.tossStack(item)
    } catch (e) { /* ignore */ }
  }
  bot.chat('全部落としました!')
}

// ========== STOP ALL ==========
function stopAllActions() {
  stopped = true
  if (currentAttack) {
    clearInterval(currentAttack)
    currentAttack = null
  }
  if (guardInterval) {
    clearInterval(guardInterval)
    guardInterval = null
  }
  bot.pathfinder.setGoal(null)
  bot.stopDigging()
  bot.setControlState('forward', false)
  bot.setControlState('jump', false)
  bot.setControlState('sneak', false)
}

// ========== SPAWN ==========
bot.once('spawn', () => {
  console.log('Nemobot has spawned!')
  const defaultMove = new Movements(bot)
  bot.pathfinder.setMovements(defaultMove)

  // 自動戦闘: 4ブロック以内の敵Mobを殴る
  setInterval(() => {
    if (currentAttack || guardInterval) return
    const hostile = bot.nearestEntity(e =>
      e.type === 'mob' &&
      HOSTILE_MOBS.includes(e.name) &&
      bot.entity.position.distanceTo(e.position) < 4
    )
    if (hostile) {
      bot.attack(hostile)
    }
  }, 500)
})

// ========== CHAT HANDLER ==========
bot.on('chat', async (username, message) => {
  if (username === bot.username) return

  console.log(`[${username}] ${message}`)

  try {
    const response = await axios.post(BRAIN_URL, {
      player: username,
      message: message
    })

    const { action, value, raw } = response.data
    console.log(`Action: ${action}, Value: ${value}`)

    if (raw) {
      const thoughtMatch = raw.match(/\[思考\](.*?)(\[|$)/s)
      if (thoughtMatch) console.log(`Thought: ${thoughtMatch[1].trim()}`)
    }

    executeAction(action, value, username)
  } catch (error) {
    console.error('Error:', error.message)
    bot.chat('エラーが起きちゃった。')
  }
})

bot.on('error', (err) => console.log('Bot Error:', err))
bot.on('kicked', (reason) => console.log('Bot Kicked:', reason))

// ========== チャットログ (Web UI用) ==========
const chatLog = []
const MAX_LOG = 100

function addChatLog(sender, text, type = 'chat') {
  chatLog.push({ sender, text, type, time: Date.now() })
  if (chatLog.length > MAX_LOG) chatLog.shift()
}

// ゲーム内チャットもログに残す
bot.on('chat', (username, message) => {
  addChatLog(username, message, username === bot.username ? 'bot' : 'player')
})

// ========== Express HTTP API ==========
const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, '..', 'chat')))

// チャットログ取得 (ポーリング用)
app.get('/api/log', (req, res) => {
  const since = parseInt(req.query.since) || 0
  const newMessages = chatLog.filter(m => m.time > since)
  res.json(newMessages)
})

// Web UIからのメッセージ送信
app.post('/api/chat', async (req, res) => {
  const { player, message } = req.body
  if (!message) return res.status(400).json({ error: 'message required' })

  const playerName = player || 'WebPlayer'
  addChatLog(playerName, message, 'player')

  try {
    // Web UI用は別の会話履歴キーを使う
    const response = await axios.post(BRAIN_URL, { player: 'web_' + playerName, message })
    const { action, value, raw } = response.data
    console.log(`[Web] ${playerName}: ${message} -> Action: ${action}, Value: ${value}`)

    // Web UIからのFOLLOW/GUARDはゲーム内プレイヤー名で実行
    executeAction(action, value, playerName)

    res.json({ action, value })
  } catch (error) {
    console.error('Web chat error:', error.message)
    res.status(500).json({ error: error.message })
  }
})

// アクション実行を共通関数に
function executeAction(action, value, username) {
  if (action !== 'STOP') stopped = false
  switch (action) {
    case 'FOLLOW': {
      // まずユーザー名で探す、なければ最寄りのプレイヤーに向かう
      let target = bot.players[username]?.entity
      if (!target) {
        const nearest = bot.nearestEntity(e => e.type === 'player')
        if (nearest) target = nearest
      }
      if (target) {
        bot.chat('そっちに行きます!')
        bot.pathfinder.setGoal(new GoalFollow(target, 2), true)
      } else {
        bot.chat('プレイヤーが見つかりません。')
      }
      break
    }
    case 'STOP':
      stopAllActions()
      bot.chat('止まりました。')
      break
    case 'ATTACK':
      attackEntity(value)
      break
    case 'HUNT':
      huntAll(value)
      break
    case 'DIG_TREE':
      digTree()
      break
    case 'DIG_DOWN':
      digDown(value)
      break
    case 'GUARD':
      startGuard(username)
      break
    case 'DANCE':
      dance()
      break
    case 'LOOK_AROUND':
      lookAround()
      break
    case 'GO_TO':
      goToCoords(value)
      break
    case 'DROP_ITEMS':
      dropItems()
      break
    case 'COLLECT':
      collectItems()
      break
    case 'GIVE':
      giveItems(username)
      break
    case 'CHAT':
    default:
      if (value) bot.chat(value)
      break
  }
}

app.listen(3001, '0.0.0.0', () => {
  console.log('Chat Web UI: http://0.0.0.0:3001')
})
