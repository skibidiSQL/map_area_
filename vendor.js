'use strict';
// Подключаем встроенные модули Node.js для работы с файловой системой, путями и криптографией
const fs = require('fs'), path = require('path'), crypto = require('crypto');

// Задаем пути к локальным папкам, куда будут сохраняться скачанные файлы
const DIR = path.join(__dirname, 'vendor'), FD = path.join(DIR, 'fonts'),
      // Ссылки на внешние ресурсы (CDN библиотеки Three.js и API Google Fonts)
      THREE = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
      FONTS = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;800&display=swap',
      // Фиктивный User-Agent (строка идентификации браузера). Нужен, чтобы сервер Google Fonts понял, что мы поддерживаем современные форматы, и отдал легкие файлы .woff2
      UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Вспомогательная асинхронная функция для скачивания файлов по сети с жестким ограничением времени ожидания в 30 секунд (таймаут)
const get = async (u, h) => {
  const r = await fetch(u, { headers: h, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(u + ' → ' + r.status); // Если сервер вернул ошибку (например, 404), прерываем выполнение
  return r;
};

// Основная функция скрипта: проверяет наличие нужных файлов и скачивает их при необходимости
async function ensure() {
  // Создаем целевую директорию 'vendor/fonts', если ее еще нет в проекте
  fs.mkdirSync(FD, { recursive: true });
  // Определяем пути для итоговых файлов
  const tf = path.join(DIR, 'three.min.js'), cf = path.join(DIR, 'fonts.css');
  
  try {
    // Если файл 3D-библиотеки еще не скачан, загружаем его из сети и сохраняем локально
    if (!fs.existsSync(tf)) { 
        fs.writeFileSync(tf, Buffer.from(await (await get(THREE)).arrayBuffer())); 
        console.log('vendor: three.js сохранён'); 
    }
  } catch (e) { console.error('vendor: не удалось скачать three.js (пока используется CDN):', e.message); }
  
  try {
    // Если локального файла стилей для шрифта еще нет
    if (!fs.existsSync(cf)) {
      // Запрашиваем CSS-файл у Google Fonts, притворяясь десктопным браузером
      const css = await (await get(FONTS, { 'User-Agent': UA })).text();
      let out = ''; // Переменная для накопления итогового локального CSS-кода
      
      // С помощью регулярных выражений ищем в ответе Google блоки стилей (@font-face) для кириллицы и латиницы
      for (const m of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)) {
        // Игнорируем другие алфавиты (например, вьетнамский или греческий), чтобы не качать лишнее
        if (!['cyrillic', 'latin'].includes(m[1])) continue;
        let block = m[2];
        
        // Внутри нужного блока @font-face ищем прямые ссылки (url) на файлы самого шрифта
        for (const u of [...block.matchAll(/url\((https:[^)]+)\)/g)]) {
          // Создаем короткое уникальное имя для скачиваемого шрифта, используя MD5-хеш от его исходного URL-адреса
          const name = crypto.createHash('md5').update(u[1]).digest('hex').slice(0, 12) + '.woff2';
          
          // Скачиваем сам файл шрифта (.woff2) по найденной ссылке и сохраняем его в папку 'fonts'
          fs.writeFileSync(path.join(FD, name), Buffer.from(await (await get(u[1])).arrayBuffer()));
          
          // Модифицируем CSS-блок: заменяем веб-ссылку Google на относительный путь к локальному файлу (fonts/имя_файла.woff2)
          block = block.replace(u[1], () => 'fonts/' + name);
        }
        // Добавляем готовый модифицированный блок в итоговую строку CSS
        out += `/* ${m[1]} */\n${block}\n`;
      }
      // Если нужные шрифты не нашлись, выдаем ошибку
      if (!out) throw new Error('в ответе нет нужных @font-face');
      
      // Сохраняем весь сгенерированный CSS-код в локальный файл fonts.css
      fs.writeFileSync(cf, out); console.log('vendor: шрифт Manrope сохранён');
    }
  } catch (e) { console.error('vendor: не удалось скачать шрифт (пока используется Google Fonts):', e.message); }
}

// Экспортируем функцию ensure наружу, чтобы этот скрипт можно было импортировать в другие модули Node.js
module.exports = { ensure, THREE, FONTS };

// Если этот скрипт был запущен напрямую из консоли (например, командой `node vendor.js`), автоматически запускаем функцию ensure()
if (require.main === module) ensure();