#!/usr/bin/env python3
"""
server.py
=========
Многопоточный HTTP-сервер для веб-терминала XAUUSDT со встроенным Watchdog (30 сек).
- Не зависает при долгих соединениях (ThreadingHTTPServer)
- Фоновый сторожевой таймер (Watchdog) проверяет отзывчивость каждые 30 секунд
- Запуск:
    python server.py
"""

import sys
import os
import time
import socket
import threading
import urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PORT = 8080
WATCHDOG_INTERVAL_SEC = 30

class DashboardHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Отключаем агрессивный кэш браузера для мгновенного обновления изменений
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args):
        # Компактный лог запросов
        pass

def watchdog_worker(stop_event):
    """Фоновый сторожевой таймер: каждые 30 сек проверяет локальный HTTP-сервер"""
    time.sleep(3)
    url = f"http://127.0.0.1:{PORT}/index.html"
    print(f"[*] Watchdog активирован: проверка каждые {WATCHDOG_INTERVAL_SEC} сек.", flush=True)

    while not stop_event.is_set():
        stop_event.wait(WATCHDOG_INTERVAL_SEC)
        if stop_event.is_set():
            break

        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Watchdog/1.0"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    pass # Сервер здоров и отвечает
                else:
                    print(f"[!] [WATCHDOG ALARM] Сервер вернул код {resp.status}!", flush=True)
        except Exception as e:
            print(f"[!] [WATCHDOG WARNING] Задержка ответа сервера: {e}", flush=True)

def main():
    dashboard_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(dashboard_dir)

    ThreadingHTTPServer.allow_reuse_address = True
    server = ThreadingHTTPServer(("0.0.0.0", PORT), DashboardHandler)
    server.daemon_threads = True

    url = f"http://localhost:{PORT}/index.html"
    print("=" * 65, flush=True)
    print(f"  XAUUSDT GOLD STRATEGY TERMINAL ЗАПУЩЕН (Threading + Watchdog 30s)", flush=True)
    print(f"  URL: {url}", flush=True)
    print("=" * 65, flush=True)

    stop_event = threading.Event()
    wd_thread = threading.Thread(target=watchdog_worker, args=(stop_event,), daemon=True)
    wd_thread.start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[!] Остановка сервера по Ctrl+C...", flush=True)
    except Exception as exc:
        print(f"\n[!] Ошибка в serve_forever: {exc}", flush=True)
    finally:
        stop_event.set()
        server.server_close()
        print("[✓] Сервер остановлен.", flush=True)

if __name__ == "__main__":
    main()
