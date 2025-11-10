#!/bin/bash

echo "🔍 Проверка мониторинга трафика"
echo "================================"
echo ""

# Убиваем старые процессы
pkill -f "node server.js" 2>/dev/null || true
sleep 1

echo "✅ Запускаем сервер..."
node server.js > /tmp/server_output.log 2>&1 &
SERVER_PID=$!
echo "   PID: $SERVER_PID"
echo ""

echo "⏳ Ждём 65 секунд для появления логов мониторинга..."
echo "   (логи будут в /tmp/server_output.log)"
echo ""

for i in {1..13}; do
    sleep 5
    echo "   $(($i * 5)) сек..."
done

echo ""
echo "📊 === РЕЗУЛЬТАТ ==="
echo ""

# Проверяем логи
if grep -q "TRAFFIC STATS" /tmp/server_output.log; then
    echo "✅ МОНИТОРИНГ РАБОТАЕТ!"
    echo ""
    echo "Логи:"
    grep -A 10 "TRAFFIC STATS" /tmp/server_output.log
else
    echo "❌ МОНИТОРИНГ НЕ РАБОТАЕТ"
    echo ""
    echo "Весь вывод сервера:"
    cat /tmp/server_output.log
fi

echo ""
echo "🛑 Останавливаем сервер..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

echo "✅ Готово!"
