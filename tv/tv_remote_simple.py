#!/usr/bin/env python3
"""Упрощенный интерактивный пульт управления Android TV.

Эта версия работает в обычном терминале и предоставляет
мене-driven интерфейс с подсказками и визуальным представлением состояния.
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

# ANSI цвета для терминала
class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    MAGENTA = '\033[95m'
    CYAN = '\033[96m'
    WHITE = '\033[97m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'
    END = '\033[0m'

class TVRemoteSimple:
    def __init__(self):
        self.remote = None

    async def initialize(self):
        """Инициализация подключения к телевизору."""
        try:
            self.remote = AndroidTVRemote("tv-simple-remote", CERT, KEY, HOST)

            # Генерируем сертификаты, если они отсутствуют
            await self.remote.async_generate_cert_if_missing()

            # Подключаемся к телевизору
            await self.remote.async_connect()
            self.remote.keep_reconnecting()

            return True
        except Exception as e:
            print(f"{Colors.RED}Ошибка подключения к телевизору: {e}{Colors.END}")
            return False

    def print_header(self):
        """Печать заголовка интерфейса."""
        print(f"{Colors.MAGENTA}{Colors.BOLD}")
        print("╔═══════════════════════════════════════════════════════════════╗")
        print("║                    📺 ANDROID TV ПУЛЬТ                    ║")
        print("╠═══════════════════════════════════════════════════════════════╣")
        print(f"{Colors.END}")

    def print_tv_status(self):
        """Печать статуса телевизора."""
        if not self.remote:
            print(f"{Colors.RED}❌ Телевизор не подключен{Colors.END}")
            return

        try:
            status_text = f"{Colors.GREEN}🟢 ВКЛЮЧЕН{Colors.END}" if self.remote.is_on else f"{Colors.RED}🔴 ВЫКЛЮЧЕН{Colors.END}"
            app_text = self.remote.current_app or f"{Colors.YELLOW}НЕ АКТИВНО{Colors.END}"

            # Информация об устройстве
            device_info = "Неизвестное устройство"
            if self.remote.device_info:
                manufacturer = getattr(self.remote.device_info, 'manufacturer', '')
                model = getattr(self.remote.device_info, 'model', '')
                sw_version = getattr(self.remote.device_info, 'sw_version', '')
                device_info = f"{manufacturer} {model}".strip()
                if sw_version:
                    device_info += f" (Версия: {sw_version})"

            # Информация о громкости
            volume_text = f"{Colors.YELLOW}НЕДОСТУПНО{Colors.END}"
            if self.remote.volume_info:
                vol = self.remote.volume_info
                if vol.muted:
                    volume_text = f"{Colors.RED}🔇 ВЫКЛЮЧЕН{Colors.END}"
                else:
                    volume_text = f"🔊 {vol.level}/{vol.max}"

            print(f"{Colors.CYAN}📺 Телевизор: {status_text}{Colors.END}")
            print(f"{Colors.CYAN}📱 Приложение: {app_text}{Colors.END}")
            print(f"{Colors.CYAN}🏷️  Устройство: {device_info}{Colors.END}")
            print(f"{Colors.CYAN}🔊 Громкость: {volume_text}{Colors.END}")

        except Exception as e:
            print(f"{Colors.RED}⚠️  Ошибка получения статуса: {e}{Colors.END}")

    def print_controls(self):
        """Печать схемы управления."""
        print(f"{Colors.BLUE}{Colors.BOLD}")
        print("╠═══════════════════════════════════════════════════════════════╣")
        print("║                          УПРАВЛЕНИЕ                        ║")
        print("╠═══════════════════════════════════════════════════════════════╣")
        print(f"{Colors.END}")

        # Первый ряд - основные команды
        print(f"  {Colors.GREEN}p{Colors.END}ower     {Colors.YELLOW}h{Colors.END}ome     {Colors.RED}b{Colors.END}ack     {Colors.MAGENTA}i{Colors.END}nfo")
        print()

        # Второй ряд - навигация
        print(f"              {Colors.YELLOW}↑{Colors.END} (w/кр.стрелка вверх)")
        print(f"  {Colors.YELLOW}←{Colors.END} (a/кр.стрелка влево)  {Colors.GREEN}o{Colors.END}k  {Colors.YELLOW}→{Colors.END} (d/кр.стрелка вправо)")
        print(f"              {Colors.YELLOW}↓{Colors.END} (s/кр.стрелка вниз)")
        print()

        # Третий ряд - громкость и мут
        print(f"  {Colors.CYAN}v{Colors.END}ol+    {Colors.CYAN}m{Colors.END}ute    {Colors.CYAN}v{Colors.END}ol-")
        print()

        # Четвертый ряд - медиа управление
        print(f"  {Colors.YELLOW}◼{Colors.END} stop   {Colors.GREEN}▶❚❚{Colors.END} play/pause   {Colors.YELLOW}▶▶{Colors.END} next   {Colors.YELLOW}◀◀{Colors.END} prev")
        print()

        # Пятый ряд - текст и приложения
        print(f"  {Colors.BLUE}t{Colors.END}ext <сообщение>     {Colors.BLUE}l{Colors.END}aunch <app_id>")
        print()

        # Инструкция
        print(f"  {Colors.WHITE}q{Colors.END}uit                    {Colors.WHITE}?{Colors.END}elp")
        print(f"{Colors.MAGENTA}{Colors.BOLD}")
        print("╚═══════════════════════════════════════════════════════════════╝")
        print(f"{Colors.END}")

    async def send_command(self, key_code, description):
        """Отправка команды на телевизор."""
        if not self.remote:
            print(f"{Colors.RED}❌ Нет подключения к телевизору{Colors.END}")
            return False

        try:
            self.remote.send_key_command(key_code)
            print(f"{Colors.GREEN}✅ {description}{Colors.END}")
            return True
        except Exception as e:
            print(f"{Colors.RED}❌ Ошибка '{description}': {e}{Colors.END}")
            return False

    async def handle_command(self, command):
        """Обработка команды пользователя."""
        command = command.strip().lower()

        if not command:
            return True

        if command in ['q', 'quit', 'exit']:
            return False
        elif command in ['?', 'help']:
            self.print_header()
            self.print_tv_status()
            self.print_controls()
            return True
        elif command == 'p' or command == 'power':
            await self.send_command("POWER", "Переключение питания")
        elif command == 'h' or command == 'home':
            await self.send_command("HOME", "Кнопка Home")
        elif command == 'b' or command == 'back':
            await self.send_command("BACK", "Кнопка Назад")
        elif command == 'i' or command == 'info':
            await self.show_detailed_info()
        elif command == 'w' or command == 'up':
            await self.send_command("DPAD_UP", "Навигация Вверх")
        elif command == 's' or command == 'down':
            await self.send_command("DPAD_DOWN", "Навигация Вниз")
        elif command == 'a' or command == 'left':
            await self.send_command("DPAD_LEFT", "Навигация Влево")
        elif command == 'd' or command == 'right':
            await self.send_command("DPAD_RIGHT", "Навигация Вправо")
        elif command == 'o' or command == 'ok':
            await self.send_command("DPAD_CENTER", "Подтверждение (OK)")
        elif command == 'v' or command == 'vol+':
            await self.send_command("VOLUME_UP", "Увеличение громкости")
        elif command == 'm' or command == 'mute':
            await self.send_command("MUTE", "Переключение mute")
        elif command == 'V' or command == 'vol-':
            await self.send_command("VOLUME_DOWN", "Уменьшение громкости")
        elif command == ' ' or command == 'space' or command == 'play':
            await self.send_command("MEDIA_PLAY_PAUSE", "Воспроизведение/Пауза")
        elif command == 'x' or command == 'stop':
            await self.send_command("MEDIA_STOP", "Остановка")
        elif command == 'n' or command == 'next':
            await self.send_command("MEDIA_NEXT", "Следующий трек")
        elif command == 'e' or command == 'prev':
            await self.send_command("MEDIA_PREVIOUS", "Предыдущий трек")
        elif command.startswith('text '):
            text = command[5:].strip()
            if text:
                await self.send_text(text)
            else:
                print(f"{Colors.YELLOW}⚠️  Укажите текст для отправки{Colors.END}")
        elif command.startswith('launch '):
            app_id = command[7:].strip()
            if app_id:
                await self.launch_app(app_id)
            else:
                print(f"{Colors.YELLOW}⚠️  Укажите ID приложения{Colors.END}")
        else:
            print(f"{Colors.RED}❓ Неизвестная команда: '{command}'. Введите 'help' для справки.{Colors.END}")

        return True

    async def send_text(self, text):
        """Отправка текста на телевизор."""
        if not self.remote:
            print(f"{Colors.RED}❌ Нет подключения к телевизору{Colors.END}")
            return

        try:
            self.remote.send_text(text)
            print(f"{Colors.GREEN}✅ Отправлен текст: '{text}'{Colors.END}")
        except Exception as e:
            print(f"{Colors.RED}❌ Ошибка отправки текста: {e}{Colors.END}")

    async def launch_app(self, app_id):
        """Запуск приложения на телевизоре."""
        if not self.remote:
            print(f"{Colors.RED}❌ Нет подключения к телевизору{Colors.END}")
            return

        try:
            self.remote.send_launch_app_command(app_id)
            print(f"{Colors.GREEN}✅ Запуск приложения: {app_id}{Colors.END}")
        except Exception as e:
            print(f"{Colors.RED}❌ Ошибка запуска приложения '{app_id}': {e}{Colors.END}")

    async def show_detailed_info(self):
        """Показать детальную информацию о телевизоре."""
        if not self.remote:
            print(f"{Colors.RED}❌ Нет подключения к телевизору{Colors.END}")
            return

        print(f"\n{Colors.CYAN}{Colors.BOLD}📊 ДЕТАЛЬНАЯ ИНФОРМАЦИЯ О ТЕЛЕВИЗОРЕ{Colors.END}")
        print("-" * 50)

        try:
            print(f"Состояние питания:     {'ВКЛЮЧЕН' if self.remote.is_on else 'ВЫКЛЮЧЕН'}")
            print(f"Текущее приложение:    {self.remote.current_app or 'Не активно'}")

            if self.remote.device_info:
                info = self.remote.device_info
                print(f"Производитель:         {getattr(info, 'manufacturer', 'Неизвестно')}")
                print(f"Модель:                {getattr(info, 'model', 'Неизвестно')}")
                print(f"Версия ПО:             {getattr(info, 'sw_version', 'Неизвестно')}")

            if self.remote.volume_info:
                vol = self.remote.volume_info
                print(f"Громкость:             {vol.level}/{vol.max}")
                print(f"Статус мут:            {'ВКЛ' if vol.muted else 'ВЫКЛ'}")

        except Exception as e:
            print(f"{Colors.RED}Ошибка получения информации: {e}{Colors.END}")

        print("-" * 50)

    async def run_interactive(self):
        """Основной цикл интерактивного режима."""
        if not await self.initialize():
            return

        try:
            while True:
                self.print_header()
                self.print_tv_status()
                self.print_controls()

                try:
                    command = input(f"{Colors.CYAN}Введите команду: {Colors.END}").strip()

                    if not await self.handle_command(command):
                        break  # Пользователь выбрал выход

                    # Короткая пауза перед следующим обновлением экрана
                    await asyncio.sleep(0.3)

                except KeyboardInterrupt:
                    print(f"\n{Colors.YELLOW}=={Colors.END} Получен сигнал прерывания. Выход...")
                    break
                except EOFError:
                    print(f"\n{Colors.YELLOW}=={Colors.END} Получен EOF. Выход...")
                    break

        finally:
            if self.remote:
                self.remote.disconnect()
            print(f"{Colors.GREEN}👋 Соединение с телевизором закрыто. До свидания!{Colors.END}")


def print_banner():
    """Печать баннера при запуске."""
    print(f"{Colors.MAGENTA}{Colors.BOLD}")
    print("╔═══════════════════════════════════════════════════════════════╗")
    print("║                     📺 ANDROID TV ПУЛЬТ v1.0              ║")
    print("║                Интерактивное управление телевизором       ║")
    print("╚═══════════════════════════════════════════════════════════════╝")
    print(f"{Colors.END}")


def main():
    """Главная функция программы."""
    print_banner()

    # Проверяем presence of certificate files
    if not os.path.exists(CERT) or not os.path.exists(KEY):
        print(f"{Colors.RED}❌ Ошибка: Не найдены файлы сертификатов.{Colors.END}")
        print(f"{Colors.YELLOW}💡 Сначала выполните сопряжение с телевизором:{Colors.END}")
        print(f"   {Colors.CYAN}python pair.py{Colors.END}")
        print(f"{Colors.YELLOW}📍 Убедитесь, что файлы {cert.pem} и {key.pem} находятся в текущей директории.{Colors.END}")
        sys.exit(1)

    try:
        # Запускаем интерактивный режим
        remote = TVRemoteSimple()
        asyncio.run(remote.run_interactive())
    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}=={Colors.END} Программа прервана пользователем")
    except Exception as e:
        print(f"{Colors.RED}💥 Критическая ошибка: {e}{Colors.END}")
        sys.exit(1)


if __name__ == "__main__":
    main()