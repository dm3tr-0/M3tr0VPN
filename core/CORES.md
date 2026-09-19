# Ядра M3tr0VPN

Приложение использует два ядра. Бинарники не входят в source.zip —
скачайте их и положите в `core/<платформа>/`:

| Файл | Windows | Linux |
|---|---|---|
| Xray-core 26.9.9 | `core/windows/xray.exe` | `core/linux/xray` |
| sing-box 1.14.0-extended-2.7.1 | `core/windows/sing-box.exe` | `core/linux/sing-box` |

Xray 26.9.9 — версия серверов 3x-ui пользователя (совпадение версий
клиента и сервера важно для XHTTP/REALITY): Hysteria2 (`protocol:
"hysteria"`, `settings.version: 2`) и WireGuard работают на Xray
нативно; sing-box в приложении нужен только для Hysteria(v1)/TUIC/
AmneziaWG (включая AWG-2.0 I1–I5 и AWG-2.1+ header_protection_key/тайминги — их нет в 2.6.5).

## Где скачать

- **Xray-core** (официальный): https://github.com/XTLS/Xray-core/releases
  — архив `Xray-windows-64.zip` / `Xray-linux-64.zip`, внутри бинарник,
  `geoip.dat`, `geosite.dat` (положите их рядом).
- **sing-box-extended** (форк с поддержкой AmneziaWG — нужен для
  Hysteria(v1)/TUIC/AmneziaWG, а также как резервное ядро для ссылок
  с `insecure=1` без pinSHA256, которые Xray 26.x принять не может):
  https://github.com/shtorm-7/sing-box-extended/releases
  — архив `sing-box-<version>-windows-amd64.zip` / `...-linux-amd64.tar.gz`.
- Официальный sing-box (без AmneziaWG): https://github.com/SagerNet/sing-box/releases

Windows-дополнительно: `wintun.dll` (из архива Xray или с
https://git.zx2c4.com/wintun) — `core/windows/wintun.dll`.

## Проверка

```bash
cd desktop
bun install
bun run typecheck && bun run build
bun run test:xray && bun run test:singbox
bun run dist:win   # или dist:linux
```
