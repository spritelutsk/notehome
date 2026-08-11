#!/usr/bin/env bash
#
# Ночная резервная копия SpriteNote на сетевой диск Windows.
#
# Запускается таймером spritenote-backup.timer в 9:00. Машина-приёмник — домашний компьютер,
# он включён не всегда, поэтому скрипт не падает, если её нет в сети, а ждёт: опрашивает
# SMB-порт раз в POLL_INTERVAL и, когда машина появилась, выжидает SETTLE_DELAY, прежде чем
# писать. Пауза не косметическая: сразу после включения Windows ещё поднимает службы и
# монтирует диски, и запись в этот момент может уйти в никуда.
#
# Копия делается только при изменившихся данных: копировать один и тот же слепок каждый день,
# вытесняя им единственную оставшуюся раннюю версию, — худшее, что может сделать бэкап.
#
# Секретов здесь нет. Параметры — в /etc/spritenote-backup.conf, учётные данные Windows —
# в /etc/spritenote-backup.auth (chmod 600), туда же смотрит smbclient сам, чтобы пароль
# не светился в списке процессов.
set -euo pipefail

CONF=${SPRITENOTE_BACKUP_CONF:-/etc/spritenote-backup.conf}
AUTH=${SPRITENOTE_BACKUP_AUTH:-/etc/spritenote-backup.auth}
PROJECT_DIR=${PROJECT_DIR:-/home/sergey/Documents/note}

# Куда класть отпечаток прошлой копии. Под systemd каталог создаёт StateDirectory=, вручную —
# берём то же место.
STATE_DIR=${STATE_DIRECTORY:-/var/lib/spritenote-backup}

# Значения по умолчанию; всё перекрывается из CONF.
SMB_HOST=192.168.1.100
SMB_SHARE=I
SMB_SUBDIR='архив notehome'
POLL_INTERVAL=600          # как часто проверять, появилась ли машина в сети — 10 минут
SETTLE_DELAY=300           # сколько ждать после появления, прежде чем писать — 5 минут
GIVE_UP_AFTER=$((13 * 3600))  # 9:00 + 13 часов: не дождались до 22:00 — попробуем завтра
KEEP=2                     # сколько копий держать на той стороне

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
die() { log "ОШИБКА: $*" >&2; exit 1; }

[ -r "$CONF" ] && . "$CONF"
[ -r "$AUTH" ] || die "нет файла с учётными данными: $AUTH"

# Порт, а не ping: Windows часто глушит ICMP, продолжая отдавать файлы. Нам важно не то,
# что машина отзывается, а то, что готова принять запись.
smb_reachable() {
  timeout 5 bash -c "cat < /dev/null > /dev/tcp/${SMB_HOST}/445" 2>/dev/null
}

smb() {
  smbclient "//${SMB_HOST}/${SMB_SHARE}" --authentication-file="$AUTH" -c "$1"
}

# Папка внутри ресурса нужна не всегда: если по сети отдан сразу нужный каталог, SMB_SUBDIR
# пуст, и никакого `cd` делать не надо — пустой `cd ""` smbclient считает ошибкой.
if [ -n "${SMB_SUBDIR:-}" ]; then
  CD="cd \"${SMB_SUBDIR}\"; "
  WHERE="//${SMB_HOST}/${SMB_SHARE}/${SMB_SUBDIR}"
else
  CD=""
  WHERE="//${SMB_HOST}/${SMB_SHARE}"
fi

# --- ждём машину -------------------------------------------------------------------------

waited=0
until smb_reachable; do
  if [ "$waited" -ge "$GIVE_UP_AFTER" ]; then
    log "машина ${SMB_HOST} так и не появилась за $((GIVE_UP_AFTER / 3600)) ч, копия не делалась"
    exit 0
  fi
  sleep "$POLL_INTERVAL"
  waited=$((waited + POLL_INTERVAL))
done
log "машина ${SMB_HOST} в сети (ждали $((waited / 60)) мин), пауза $((SETTLE_DELAY / 60)) мин"
sleep "$SETTLE_DELAY"

# За время паузы машину могли выключить обратно — тогда просто ждём дальше по тому же кругу.
until smb_reachable; do
  if [ "$waited" -ge "$GIVE_UP_AFTER" ]; then
    log "машина пропала во время паузы и больше не появилась, копия не делалась"
    exit 0
  fi
  log "машина пропала во время паузы, ждём снова"
  sleep "$POLL_INTERVAL"
  waited=$((waited + POLL_INTERVAL))
done

# --- собираем слепок ---------------------------------------------------------------------

[ -r "$PROJECT_DIR/.env" ] || die "не читается $PROJECT_DIR/.env"
# shellcheck disable=SC1091
. "$PROJECT_DIR/.env"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Пароль отдаём mysqldump файлом, а не аргументом: аргументы видны в ps любому пользователю.
umask 077
cat > "$WORK/my.cnf" <<EOF
[client]
host=${DB_HOST:-127.0.0.1}
user=${DB_USER}
password=${DB_PASSWORD}
EOF

# --single-transaction — снимок без блокировки таблиц, приложение продолжает работать.
# --skip-dump-date — иначе в шапке дампа стоит время выгрузки, и два одинаковых слепка
# отличались бы этой строкой, то есть «изменения» находились бы каждый день.
mysqldump --defaults-extra-file="$WORK/my.cnf" \
  --single-transaction --skip-dump-date \
  "${DB_NAME}" > "$WORK/dump.sql" || die "mysqldump не отработал"

# Отпечаток считаем по дампу и по списку загруженных файлов: документы лежат на диске,
# в базе от них только имена, и подменённый файл иначе остался бы незамеченным.
UPLOADS="$PROJECT_DIR/data/uploads"
{
  sha256sum "$WORK/dump.sql" | cut -d' ' -f1
  if [ -d "$UPLOADS" ]; then
    find "$UPLOADS" -type f -printf '%P %s %T@\n' | LC_ALL=C sort
  fi
} > "$WORK/signature.txt"
SIG=$(sha256sum "$WORK/signature.txt" | cut -d' ' -f1)

mkdir -p "$STATE_DIR"
LAST_SIG_FILE="$STATE_DIR/last.sig"
if [ -f "$LAST_SIG_FILE" ] && [ "$SIG" = "$(cat "$LAST_SIG_FILE")" ]; then
  log "данные не менялись с прошлой копии, ничего не отправляем"
  exit 0
fi

# --- пакуем и отправляем -----------------------------------------------------------------

STAMP=$(date '+%Y-%m-%d-%H%M')
ARCHIVE="notehome-${STAMP}.zip"

# ZIP, а не tar.gz: копия лежит на Windows, там архив открывается двойным кликом без
# стороннего архиватора.
#
# Два вызова, а не один: zip кладёт пути относительно текущего каталога, а дамп и uploads лежат
# в разных местах. Второй вызов дописывает в уже существующий архив, поэтому внутри получается
# dump.sql рядом с каталогом uploads, без путей от корня файловой системы.
( cd "$WORK" && zip -q "$ARCHIVE" dump.sql ) || die "не удалось собрать $ARCHIVE"
if [ -d "$UPLOADS" ]; then
  ( cd "$PROJECT_DIR/data" && zip -q -r "$WORK/$ARCHIVE" uploads ) \
    || die "не удалось добавить uploads в $ARCHIVE"
fi
log "собран $ARCHIVE ($(du -h "$WORK/$ARCHIVE" | cut -f1))"

# Каталог может не существовать при самом первом запуске; mkdir на существующем — не ошибка,
# поэтому его результат не проверяем, а проверяем следующую запись.
[ -n "$CD" ] && smb "mkdir \"${SMB_SUBDIR}\"" >/dev/null 2>&1 || true
smb "${CD}lcd ${WORK}; put ${ARCHIVE}" >/dev/null \
  || die "не удалось записать ${ARCHIVE} в ${WHERE}"
log "отправлено в ${WHERE}/${ARCHIVE}"

# Отпечаток запоминаем только после удачной отправки: иначе неудачная попытка «съела» бы
# изменение, и назавтра скрипт решил бы, что копировать нечего.
printf '%s\n' "$SIG" > "$LAST_SIG_FILE"

# --- ротация ------------------------------------------------------------------------------

# Имена начинаются с даты в порядке год-месяц-день, поэтому обычная сортировка по алфавиту
# и есть сортировка по времени.
mapfile -t REMOTE < <(
  smb "${CD}ls notehome-*.zip" 2>/dev/null \
    | grep -oE 'notehome-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}\.zip' | LC_ALL=C sort -u
)
COUNT=${#REMOTE[@]}
if [ "$COUNT" -gt "$KEEP" ]; then
  for old in "${REMOTE[@]:0:$((COUNT - KEEP))}"; do
    if smb "${CD}del ${old}" >/dev/null 2>&1; then
      log "удалена старая копия ${old}"
    else
      log "не удалось удалить ${old}, оставляем как есть"
    fi
  done
fi
log "готово, копий на той стороне: $(( COUNT > KEEP ? KEEP : COUNT ))"
