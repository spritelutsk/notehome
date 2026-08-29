#!/usr/bin/env python3
"""Программа управления Android TV, имитирующая пульт дистанционного управления.

Эта программа позволяет отправлять команды на телевизор, аналогично обычному пульту:
- Управление питанием
- Навигация (вверх, вниз, влево, вправо, подтверждение)
- Управление громкостью
- Управление воспроизведением
- Запуск приложений
- Ввод текста
"""

import asyncio
import os
import sys
from androidtvremote2 import AndroidTVRemote

# Конфигурация
HOST = os.environ.get("TV_HOST", "192.168.1.106")
BASE = os.path.dirname(os.path.abspath(__file__))
CERT = os.path.join(BASE, "cert.pem")
KEY = os.path.join(BASE, "key.pem")


class TVRemote:
    def __init__(self):
        self.remote = AndroidTVRemote("tv-remote-control", CERT, KEY, HOST)

    async def initialize(self):
        """Инициализация подключения к телевизору."""
        try:
            # Генерируем сертификаты, если они отсутствуют
            cert_generated = await self.remote.async_generate_cert_if_missing()
            if cert_generated:
                print("Сгенерированы новые сертификаты для безопасного соединения")

            # Получаем информацию об устройстве
            name, mac = await self.remote.async_get_name_and_mac()
            print(f"Подключено к устройству: {name} ({mac})")

            # Подключаемся к телевизору
            await self.remote.async_connect()
            self.remote.keep_reconnecting()

            print(f"Состояние телевизора: {'Включен' if self.remote.is_on else 'Выключен'}")
            if self.remote.current_app:
                print(f"Текущее приложение: {self.remote.current_app}")
            if self.remote.volume_info:
                vol = self.remote.volume_info
                print(f"Громкость: {vol.level}/{vol.max} {'(выключено)' if vol.muted else ''}")

            return True

        except Exception as e:
            print(f"Ошибка подключения к телевизору: {e}")
            return False

    async def send_key(self, key_code, description):
        """Отправка клавиши на телевизор."""
        try:
            self.remote.send_key_command(key_code)
            print(f"Отправлено: {description}")
        except Exception as e:
            print(f"Ошибка отправки команды {description}: {e}")

    async def power_toggle(self):
        """Переключение питания."""
        await self.send_key("POWER", "Power toggle")

    async def navigate_up(self):
        """Навигация вверх."""
        await self.send_key("DPAD_UP", "Навигация вверх")

    async def navigate_down(self):
        """Навигация вниз."""
        await self.send_key("DPAD_DOWN", "Навигация вниз")

    async def navigate_left(self):
        """Навигация влево."""
        await self.send_key("DPAD_LEFT", "Навигация влево")

    async def navigate_right(self):
        """Навигация вправо."""
        await self.send_key("DPAD_RIGHT", "Навигация вправо")

    async def confirm(self):
        """Подтверждение выбора."""
        await self.send_key("DPAD_CENTER", "Подтверждение")

    async def back(self):
        """Кнопка назад."""
        await self.send_key("BACK", "Назад")

    async def home(self):
        """Кнопка home/меню."""
        await self.send_key("HOME", "Домой/Меню")

    async def volume_up(self):
        """Увеличение громкости."""
        await self.send_key("VOLUME_UP", "Громкость +")

    async def volume_down(self):
        """Уменьшение громкости."""
        await self.send_key("VOLUME_DOWN", "Громкость -")

    async def mute_toggle(self):
        """Переключение mute."""
        await self.send_key("MUTE", "Mute")

    async def media_play_pause(self):
        """Воспроизведение/пауза."""
        await self.send_key("MEDIA_PLAY_PAUSE", "Воспроизведение/Пауза")

    async def media_stop(self):
        """Остановка воспроизведения."""
        await self.send_key("MEDIA_STOP", "Стоп")

    async def media_next(self):
        """Следующий трек."""
        await self.send_key("MEDIA_NEXT", "Следующий трек")

    async def media_previous(self):
        """Предыдущий трек."""
        await self.send_key("MEDIA_PREVIOUS", "Предыдущий трек")

    async def launch_app(self, app_id):
        """Запуск приложения по ID."""
        try:
            self.remote.send_launch_app_command(app_id)
            print(f"Запуск приложения: {app_id}")
        except Exception as e:
            print(f"Ошибка запуска приложения {app_id}: {e}")

    async def send_text(self, text):
        """Отправка текста на телевизор."""
        try:
            self.remote.send_text(text)
            print(f"Отправлен текст: {text}")
        except Exception as e:
            print(f"Ошибка отправки текста: {e}")

    async def get_info(self):
        """Получение информации о телевизоре."""
        print("\n=== Информация о телевизоре ===")
        print(f"Состояние: {'Включен' if self.remote.is_on else 'Выключен'}")
        print(f"Приложение: {self.remote.current_app or 'Не активно'}")

        if self.remote.volume_info:
            vol = self.remote.volume_info
            status = "выключено" if vol.muted else f"{vol.level}/{vol.max}"
            print(f"Громкость: {status}")

        if self.remote.device_info:
            info = self.remote.device_info
            print(f"Устройство: {info.get('manufacturer', 'Неизвестно')} {info.get('model', '')}")
            print(f"Версия ПО: {info.get('sw_version', 'Неизвестно')}")
        print("=" * 30)

    def disconnect(self):
        """Отключение от телевизора."""
        self.remote.disconnect()
        print("Отключено от телевизора")


async def interactive_mode():
    """Интерактивное управление телевизором."""
    remote = TVRemote()

    if not await remote.initialize():
        return

    print("\n=== Управление телевизором ===")
    print("Доступные команды:")
    print("  power     - Переключить питание")
    print("  up        - Навигация вверх")
    print("  down      - Навигация вниз")
    print("  left      - Навигация влево")
    print("  right     - Навигация вправо")
    print("  ok        - Подтверждение")
    print("  back      - Назад")
    print("  home      - Домой/Меню")
    print("  vol+      - Увеличить громкость")
    print("  vol-      - Уменьшить громкость")
    print("  mute      - Переключить mute")
    print("  play      - Воспроизвести/Пауза")
    print("  stop      - Остановить")
    print("  next      - Следующий трек")
    print("  prev      - Предыдущий трек")
    print("  info      - Информация о телевизоре")
    print("  text <текст> - Отправить текст")
    print("  launch <app_id> - Запустить приложение")
    print("  quit      - Выйти")
    print("=" * 40)

    try:
        while True:
            command = input("\nВведите команду: ").strip().lower()

            if command == "quit" or command == "exit":
                break
            elif command == "power":
                await remote.power_toggle()
            elif command == "up":
                await remote.navigate_up()
            elif command == "down":
                await remote.navigate_down()
            elif command == "left":
                await remote.navigate_left()
            elif command == "right":
                await remote.navigate_right()
            elif command == "ok":
                await remote.confirm()
            elif command == "back":
                await remote.back()
            elif command == "home":
                await remote.home()
            elif command == "vol+":
                await remote.volume_up()
            elif command == "vol-":
                await remote.volume_down()
            elif command == "mute":
                await remote.mute_toggle()
            elif command == "play":
                await remote.media_play_pause()
            elif command == "stop":
                await remote.media_stop()
            elif command == "next":
                await remote.media_next()
            elif command == "prev":
                await remote.media_previous()
            elif command == "info":
                await remote.get_info()
            elif command.startswith("text "):
                text = command[5:]  # Убираем префикс "text "
                if text:
                    await remote.send_text(text)
                else:
                    print("Укажите текст для отправки")
            elif command.startswith("launch "):
                app_id = command[7:]  # Убираем префикс "launch "
                if app_id:
                    await remote.launch_app(app_id)
                else:
                    print("Укажите ID приложения для запуска")
            elif command == "":
                continue
            else:
                print(f"Неизвестная команда: {command}")
                print("Введите 'help' для списка команд")

    except KeyboardInterrupt:
        print("\nПрерывание работы...")
    finally:
        remote.disconnect()


def print_help():
    """Вывод справки по использованию."""
    print("""Программа управления Android TV - имитация пульта дистанционного управления

Использование:
  python tv_remote.py          - Запустить интерактивный режим
  python tv_remote.py <команда> - Выполнить одну команду и выйти

Примеры одиночных команд:
  python tv_remote.py power      - Переключить питание
  python tv_remote.py vol+       - Увеличить громкость
  python tv_remote.py home       - Нажать кнопку Домой
  python tv_remote.py info       - Показать информацию о телевизоре
  python tv_remote.py text "Привет" - Отправить текст на телевизор
  python tv_remote.py launch com.netflix.ninja - Запустить Netflix

Для получения списка доступных приложений смотрите настройки телевизора
или используйте специальные приложения для обнаружения установленных приложений.

Переменные окружения:
  TV_HOST - IP адрес телевизора (по умолчанию: 192.168.1.106)
""")


async def run_single_command(command):
    """Выполнение одной команды и выход."""
    remote = TVRemote()

    if not await remote.initialize():
        return 1

    try:
        command = command.lower()

        if command == "power":
            await remote.power_toggle()
        elif command == "up":
            await remote.navigate_up()
        elif command == "down":
            await remote.navigate_down()
        elif command == "left":
            await remote.navigate_left()
        elif command == "right":
            await remote.navigate_right()
        elif command == "ok":
            await remote.confirm()
        elif command == "back":
            await remote.back()
        elif command == "home":
            await remote.home()
        elif command == "vol+":
            await remote.volume_up()
        elif command == "vol-":
            await remote.volume_down()
        elif command == "mute":
            await remote.mute_toggle()
        elif command == "play":
            await remote.media_play_pause()
        elif command == "stop":
            await remote.media_stop()
        elif command == "next":
            await remote.media_next()
        elif command == "prev":
            await remote.media_previous()
        elif command == "info":
            await remote.get_info()
        elif command.startswith("text "):
            text = command[5:]
            if text:
                await remote.send_text(text)
            else:
                print("Ошибка: не указан текст для отправки")
                return 1
        elif command.startswith("launch "):
            app_id = command[7:]
            if app_id:
                await remote.launch_app(app_id)
            else:
                print("Ошибка: не указан ID приложения")
                return 1
        else:
            print(f"Ошибка: неизвестная команда '{command}'")
            print("Доступные команды: power, up, down, left, right, ok, back, home, vol+, vol-, mute, play, stop, next, prev, info, text, launch")
            return 1

        # Даем время на выполнение команды
        await asyncio.sleep(0.5)
        return 0

    finally:
        remote.disconnect()


def main():
    """Главная функция программы."""
    if len(sys.argv) > 1:
        # Выполнение одной команды
        command = " ".join(sys.argv[1:])
        result = asyncio.run(run_single_command(command))
        sys.exit(result)
    else:
        # Интерактивный режим
        try:
            asyncio.run(interactive_mode())
        except KeyboardInterrupt:
            print("\nПрограмма завершена пользователем")
        except Exception as e:
            print(f"Критическая ошибка: {e}")
            sys.exit(1)


if __name__ == "__main__":
    main()