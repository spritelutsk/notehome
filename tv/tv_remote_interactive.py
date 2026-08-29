#!/usr/bin/env python3
"""Интерактивный пульт управления Android TV с визуальными кнопками в терминале.

Эта программа создает удобный интерфейс пульта дистанционного управления
с навигацией стрелками и визуальными кнопками.
"""

import asyncio
import os
import sys
import curses
from androidtvremote2 import AndroidTVRemote

# Конфигурация
HOST = os.environ.get("TV_HOST", "192.168.1.106")
BASE = os.path.dirname(os.path.abspath(__file__))
CERT = os.path.join(BASE, "cert.pem")
KEY = os.path.join(BASE, "key.pem")


class TVRemoteCurses:
    def __init__(self, stdscr):
        self.stdscr = stdscr
        self.remote = None
        self.setup_colors()
        self.init_curses()

    def setup_colors(self):
        """Настройка цветов для интерфейса."""
        curses.start_color()
        curses.use_default_colors()
        curses.init_pair(1, curses.COLOR_GREEN, -1)    # Активные элементы
        curses.init_pair(2, curses.COLOR_RED, -1)      # Ошибки/выключено
        curses.init_pair(3, curses.COLOR_YELLOW, -1)   # Предупреждения
        curses.init_pair(4, curses.COLOR_CYAN, -1)     # Информация
        curses.init_pair(5, curses.COLOR_MAGENTA, -1)  # Выделение
        curses.init_pair(6, curses.COLOR_WHITE, -1)    # Обычный текст

    def init_curses(self):
        """Инициализация curses."""
        curses.curs_set(0)  # Скрыть курсор
        self.stdscr.clear()
        self.stdscr.refresh()

    async def init_remote(self):
        """Инициализация подключения к телевизору."""
        try:
            self.remote = AndroidTVRemote("tv-interactive-remote", CERT, KEY, HOST)

            # Генерируем сертификаты, если они отсутствуют
            await self.remote.async_generate_cert_if_missing()

            # Подключаемся к телевизору
            await self.remote.async_connect()
            self.remote.keep_reconnecting()

            return True
        except Exception as e:
            self.show_error(f"Не удается подключиться к телевизору: {e}")
            return False

    def show_error(self, message):
        """Отображение ошибки."""
        h, w = self.stdscr.getmaxyx()
        self.stdscr.attron(curses.color_pair(2))
        self.stdscr.addstr(h//2, max(0, (w - len(message))//2), message[:w-1])
        self.stdscr.attroff(curses.color_pair(2))
        self.stdscr.refresh()
        curses.napms(2000)

    def show_info(self, message, timeout=1500):
        """Отображение информационного сообщения."""
        h, w = self.stdscr.getmaxyx()
        self.stdscr.attron(curses.color_pair(4))
        self.stdscr.addstr(h//2, max(0, (w - len(message))//2), message[:w-1])
        self.stdscr.attroff(curses.color_pair(4))
        self.stdscr.refresh()
        curses.napms(timeout)

    def draw_border(self):
        """Рисование рамки интерфейса."""
        self.stdscr.border(0)
        h, w = self.stdscr.getmaxyx()

        # Заголовок
        title = " ИНТЕРАКТИВНЫЙ ПУЛЬТ УПРАВЛЕНИЯ ANDROID TV "
        self.stdscr.attron(curses.color_pair(5) | curses.A_BOLD)
        self.stdscr.addstr(0, max(0, (w - len(title))//2), title)
        self.stdscr.attroff(curses.color_pair(5) | curses.A_BOLD)

        # Информация о подключении
        if self.remote:
            try:
                status = "ВКЛ" if self.remote.is_on else "ВЫКЛ"
                app = self.remote.current_app or "НЕ АКТИВНО"
                device_info = f"{getattr(self.remote.device_info, 'manufacturer', 'Неизвестно')} {getattr(self.remote.device_info, 'model', '')}"

                info_line = f"Телевизор: {status} | Приложение: {app[:20]} | {device_info}"
                self.stdscr.attron(curses.color_pair(4))
                self.stdscr.addstr(1, 2, info_line[:w-3])
                self.stdscr.attroff(curses.color_pair(4))
            except:
                self.stdscr.attron(curses.color_pair(2))
                self.stdscr.addstr(1, 2, "Ошибка получения информации о телевизоре")
                self.stdscr.attroff(curses.color_pair(2))

        # Инструкция
        instr = " Используйте стрелки для навигации, Enter - OK, q - выход "
        self.stdscr.attron(curses.color_pair(6))
        self.stdscr.addstr(h-2, max(0, (w - len(instr))//2), instr)
        self.stdscr.attroff(curses.color_pair(6))

        self.stdscr.refresh()

    def draw_buttons(self):
        """Рисование виртуальных кнопок пульта."""
        h, w = self.stdscr.getmaxyx()

        # Очищаем рабочую область
        for i in range(3, h-2):
            self.stdscr.addstr(i, 2, " " * (w-4))

        # Начальная позиция для кнопок
        start_y = 4
        button_width = 10
        button_height = 3
        gap = 2

        # Первый ряд - управление питанием и меню
        power_y = start_y
        self.stdscr.addstr(power_y, (w - button_width)//2, " ПИТАНИЕ ",
                          curses.color_pair(1) | curses.A_BOLD)

        menu_y = power_y + button_height + gap
        self.stdscr.addstr(menu_y, (w - button_width)//2 - button_width - gap, " МЕНЮ ",
                          curses.color_pair(1))
        home_y = menu_y
        self.stdscr.addstr(home_y, (w - button_width)//2, " ДОМОЙ ",
                          curses.color_pair(1))
        back_y = menu_y
        self.stdscr.addstr(back_y, (w - button_width)//2 + button_width + gap, " НАЗАД ",
                          curses.color_pair(1))

        # Второй ряд - навигация
        nav_start_y = menu_y + button_height + gap

        # Верхняя стрелка
        up_y = nav_start_y
        self.stdscr.addstr(up_y, (w - button_width)//2, " △ ",
                          curses.color_pair(3) | curses.A_BOLD)

        # Средний ряд навигации
        mid_y = up_y + button_height + gap
        self.stdscr.addstr(mid_y, (w - 3*button_width - 2*gap)//2, " ◀ ",
                          curses.color_pair(3) | curses.A_BOLD)
        self.stdscr.addstr(mid_y, (w - button_width)//2, " ● ",
                          curses.color_pair(3) | curses.A_BOLD)
        self.stdscr.addstr(mid_y, (w + button_width)//2 + gap, " ▶ ",
                          curses.color_pair(3) | curses.A_BOLD)

        # Нижняя стрелка
        down_y = mid_y + button_height + gap
        self.stdscr.addstr(down_y, (w - button_width)//2, " ▽ ",
                          curses.color_pair(3) | curses.A_BOLD)

        # Третий ряд - управление воспроизведением и громкостью
        control_start_y = down_y + button_height + gap

        # Управление воспроизведением
        play_y = control_start_y
        self.stdscr.addstr(play_y, (w - 3*button_width - 2*gap)//2, " ■ ",
                          curses.color_pair(1))
        self.stdscr.addstr(play_y, (w - button_width)//2, " ▶❚❚ ",
                          curses.color_pair(1))
        self.stdscr.addstr(play_y, (w + button_width)//2 + gap, " ▶▶ ",
                          curses.color_pair(1))

        # Управление громкостью
        vol_y = play_y + button_height + gap
        self.stdscr.addstr(vol_y, (w - button_width)//2 - button_width - gap, " 🔇 ",
                          curses.color_pair(1))
        self.stdscr.addstr(vol_y, (w - button_width)//2, " 🔊+ ",
                          curses.color_pair(1))
        self.stdscr.addstr(vol_y, (w + button_width)//2 + gap, " 🔊- ",
                          curses.color_pair(1))

        self.stdscr.refresh()

    def handle_input(self, key):
        """Обработка ввода пользователя."""
        if key == ord('q') or key == ord('Q'):
            return False  # Выход

        if not self.remote:
            return True

        try:
            # Обработка клавиш управления
            if key == curses.KEY_UP:
                self.remote.send_key_command("DPAD_UP")
                self.show_info("▲ ВВЕРХ", 500)
            elif key == curses.KEY_DOWN:
                self.remote.send_key_command("DPAD_DOWN")
                self.show_info("▼ ВНИЗ", 500)
            elif key == curses.KEY_LEFT:
                self.remote.send_key_command("DPAD_LEFT")
                self.show_info("◀ ВЛЕВО", 500)
            elif key == curses.KEY_RIGHT:
                self.remote.send_key_command("DPAD_RIGHT")
                self.show_info("▶ ВПРАВО", 500)
            elif key in [curses.KEY_ENTER, 10, 13]:  # Enter
                self.remote.send_key_command("DPAD_CENTER")
                self.show_info("● OK", 500)
            elif key == ord('h') or key == ord('H'):
                self.remote.send_key_command("HOME")
                self.show_info("⌂ ДОМОЙ", 500)
            elif key == ord('b') or key == ord('B'):
                self.remote.send_key_command("BACK")
                self.show_info("← НАЗАД", 500)
            elif key == ord('p') or key == ord('P'):
                self.remote.send_key_command("POWER")
                self.show_info("⏻ ПИТАНИЕ", 500)
            elif key == ord('v') or key == ord('V'):
                self.remote.send_key_command("VOLUME_UP")
                self.show_info("🔊 ГРОМКОСТЬ +", 500)
            elif key == ord('m') or key == ord('M'):
                self.remote.send_key_command("VOLUME_DOWN")
                self.show_info("🔊 ГРОМКОСТЬ -", 500)
            elif key == ord('s') or key == ord('S'):
                self.remote.send_key_command("MUTE")
                self.show_info("🔇 ЗВУК", 500)
            elif key == ord(' ') or key == 32:  # Пробел для play/pause
                self.remote.send_key_command("MEDIA_PLAY_PAUSE")
                self.show_info("▶❚❚ ВОСПРОИЗВЕДЕНИЕ", 500)
            elif key == ord('n') or key == ord('N'):
                self.remote.send_key_command("MEDIA_NEXT")
                self.show_info("▶▶ СЛЕДУЮЩИЙ", 500)
            elif key == ord('e') or key == ord('E'):  # Предыдущий track
                self.remote.send_key_command("MEDIA_PREVIOUS")
                self.show_info("◀◂ ПРЕДЫДУЩИЙ", 500)
            elif key == ord('S') or key == 83:  # Стоп (Shift+S)
                self.remote.send_key_command("MEDIA_STOP")
                self.show_info("■ СТОП", 500)

        except Exception as e:
            self.show_error(f"Ошибка отправки команды: {e}")

        return True

    async def run(self):
        """Основной цикл программы."""
        if not await self.init_remote():
            return

        try:
            while True:
                self.stdscr.clear()
                self.draw_border()
                self.draw_buttons()

                # Ожидание ввода с таймаутом для обновления информации
                self.stdscr.timeout(100)  # 100ms
                key = self.stdscr.getch()

                if key != -1:  # Если была нажата клавиша
                    if not self.handle_input(key):
                        break

                    # Небольшая задержка для визуальной обратной связи
                    await asyncio.sleep(0.1)
                else:
                    # Обновляем информацию о состоянии телевизора периодически
                    await asyncio.sleep(0.5)

        except KeyboardInterrupt:
            pass
        except Exception as e:
            self.show_error(f"Критическая ошибка: {e}")
        finally:
            if self.remote:
                self.remote.disconnect()
            curses.endwin()


def main():
    """Главная функция."""
    try:
        # Проверяем наличие необходимых файлов
        if not os.path.exists(CERT) or not os.path.exists(KEY):
            print("Ошибка: Не найдены файлы сертификатов.")
            print("Сначала выполните сопряжение с телевизором:")
            print("  python pair.py")
            sys.exit(1)

        # Запускаем интерфейс curses
        curses.wrapper(lambda stdscr: asyncio.run(TVRemoteCurses(stdscr).run()))

    except Exception as e:
        print(f"Ошибка запуска: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()