// Стейджинг ресурсов для electron-builder:
// копирует ядро Xray нужной платформы и иконки в resources/.
// Использование: node scripts/stage-core.mjs [windows|linux]
import { mkdirSync, cpSync, existsSync, rmSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const platform = process.argv[2] || (process.platform === 'win32' ? 'windows' : 'linux')

const coreSrc = resolve(root, 'core', platform)
const coreDst = resolve(root, 'resources', 'core')
const iconsSrc = resolve(root, 'build', 'icons')
const iconsDst = resolve(root, 'resources', 'icons')

if (!existsSync(coreSrc)) {
  console.error(`[stage-core] core not found: ${coreSrc} (платформа ${platform})`)
  process.exit(1)
}

rmSync(resolve(root, 'resources'), { recursive: true, force: true })
mkdirSync(resolve(root, 'resources'), { recursive: true })

cpSync(coreSrc, coreDst, { recursive: true })
console.log(`[stage-core] ${coreSrc} -> ${coreDst}`)

if (existsSync(iconsSrc)) {
  cpSync(iconsSrc, iconsDst, { recursive: true })
  console.log(`[stage-core] ${iconsSrc} -> ${iconsDst}`)
}
console.log('[stage-core] done')
