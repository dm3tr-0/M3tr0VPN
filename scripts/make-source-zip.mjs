// Сборка M3tr0VPN-<version>-source.zip: исходники без тяжёлых
// бинарников ядер (где их взять — см. core/CORES.md внутри архива).
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))

const out = path.join(root, '.release', `M3tr0VPN-${pkg.version}-source.zip`)
fs.mkdirSync(path.dirname(out), { recursive: true })
if (fs.existsSync(out)) fs.unlinkSync(out)

const include = [
  'src',
  'scripts',
  'build/icon.png',
  'build/icons',
  'core/CORES.md',
  'core/LICENSE-xray.txt',
  'core/LICENSE-singbox.txt',
  'package.json',
  'electron-builder.yml',
  'electron.vite.config.ts',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
  'README.md',
  'IPC.md'
]

const args = include
  .map((p) => `"${path.join(root, p)}"`)
  .join(' ')

execSync(`zip -r -q "${out}" ${args} -x "*.DS_Store"`, { stdio: 'inherit', cwd: root })
console.log(`[source-zip] ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`)
