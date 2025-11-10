#!/usr/bin/env node

// Тест мониторинга трафика с симуляцией клиентов
const io = require('socket.io-client');

console.log('🧪 Тест мониторинга трафика с клиентами\n');
console.log('1. Запускаю сервер...');

// Запускаем сервер
const { spawn } = require('child_process');
const serverProcess = spawn('node', ['server.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let serverOutput = '';
serverProcess.stdout.on('data', (data) => {
  serverOutput += data.toString();
  process.stdout.write(data);
});

serverProcess.stderr.on('data', (data) => {
  console.error(data.toString());
});

// Ждём запуска сервера
setTimeout(() => {
  console.log('\n2. Подключаю клиентов...\n');

  // Создаём 2 клиента
  const client1 = io('http://localhost:3001', { transports: ['websocket'] });
  const client2 = io('http://localhost:3001', { transports: ['websocket'] });

  client1.on('connect', () => {
    console.log('✅ Клиент 1 подключён');

    // Создаём комнату
    client1.emit('create_room', { playerName: 'Тестер 1', mode: 'unicorn_canvas' });
  });

  client1.on('room_created', ({ roomCode }) => {
    console.log(`✅ Комната создана: ${roomCode}`);

    // Подключаем второго клиента
    client2.emit('join_room', { roomCode, playerName: 'Тестер 2' });
  });

  client2.on('connect', () => {
    console.log('✅ Клиент 2 подключён');
  });

  client2.on('joined_room', ({ roomCode }) => {
    console.log(`✅ Клиент 2 присоединился к ${roomCode}`);

    // Симулируем рисование (отправляем много данных)
    console.log('\n3. Симулирую рисование (10 штрихов)...\n');

    for (let i = 0; i < 10; i++) {
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

    console.log('✅ Отправлено 10 батчей штрихов (50 штрихов)\n');

    // Ждём 5 секунд и проверяем результат
    setTimeout(() => {
      console.log('4. Проверяю статистику...\n');

      if (serverOutput.includes('Messages:') && !serverOutput.includes('Messages: 0')) {
        console.log('✅ МОНИТОРИНГ РАБОТАЕТ! Трафик отслеживается!\n');

        // Ищем статистику
        const statsMatch = serverOutput.match(/Messages: (\d+)/);
        if (statsMatch) {
          console.log(`   Зарегистрировано сообщений: ${statsMatch[1]}`);
        }
      } else {
        console.log('❌ МОНИТОРИНГ НЕ РАБОТАЕТ! Трафик не отслеживается!\n');
      }

      // Останавливаем
      client1.disconnect();
      client2.disconnect();
      serverProcess.kill();
      process.exit(0);
    }, 5000);
  });

  // Таймаут безопасности
  setTimeout(() => {
    console.error('\n⚠️  Таймаут! Останавливаю тест...');
    serverProcess.kill();
    process.exit(1);
  }, 15000);

}, 2000);
