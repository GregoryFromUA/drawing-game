# 🚀 Deployment Instructions for Render.com

## Крок 1: Стягни зміни

```bash
git pull origin <твоя-гілка>
# або для main:
git pull origin main
```

## Крок 2: Налаштуй Render.com

### Варіант A: Автоматично (через render.yaml)

Render.com автоматично виявить `render.yaml` і використає його налаштування.

### Варіант B: Вручну (через Dashboard)

1. Зайди в **Render Dashboard** → твій сервіс
2. Перейди в **Settings**

3. **Build Command** (замість старого):
   ```
   npm install && npm run build
   ```

4. **Start Command** (замість старого):
   ```
   npm run server
   ```

5. **Environment Variables** → додай:
   - `NODE_VERSION` = `18`

6. Натисни **Save Changes**

## Крок 3: Задеплой

### Автоматичний деплой (якщо налаштований):
```bash
git push origin main
```
Render.com автоматично виявить зміни і запустить деплой.

### Ручний деплой:
1. Зайди в **Render Dashboard**
2. Натисни **Manual Deploy** → **Deploy latest commit**

## Крок 4: Перевір логи

Після деплою перевір логи на наявність помилок:

1. **Render Dashboard** → твій сервіс → **Logs**

2. Шукай:
   ```
   ✓ built in X.XXs
   Server is running on port XXXX
   ```

3. Якщо є помилки:
   - `npm ERR!` - проблема з залежностями
   - `Error: Cannot find module` - missing import
   - `EADDRINUSE` - порт зайнятий (не повинно статися на Render)

## ⚠️ Можливі проблеми та рішення:

### Проблема 1: Build fails
```
Error: Build failed
```

**Рішення:**
```bash
# Локально перевір що build працює:
npm install
npm run build

# Якщо працює - проблема в Environment Variables на Render
```

### Проблема 2: Server не стартує
```
Error: Cannot find module 'express'
```

**Рішення:**
- Перевір що в `package.json` всі залежності в `dependencies`, а не в `devDependencies`
- Vite, @vitejs/plugin-react можуть бути в `devDependencies`
- Express, socket.io, cors МАЮТЬ бути в `dependencies`

### Проблема 3: Static files не віддаються
```
404 Not Found для CSS/JS файлів
```

**Рішення:**
- Переконайся що `npm run build` створив `dist/` директорію
- Перевір логи чи є `dist/index.html`

### Проблема 4: WebSocket не працює
```
WebSocket connection failed
```

**Рішення:**
- На Render.com WebSockets працюють автоматично
- Переконайся що в client коді використовується правильний URL:
  ```javascript
  const socketUrl = window.location.origin;
  const socket = io(socketUrl);
  ```

## 📊 Очікувані логи після успішного деплою:

```
==> Cloning from https://github.com/...
==> Building...
npm install
npm run build

vite v5.4.21 building for production...
✓ 65 modules transformed.
dist/index.html                   0.38 kB
dist/assets/index-XXXXX.css      12.51 kB
dist/assets/index-XXXXX.js      184.14 kB
✓ built in 1.15s

==> Starting service...
npm run server

> drawing-game-server@1.0.0 server
> node server.js

Server is running on port 10000
```

## ✅ Перевірка працездатності:

1. Відкрий URL свого сервісу на Render
2. Маєш побачити меню гри
3. Створи кімнату
4. Спробуй підключитися з іншого пристрою/браузера
5. Почни гру - перевір що малювання працює

## 🔄 Rollback (якщо щось пішло не так):

1. **Render Dashboard** → **Events**
2. Знайди попередній успішний деплой
3. Натисни **Redeploy**

Або поверни зміни локально:
```bash
git revert <commit-hash>
git push origin main
```

## 📝 Чеклист перед деплоєм:

- [ ] `npm run build` працює локально
- [ ] `npm run server` запускає сервер після build
- [ ] Відкривається `http://localhost:3001` після запуску
- [ ] WebSocket з'єднання працює
- [ ] Всі залежності в `package.json`
- [ ] `NODE_VERSION >= 18` в Environment Variables

---

Якщо все виконано - деплой має пройти успішно! 🚀
