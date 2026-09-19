// ============================================================
// Проверка механизма замера пинга: Electron net.request через
// session-прокси на локальный sing-box (mixed-инбаунд).
// Это ровно тот путь, что использует src/main/latency.ts.
// Запуск: DISPLAY=:99 ./node_modules/.bin/electron scripts/test-latency-fetch.js --no-sandbox
// ============================================================

const { app, net, session } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const SB = path.join(__dirname, '..', 'core', 'linux', 'sing-box')
const TMP = path.join(__dirname, '..', '.tmp-sb')
const PROXY_PORT = 18481

function fail(msg) {
  console.log(`[latency-fetch] FAIL: ${msg}`)
  process.exit(1)
}

app.whenReady().then(() => {
  fs.mkdirSync(TMP, { recursive: true })
  const cfgPath = path.join(TMP, 'latency-fetch-proxy.json')
  fs.writeFileSync(
    cfgPath,
    JSON.stringify(
      {
        log: { level: 'warn' },
        dns: { servers: [{ type: 'local', tag: 'local' }] },
        inbounds: [{ type: 'mixed', tag: 'test-in', listen: '127.0.0.1', listen_port: PROXY_PORT }],
        outbounds: [{ type: 'direct', tag: 'direct' }],
        route: { final: 'direct', default_domain_resolver: { server: 'local' } }
      },
      null,
      2
    )
  )

  const child = spawn(SB, ['run', '-c', cfgPath], { stdio: ['ignore', 'pipe', 'pipe'] })
  let coreLog = ''
  child.stdout.on('data', (d) => (coreLog += d))
  child.stderr.on('data', (d) => (coreLog += d))

  const waitPort = (port, timeoutMs) =>
    new Promise((resolve, reject) => {
      const started = Date.now()
      const netMod = require('net')
      const attempt = () => {
        const s = netMod.connect({ port, host: '127.0.0.1' })
        s.once('connect', () => {
          s.destroy()
          resolve()
        })
        s.once('error', () => {
          s.destroy()
          if (Date.now() - started > timeoutMs) reject(new Error('port timeout'))
          else setTimeout(attempt, 120)
        })
      }
      attempt()
    })

  const hardTimer = setTimeout(() => fail('global timeout'), 20000)

  waitPort(PROXY_PORT, 8000)
    .then(async () => {
      const ses = session.fromPartition('m3tr0-latency-fetch', { cache: false })
      await ses.setProxy({ proxyRules: `http=127.0.0.1:${PROXY_PORT};https=127.0.0.1:${PROXY_PORT}` })
      const started = Date.now()
      return new Promise((resolve, reject) => {
        let settled = false
        const req = net.request({ url: 'http://example.com/', session: ses, redirect: 'manual' })
        const finish = (fn) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          try {
            req.abort()
          } catch {}
          fn()
        }
        const timer = setTimeout(() => finish(() => reject(new Error('fetch timeout'))), 8000)
        req.on('response', (res) => {
          const ms = Date.now() - started
          res.on('data', () => undefined)
          finish(() => resolve({ status: res.statusCode, ms }))
        })
        req.on('error', (err) => finish(() => reject(err)))
        req.end()
      })
    })
    .then(({ status, ms }) => {
      clearTimeout(hardTimer)
      if (status === 200) {
        console.log(`[latency-fetch] OK: HTTP ${status} через прокси-сессию за ${ms} мс`)
        child.kill('SIGKILL')
        process.exit(0)
      } else {
        fail(`HTTP ${status} (ожидали 200)`)
      }
    })
    .catch((err) => {
      clearTimeout(hardTimer)
      fail(`${err.message} | core: ${coreLog.split('\n').slice(-2).join(' | ').slice(0, 200)}`)
    })
})
