#!/usr/bin/env python3
"""Спаривание с Android TV по протоколу Remote v2.

Запускает сессию спаривания (на телевизоре появляется PIN), ждёт, пока код
положат в файл pin.txt, завершает спаривание и сохраняет сертификат.
"""
import asyncio
import os
import sys

from androidtvremote2 import AndroidTVRemote

HOST = os.environ.get("TV_HOST", "192.168.1.106")
BASE = os.path.dirname(os.path.abspath(__file__))
CERT = os.path.join(BASE, "cert.pem")
KEY = os.path.join(BASE, "key.pem")
PIN_FILE = os.path.join(BASE, "pin.txt")


async def wait_for_pin(timeout=300):
    for _ in range(timeout * 2):
        if os.path.exists(PIN_FILE):
            pin = open(PIN_FILE).read().strip()
            if len(pin) >= 4:
                os.remove(PIN_FILE)
                return pin
        await asyncio.sleep(0.5)
    return None


async def main():
    remote = AndroidTVRemote("claude-code-pi", CERT, KEY, HOST)
    await remote.async_generate_cert_if_missing()

    name, mac = await remote.async_get_name_and_mac()
    print(f"Устройство: {name} ({mac})", flush=True)

    await remote.async_start_pairing()
    print("PIN показан на экране телевизора. Жду код в pin.txt…", flush=True)

    pin = await wait_for_pin()
    if not pin:
        print("Код так и не пришёл, выхожу.", flush=True)
        return 1

    print(f"Получил код {pin}, завершаю спаривание…", flush=True)
    await remote.async_finish_pairing(pin)
    print("Спаривание прошло, сертификат сохранён.", flush=True)

    await remote.async_connect()
    remote.keep_reconnecting()
    print(f"Подключился. Инфо: {remote.device_info}", flush=True)
    print(f"Включён: {remote.is_on}, приложение: {remote.current_app}, "
          f"громкость: {remote.volume_info}", flush=True)
    remote.disconnect()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
