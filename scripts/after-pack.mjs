// ============================================================
// electron-builder afterPack: фирменная иконка и версия exe
// БЕЗ wine — чистый JS (resedit + png-to-ico + sharp).
// Работает для Windows-сборки, запускается сразу после pack,
// до архивирования в zip.
// ============================================================

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { NtExecutable, NtExecutableResource, Data, Resource } from 'resedit'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

/** PNG-набор для .ico (Vista+ понимает PNG-записи в ICO) */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return
  }
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  if (!fs.existsSync(exePath)) {
    console.log(`[after-pack] exe not found: ${exePath}`)
    return
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))
  const logo = path.join(root, 'build', 'icon.png')
  if (!fs.existsSync(logo)) {
    console.log('[after-pack] build/icon.png not found — пропускаю патч иконки')
    return
  }

  // 1) Генерируем PNG-набор → .ico (в памяти)
  const pngBuffers = await Promise.all(
    ICO_SIZES.map((size) =>
      sharp(logo)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    )
  )
  const icoBuffer = Buffer.from(await pngToIco(pngBuffers))

  // 2) Патчим exe
  const exe = NtExecutable.from(fs.readFileSync(exePath))
  const res = NtExecutableResource.from(exe)

  // 2a) Иконки: заменяем группу ID=1 (главная иконка приложения)
  const iconFile = Data.IconFile.from(
    icoBuffer.buffer.slice(icoBuffer.byteOffset, icoBuffer.byteOffset + icoBuffer.byteLength)
  )
  const iconDatas = iconFile.icons.map((i) => i.data)
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 0, iconDatas)

  // 2b) Версия и описание файла
  const [major, minor, patch] = (pkg.version || '1.0.0').split('.').map((v) => parseInt(v, 10) || 0)
  const vi = Resource.VersionInfo.createEmpty()
  vi.fixedInfo.fileVersionMS = (major << 16) | (minor & 0xffff)
  vi.fixedInfo.fileVersionLS = (patch << 16) | 0
  vi.fixedInfo.productVersionMS = (major << 16) | (minor & 0xffff)
  vi.fixedInfo.productVersionLS = (patch << 16) | 0
  vi.fixedInfo.fileOS = 0x40004 // Windows NT
  vi.fixedInfo.fileType = 1 // Application
  vi.setStringValues(
    { lang: 0x409, codepage: 1200 },
    {
      CompanyName: 'dm3tr0',
      ProductName: 'M3tr0VPN',
      FileDescription: 'M3tr0VPN — простой VPN-клиент (Xray + sing-box)',
      FileVersion: pkg.version,
      ProductVersion: pkg.version,
      OriginalFilename: 'M3tr0VPN.exe',
      LegalCopyright: `Copyright (c) ${new Date().getFullYear()} dm3tr0`
    }
  )
  vi.outputToResourceEntries(res.entries)

  res.outputResource(exe)
  fs.writeFileSync(exePath, Buffer.from(exe.generate()))
  console.log(`[after-pack] icon + version patched: ${exePath}`)
}
