#!/bin/bash

# Быстрый тест мониторинга с реальным трафиком

echo "🧪 Быстрый тест мониторинга трафика"
echo "===================================="
echo ""

# Останавливаем старые процессы
pkill -f "node server.js" 2>/dev/null || true
sleep 1

# Запускаем сервер
echo "1️⃣  Запускаю сервер..."
node server.js > /tmp/traffic_test.log 2>&1 &
SERVER_PID=$!
sleep 2

# Тестовый клиент
echo "2️⃣  Подключаю тестового клиента и симулирую активность..."
node -e "
const io = require('socket.io-client');

const client1 = io('http://localhost:3001', { transports: ['websocket'] });
const client2 = io('http://localhost:3001', { transports: ['websocket'] });

let roomCode = null;

client1.on('connect', () => {
  console.log('   ✅ Клиент 1 подключён');
  client1.emit('create_room', { playerName: 'Игрок1', mode: 'unicorn_canvas' });
});

client1.on('room_created', ({ roomCode: code }) => {
  roomCode = code;
  console.log('   ✅ Комната создана:', code);
  client2.emit('join_room', { roomCode: code, playerName: 'Игрок2' });
});

client2.on('connect', () => {
  console.log('   ✅ Клиент 2 подключён');
});

client2.on('joined_room', () => {
  console.log('   ✅ Клиент 2 присоединился');
  console.log('');
  console.log('3️⃣  Отправляю 100 штрихов...');

  // Отправляем много штрихов
  for (let i = 0; i < 20; i++) {
    const strokes = [];
    for (let j = 0; j < 5; j++) {
      strokes.push({
        x: Math.floor(Math.random() * 1000),
        y: Math.floor(Math.random() * 1000),
        color: '#FF0000',
        size: 10,
        tool: 'pen',
        type: 'draw'
      });
    }
    client1.emit('unicorn_drawing_strokes', { strokes });
  }

  console.log('   ✅ Отправлено 100 штрихов');
  console.log('');

  setTimeout(() => {
    client1.disconnect();
    client2.disconnect();
    process.exit(0);
  }, 1000);
});

setTimeout(() => {
  console.error('⚠️  Timeout!');
  process.exit(1);
}, 10000);
" 2>&1

echo ""
echo "4️⃣  Проверяю результаты мониторинга..."
echo ""

# Ждём немного чтобы логи записались
sleep 1

# Проверяем debug логи
if grep -q "\[MONITOR\]" /tmp/traffic_test.log; then
    echo "✅ МОНИТОРИНГ АКТИВЕН!"
    echo ""
    echo "Примеры отслеженных событий:"
    grep "\[MONITOR\]" /tmp/traffic_test.log | head -10
    echo ""

    # Подсчитываем сообщения
    MONITOR_COUNT=$(grep -c "\[MONITOR\]" /tmp/traffic_test.log)
    echo "📊 Всего отслежено сообщений: $MONITOR_COUNT"
    echo ""

    # Проверяем большие сообщения
    if grep -q "LARGE MESSAGE" /tmp/traffic_test.log; then
        echo "⚠️  ВНИМАНИЕ: Обнаружены большие сообщения!"
        grep "LARGE MESSAGE" /tmp/traffic_test.log
        echo ""
        echo "❌ ПРОБЛЕМА НЕ ИСПРАВЛЕНА! Всё ещё отправляются огромные сообщения!"
    else
        echo "✅ Больших сообщений не обнаружено (все < 10 KB)"
        echo "✅ ПРОБЛЕМА ИСПРАВЛЕНА!"
    fi
else
    echo "❌ МОНИТОРИНГ НЕ РАБОТАЕТ!"
    echo ""
    echo "Лог сервера:"
    cat /tmp/traffic_test.log
fi

echo ""
echo "5️⃣  Останавливаю сервер..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

echo "✅ Готово!"
echo ""
echo "📄 Полный лог сервера сохранён в: /tmp/traffic_test.log"
