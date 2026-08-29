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
SMB_NAME=''                # имя машины в сети; пусто — идём сразу по SMB_HOST
SMB_HOST=192.168.1.100     # запасной адрес на случай, если имя не разрешилось
SMB_SHARE=I
SMB_SUBDIR='архив notehome'
POLL_INTERVAL=600          # как часто проверять, появилась ли машина в сети — 10 минут
SETTLE_DELAY=300           # сколько ждать после появления, прежде чем писать — 5 минут
GIVE_UP_AFTER=$((13 * 3600))  # 9:00 + 13 часов: не дождались до 22:00 — попробуем завтра
KEEP=2                     # сколько копий держать на той стороне
STALE_AFTER_DAYS=3         # столько суток без свежей копии — и служба падает с ошибкой

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
die() { log "ОШИБКА: $*" >&2; exit 1; }

[ -r "$CONF" ] && . "$CONF"
[ -r "$AUTH" ] || die "нет файла с учётными данными: $AUTH"

# Адрес машины выдаёт DHCP, и он меняется. Копия однажды не делалась пять дней молча просто
# потому, что 192.168.1.100 стал 192.168.1.101, — поэтому в конфиге имя, а адрес выясняется
# заново перед каждой проверкой. Имя заодно отвечает за то, что мы пишем именно на свою
# машину: по фиксированному адресу дамп ушёл бы тому, кому DHCP отдал этот адрес следующим.
SMB_ADDR=''
ADDR_FILE="$STATE_DIR/last.addr"

# Порт, а не ping: Windows часто глушит ICMP, продолжая отдавать файлы. Нам важно не то,
# что машина отзывается, а то, что готова принять запись.
port_open() {
  timeout 5 bash -c "cat < /dev/null > /dev/tcp/${1}/445" 2>/dev/null
}

# Кандидаты в порядке убывания доверия: что ответило разрешение имени, адрес прошлой удачной
# копии, запасной адрес из конфига. Ни один не берётся на веру — каждый проверяется портом.
#
# Список, а не единственный адрес, потому что имя разрешается неоднозначно: у машины есть ещё
# и адрес Tailscale, который MagicDNS отдаёт, даже когда она там offline (на момент правки —
# 102 дня). Взяли бы первый ответ — попали бы на мёртвый адрес и снова получили бы «машины
# нет в сети» при живой машине в двух метрах.
candidate_addrs() {
  {
    [ -n "${SMB_NAME:-}" ] && getent ahostsv4 "$SMB_NAME" 2>/dev/null |
      awk '$2 == "STREAM" { print $1 }'
    [ -f "$ADDR_FILE" ] && cat "$ADDR_FILE"
    printf '%s\n' "${SMB_HOST:-}"
  } 2>/dev/null | awk 'NF && !seen[$0]++'
}

# Последняя линия обороны: адрес сменился, а разрешение имени этого не отражает. Обходим свою
# подсеть по 445 и спрашиваем у каждого, кто ответил, его NetBIOS-имя.
#
# Сверка имени здесь не для удобства, а обязательна: без неё дамп базы и документы всех
# пользователей уехали бы на машину, которой DHCP отдал наш прежний адрес.
scan_for_host() {
  [ -n "${SMB_NAME:-}" ] || return 1
  local cidr prefix want list i addr name rc=1
  cidr=$(ip -4 -o addr show scope global 2>/dev/null | awk '$4 ~ /\/24$/ { print $4; exit }')
  [ -n "$cidr" ] || return 1
  prefix=${cidr%/*}; prefix=${prefix%.*}
  want=$(printf '%s' "$SMB_NAME" | tr '[:lower:]' '[:upper:]')
  list=$(mktemp)

  for i in $(seq 1 254); do
    ( port_open "${prefix}.${i}" && printf '%s\n' "${prefix}.${i}" >> "$list" ) &
  done
  wait

  while read -r addr; do
    name=$(nmblookup -A "$addr" 2>/dev/null | awk '$2 == "<20>" { print toupper($1); exit }')
    if [ "$name" = "$want" ]; then SMB_ADDR=$addr; rc=0; break; fi
  done < "$list"

  rm -f "$list"
  return "$rc"
}

# Сканирование недешёвое, а машина может быть просто выключена весь день, поэтому в обычном
# опросе его нет: оно включается раз в SCAN_EVERY циклов, то есть примерно раз в час.
SCAN_EVERY=6
since_scan=$SCAN_EVERY

smb_reachable() {
  local addr
  for addr in $(candidate_addrs); do
    if port_open "$addr"; then
      SMB_ADDR=$addr
      since_scan=$SCAN_EVERY
      return 0
    fi
  done

  since_scan=$((since_scan + 1))
  if [ "$since_scan" -ge "$SCAN_EVERY" ]; then
    since_scan=0
    if scan_for_host; then
      log "машина ${SMB_NAME} нашлась по новому адресу ${SMB_ADDR}"
      return 0
    fi
  fi
  return 1
}

smb() {
  smbclient "//${SMB_ADDR}/${SMB_SHARE}" --authentication-file="$AUTH" -c "$1"
}

# Домашнюю машину законно не включать день-другой, поэтому один пропуск — не повод шуметь.
# А вот когда свежей копии нет уже STALE_AFTER_DAYS суток, выходим с ошибкой: иначе служба
# каждый раз завершается успешно, и отсутствие бэкапа ничем себя не выдаёт — ровно так оно
# и осталось незамеченным в прошлый раз.
OK_FILE="$STATE_DIR/last.ok"
backup_age_days() {
  local was now
  [ -f "$OK_FILE" ] || return 1
  was=$(cat "$OK_FILE" 2>/dev/null) || return 1
  [ -n "$was" ] || return 1
  now=$(date +%s)
  printf '%s' $(( (now - was) / 86400 ))
}

mark_ok() {
  mkdir -p "$STATE_DIR"
  date +%s > "$OK_FILE"
  if [ -n "$SMB_ADDR" ]; then printf '%s\n' "$SMB_ADDR" > "$ADDR_FILE"; fi
}

give_up() {
  local age
  if ! age=$(backup_age_days); then
    die "удачных копий не было ни разу, а машина недоступна"
  fi
  [ "$age" -lt "$STALE_AFTER_DAYS" ] || die "свежей копии нет уже ${age} сут"
  log "последняя удачная копия была ${age} сут назад, ждём следующего запуска"
  exit 0
}

# Папка внутри ресурса нужна не всегда: если по сети отдан сразу нужный каталог, SMB_SUBDIR
# пуст, и никакого `cd` делать не надо — пустой `cd ""` smbclient считает ошибкой.
HOST_LABEL=${SMB_NAME:-$SMB_HOST}
if [ -n "${SMB_SUBDIR:-}" ]; then
  CD="cd \"${SMB_SUBDIR}\"; "
  WHERE="//${HOST_LABEL}/${SMB_SHARE}/${SMB_SUBDIR}"
else
  CD=""
  WHERE="//${HOST_LABEL}/${SMB_SHARE}"
fi

# --- ждём машину -------------------------------------------------------------------------

waited=0
until smb_reachable; do
  if [ "$waited" -ge "$GIVE_UP_AFTER" ]; then
    log "машина ${HOST_LABEL} так и не появилась за $((GIVE_UP_AFTER / 3600)) ч, копия не делалась"
    give_up
  fi
  sleep "$POLL_INTERVAL"
  waited=$((waited + POLL_INTERVAL))
done
log "машина ${HOST_LABEL} в сети по адресу ${SMB_ADDR} (ждали $((waited / 60)) мин), пауза $((SETTLE_DELAY / 60)) мин"
sleep "$SETTLE_DELAY"

# За время паузы машину могли выключить обратно — тогда просто ждём дальше по тому же кругу.
until smb_reachable; do
  if [ "$waited" -ge "$GIVE_UP_AFTER" ]; then
    log "машина пропала во время паузы и больше не появилась, копия не делалась"
    give_up
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
  mark_ok
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
mark_ok

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
