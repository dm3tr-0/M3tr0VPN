// Генерация иконок из логотипа public/m3tr0vpn-logo.png
// build/icon.png (512), build/icons/tray-*.png, resources не трогаем.
import sharp from 'sharp'
import { mkdirSync, existsSync, copyFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const logo = process.argv[2] || resolve(root, '../public/m3tr0vpn-logo.png')

if (!existsSync(logo)) {
  console.error(`[icons] logo not found: ${logo}`)
  process.exit(1)
}

const buildDir = resolve(root, 'build')
const iconsDir = resolve(buildDir, 'icons')
mkdirSync(iconsDir, { recursive: true })

// 1. Основная иконка приложения (512, с прозрачностью)
await sharp(logo)
  .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(resolve(buildDir, 'icon.png'))
console.log('[icons] build/icon.png (512)')

// 2. Иконки окна (256)
await sharp(logo).resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(resolve(iconsDir, 'icon-256.png'))

// 3. Иконки трея: слегка скруглённый квадрат с логотипом на тёмной плашке
for (const size of [16, 24, 32, 48]) {
  await sharp(logo)
    .resize(size, size, { fit: 'contain', background: { r: 7, g: 12, b: 10, alpha: 1 } })
    .png()
    .toFile(resolve(iconsDir, `tray-${size}.png`))
}
console.log('[icons] build/icons/{icon-256, tray-16/24/32/48}.png')

// 4. Копия для extraResources (resources/icons создаёт stage-core)
console.log('[icons] done')
