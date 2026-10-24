/* метод для инициализации основных констант и получения элементов DOM, а также вспомогательные функции (генерация ID, экранирование HTML) */
(() => { // Запуск самовызывающейся анонимной функции (IIFE) для изоляции переменных от глобальной области видимости
const SUPABASE_URL = 'https://rlzgzbviuvkuzhcfyzcg.supabase.co'; // URL-адрес подключения к вашему облачному проекту Supabase
const SUPABASE_ANON_KEY = 'sb_publishable_STl70_TA-R8cRWX9qsw_DA_GxuGw0WZ'; // Публичный анонимный API-ключ для авторизации запросов
const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null; // Создание клиента БД, если скрипт Supabase успешно загрузился в браузере

let BASE = location.origin + location.pathname.replace(/\/(index\.html)?$/, ''); // Формирование базового URL сайта (удаляет index.html на конце для правильной генерации ссылок)
const PKG = window.__PKG || null, // Получение упакованных данных карты (используется, если приложение скачано как один офлайн-файл)
      THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', // Ссылка на библиотеку Three.js для рендера 3D-панорам
      EMB = /\/embed\/?$/.test(location.pathname); // Булевый флаг: проверяет по URL, открыто ли приложение в режиме встраивания (iframe)
let rec = null, role = 'view', st = 0; // Инициализация текущего состояния: загруженная карта (rec), права доступа по умолчанию (role), таймер автосохранения (st)

const body = document.body, // Сохраняем ссылку на тег <body> в переменную для быстрого доступа (используется для переключения глобальных состояний CSS)
      rnd = () => [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(36).padStart(2, '0')).join(''), // Генератор безопасных случайных строк (создает уникальные ID для новых карт и токены доступа share_token)
      view = v => body.dataset.v = v, // Функция переключения "экранов" приложения: меняет атрибут data-v у <body> (например, data-v="map" покажет карту, а "home" — главное меню)
      nav_ = on => body.toggleAttribute('data-nav', on), // Функция для открытия/закрытия боковой панели меню (добавляет или убирает атрибут data-nav)
      dq = () => JSON.parse(localStorage.getItem('tk-del') || '[]'), // dq (Deletion Queue) — функция, которая достает из localStorage список ID карт, удаленных в офлайне (чтобы удалить их из облака позже)
      dlg = h => { const d = $('#dlg'); d.firstElementChild.innerHTML = h; d.hidden = false; }, // Функция для показа модального окна: вставляет переданный HTML-код (h) в блок #dlg и делает его видимым
      undlg = () => $('#dlg').hidden = true, // Функция для закрытия (скрытия) модального диалогового окна
      link = r => BASE + '/#/m/' + r.id + '/' + r.share.token, // Функция-генератор ссылки-приглашения: склеивает базовый URL сайта, ID карты и секретный токен доступа
      esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); // Функция экранирования текста: заменяет опасные спецсимволы на безопасные HTML-сущности для защиты от XSS-атак (взлома через скрипты)
/* метод для создания локальной базы данных IndexedDB и обертки над ней (получение, сохранение, удаление записей) */
const DB = (() => { // Открываем самовызывающуюся функцию (IIFE), чтобы спрятать внутренние переменные от остального кода
  let p; // Создаем переменную 'p' для кэширования (сохранения) подключения к базе данных, чтобы не открывать его заново при каждом запросе
  const open = () => p || (p = new Promise((ok, no) => { // Функция открытия БД: если подключение 'p' уже есть — возвращаем его, если нет — создаем новый Промис
    const r = indexedDB.open('tk-spacemap', 1); // Просим браузер открыть локальную базу данных IndexedDB с именем 'tk-spacemap' (версия 1)
    r.onupgradeneeded = () => { r.result.createObjectStore('maps', { keyPath: 'id' }); }; // Сработает при первом запуске: создаем "таблицу" (хранилище) 'maps', где уникальным ключом будет поле 'id'
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); // Если БД открылась успешно — выполняем 'ok' (возвращаем базу), если ошибка — вызываем 'no'
  }));
  const tx = async (s, m, f) => { // Универсальная функция для выполнения транзакций. Принимает: s - имя таблицы, m - режим (чтение/запись), f - действие (коллбэк)
    const d = await open(); // Ждем, пока база данных откроется (ждем выполнения Промиса)
    return new Promise((ok, no) => { const t = d.transaction(s, m), q = f(t.objectStore(s)); t.oncomplete = () => ok(q && q.result); t.onerror = () => no(t.error); }); // Запускаем транзакцию, выполняем переданное действие 'f' с базой, и завершаем Промис успехом (oncomplete) или ошибкой (onerror)
  };
  return { get: (s, k) => tx(s, 'readonly', o => o.get(k)), put: (s, v) => tx(s, 'readwrite', o => o.put(v)), // Экспортируем наружу готовые методы: get (найти по ключу), put (сохранить/обновить данные)
           del: (s, k) => tx(s, 'readwrite', o => o.delete(k)), all: s => tx(s, 'readonly', o => o.getAll()) }; // del (удалить запись по ключу) и all (получить все записи из таблицы)
})();

/* метод для получения всех локальных карт, отсортированных по дате изменения */
const mine = async () => (await DB.all('maps')).sort((a, b) => b.updated - a.updated);

/* метод для отображения экрана с ошибкой доступа (например, если ссылка недействительна) */
function deny(msg) {
  view('auth'); nav_(false);
  $('#auth').innerHTML = `<div class="card"><h3>Нет доступа</h3><p>${msg}</p>${EMB ? '' : '<div class="btns"><button class="pri" onclick="location.hash=\'\';location.reload()">На главную</button></div>'}</div>`;
}

/* метод для отрисовки боковой панели со списком карт пользователя */
async function nav() {
  const ms = await mine();
  $('#nav').innerHTML = `<div class="nh">Мои карты</div>` +
    (ms.map(m => `<div class="nr"><button class="ni${rec && rec.id == m.id ? ' on' : ''}" data-m="${m.id}">🗺 ${esc(m.name)}</button><button class="nx" data-x="${m.id}" aria-label="Удалить карту" title="Удалить">🗑</button></div>`).join('') || '<small style="padding:6px 12px">Карт пока нет</small>') +
    '<button class="ni" data-n="new">＋ Создать карту</button>';
}

/* метод для переключения на главный экран (создание новой карты или пустой экран) */
function home(k) {
  view('home'); nav_(innerWidth >= 900);
  $('#home').innerHTML = k == 'new' ? `<div class="card"><h3>Новая карта пространства</h3><label>Название</label><input type="text" id="cn" maxlength="80"><label>Краткое описание (по желанию)</label><textarea id="cd"></textarea><div class="btns"><button data-a="cancel">Отмена</button><button class="pri" data-a="next">Далее</button></div></div>`
    : `<div><button class="plus" data-a="new" aria-label="Создать карту">+</button><div class="plus-t">Создать карту пространства</div></div>`;
}

/* метод для принудительного сохранения текущих изменений перед выходом или сменой карты */
async function leave() { if (st) { clearTimeout(st); await persist(); } }

/* метод для обработки всех кликов в боковой панели навигации и на главном экране (выбор карты, создание, удаление) */
$('#cab').onclick = async e => {
  if (e.target.id == 'nbk') return nav_(false);
  const b = e.target.closest('[data-n],[data-m],[data-a],[data-x]');
  if (!b) return;
  const d = b.dataset, a = d.n || d.a;
  
  if (d.m) { await leave(); openRec(await DB.get('maps', d.m), 'owner'); }
  if (a == 'new') { await leave(); rec = null; home('new'); if (innerWidth < 900) nav_(false); setTimeout(() => $('#cn').focus(), 50); }
  if (a == 'cancel') home();
  if (a == 'next') return createMap();
  if (d.x) {
    const m = await DB.get('maps', d.x);
    return dlg(`<h3>Удалить карту «${esc(m.name)}»?</h3><p>Она будет удалена безвозвратно.</p><div class="btns"><button data-d="cancel">Отмена</button><button class="pri" data-d="delmap" data-id="${m.id}">Удалить</button></div>`);
  }
  if (innerWidth < 900 && d.m) nav_(false);
  nav();
};

/* метод для открытия или закрытия мобильного меню */
$('#hb').onclick = $('#bg').onclick = () => nav_();

/* метод для создания новой карты в базе данных и ее открытия */
async function createMap() {
  const name = $('#cn').value.trim();
  if (!name) return toast('Введите название');
  const r = { id: rnd(), name, desc: $('#cd').value.trim(), share: { mode: 'off', token: rnd() },
              data: { name, floors: [{ id: 'f1', name: 'Этаж 1', bg: null, bgo: .7, cor: [], rooms: [], pois: [], panos: [] }] }, updated: Date.now(), dirty: true };
  try { await DB.put('maps', r); } catch { return toast('Не удалось сохранить карту'); }
  openRec(r, 'owner'); sync();
}

/* метод для открытия конкретной записи карты и запуска ядра отрисовки (Core) */
function openRec(r, ro, solo) {
  rec = r; role = ro;
  body.toggleAttribute('data-solo', !!solo);
  $('#shr').hidden = ro != 'owner' && ro != 'edit'; 
  view('map'); nav_(!solo && innerWidth >= 900);
  Core.open(r.data, ro);
  nav();
}

/* метод для перехвата сохранения данных из ядра (script.js) и установки таймера на запись в БД */
Core.onSave = d => {
  if (!rec || role == 'view') return;
  rec.data = d; rec.name = d.name || rec.name; rec.updated = Date.now(); rec.dirty = true;
  clearTimeout(st); st = setTimeout(persist, 500);
};

/* метод для физической записи текущего состояния карты в IndexedDB */
async function persist(r = rec) {
  st = 0;
  if (!r) return;
  try { await DB.put('maps', r); } catch { toast('Не удалось сохранить карту локально'); }
  nav(); sync();
}

/* метод для старта процесса синхронизации с облаком с защитой от одновременных запусков */
let sp = null, again = false;
function sync() {
  if (sp) { again = true; return sp; }
  sp = (async () => { try { do { again = false; await doSync(); } while (again); } finally { sp = null; } })();
  return sp;
}

/* метод для непосредственной синхронизации: удаление карт из облака и отправка локальных изменений (upsert) в Supabase */
async function doSync() {
  if (!supabase || !navigator.onLine) return;

  for (const id of dq()) {
    const { error } = await supabase.from('maps').delete().eq('id', id);
    if (error) { console.error('sync delete', error); toast('Облако: ' + error.message); break; }
    localStorage.setItem('tk-del', JSON.stringify(dq().filter(x => x != id)));
  }

  let all = [];
  try { all = await DB.all('maps'); } catch { return; }
  const del = dq();

  for (const m of all.filter(m => m.dirty && !del.includes(m.id))) {
    const { error } = await supabase.from('maps').upsert({
      id: m.id, name: m.name, desc: m.desc,
      share_mode: m.share.mode, share_token: m.share.token,
      data: m.data, updated: m.updated
    });
    if (error) { console.error('sync upsert', error); toast('Не сохранилось в облако: ' + error.message); continue; }
    // сбрасываем dirty, только если карту не меняли за время отправки
    const cur = await DB.get('maps', m.id);
    if (cur && cur.updated === m.updated) { cur.dirty = false; await DB.put('maps', cur); }
    if (rec && rec.id == m.id && rec.updated === m.updated) rec.dirty = false;
  }
}

/* метод для стягивания обновленных карт из облака Supabase в локальную базу IndexedDB */
async function pull() {
  if (!supabase || !navigator.onLine) return;
  for (const l of await mine()) {
    const { data: x, error } = await supabase.from('maps').select('*').eq('id', l.id).maybeSingle();
    if (error) { console.error('pull', error); continue; }
    if (x && Number(x.updated) > l.updated) {
      await DB.put('maps', {
        id: x.id, name: x.name, desc: x.desc,
        share: { mode: x.share_mode, token: x.share_token },
        data: x.data, updated: Number(x.updated), dirty: false
      });
    }
  }
}

/* метод для добавления ID карты в очередь на удаление из облака при следующей синхронизации */
function dropRemote(id) { localStorage.setItem('tk-del', JSON.stringify([...dq(), id])); sync(); }

/* метод для отрисовки диалогового окна настроек совместного доступа (ссылки, права, встраивание) */
function shareDlg() {
  const m = rec.share.mode, o = (v, t) => `<option value="${v}"${m == v ? ' selected' : ''}>${t}</option>`;
  dlg(`<h3>Поделиться «${esc(rec.name)}»</h3><label>Доступ по ссылке</label><select id="sm">${o('off', '🔒 Только я')}${o('view', '👁 Все со ссылкой — посетитель (просмотр)')}${o('edit', '✏️ Все со ссылкой — организатор (редактирование)')}</select>` +
    (m == 'off' ? '<p><small>Ссылка не работает, пока вы не откроете доступ.</small></p>'
      : `<label>Ссылка</label><input type="text" id="sl" readonly value="${esc(link(rec))}"><div class="btns"><button class="pri" data-d="copy">Копировать ссылку</button><button data-d="reset">Новая ссылка</button></div><label>Встроить на сайт</label><textarea id="se" readonly rows="4">${esc(embedCode(rec))}</textarea><div class="btns"><button data-d="copyembed">Копировать код</button></div>`) +
    (m != 'off' && rec.dirty ? '<div class="note">⚠ Карта пока не сохранена в облаке — на других устройствах ссылка не откроется. Проверьте интернет и настройки Supabase (подробности в консоли).</div>' : '') +
    `<label>Без интернета</label><div class="btns" style="margin-top:0"><button data-d="pack">⬇ Офлайн-версия (.html)</button></div><p><small>Открывается на телефоне без сети.</small></p><div class="btns"><button class="pri" data-d="cancel">Готово</button></div>`);
}

/* метод для генерации iframe-кода встраивания карты на сторонний сайт */
const embedCode = r => `<iframe src="${BASE}/embed#/m/${r.id}/${r.share.token}" width="100%" height="640" style="border:0" allowfullscreen loading="lazy"></iframe>`;

/* метод для обновления временной метки карты (принудительное сохранение изменений, например, при смене прав) */
const touch = async () => { rec.updated = Date.now(); rec.dirty = true; await persist(); await sync(); };

/* метод для сборки и скачивания всей карты со всеми скриптами и ресурсами в один автономный .html файл (Офлайн-версия) */
async function pack() {
  toast('Готовлю файл…');
  try {
    const t = u => fetch(u).then(r => r.ok ? r.text() : Promise.reject(u)), z = s => s.replace(/<\/script/gi, '<\\/script'),
          toData = async u => { const b = await (await fetch(u)).blob(); return new Promise(ok => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(b); }); };
    const [h, css, core, app, three] = await Promise.all(['index.html', 'style.css', 'script.js', 'app.js', THREE_URL].map(t)),
          r = rec.share.mode == 'edit' ? 'edit' : 'view',
          inl = async u => /^https?:/.test(u || '') ? toData(u).catch(() => u) : u,
          floors = await Promise.all((rec.data.floors || []).map(async f => ({ ...f, bg: await inl(f.bg), panos: await Promise.all(f.panos.map(async p => ({ ...p, src: await inl(p.src) }))) }))),
          m = { ...rec, data: { ...rec.data, floors }, share: { mode: rec.share.mode, token: '' }, dirty: false },
          out = h.replace(/<link rel="stylesheet" href="style.css">/, () => `<style>${css}</style>`)
            .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase[^"]*"><\/script>/, '')
            .replace(/<script src="https:\/\/cdnjs[^"]*three[^"]*"><\/script>/, () => `<script>${z(three)}<\/script>`)
            .replace(/<script src="script.js"><\/script>/, () => `<script>window.__PKG=${z(JSON.stringify({ map: m, role: r }))}<\/script><script>${z(core)}<\/script>`)
            .replace(/<script src="app.js"><\/script>/, () => `<script>${z(app)}<\/script>`);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out], { type: 'text/html' }));
    a.download = (rec.name.replace(/[^\p{L}\p{N}]+/gu, '_') || 'map') + '.html';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4e4);
  } catch { toast('Не удалось собрать файл'); }
}

/* метод для обработки клика по кнопке "Поделиться" */
$('#shr').onclick = shareDlg;

/* метод для обработки смены выпадающего списка прав доступа в диалоге "Поделиться" */
$('#dlg').onchange = async e => { if (e.target.id == 'sm') { rec.share.mode = e.target.value; await touch(); shareDlg(); } };

/* метод для обработки кликов по кнопкам внутри модальных окон (отмена, удаление, копирование, сброс ссылки, скачивание) */
$('#dlg').onclick = async e => {
  if (e.target.id == 'dlg') return undlg();
  const d = (e.target.closest('[data-d]') || {}).dataset;
  if (!d) return;
  if (d.d == 'cancel') undlg();
  if (d.d == 'delmap') {
    const id = d.id; await DB.del('maps', id);
    if (rec && rec.id == id) { rec = null; home(); }
    undlg(); dropRemote(id); nav();
  }
  if (d.d == 'copy') { try { await navigator.clipboard.writeText(link(rec)); } catch { $('#sl').select(); document.execCommand('copy'); } toast('Ссылка скопирована'); }
  if (d.d == 'reset') { rec.share.token = rnd(); await touch(); shareDlg(); toast('Старая ссылка больше не работает'); }
  if (d.d == 'copyembed') { try { await navigator.clipboard.writeText($('#se').value); } catch { $('#se').select(); document.execCommand('copy'); } toast('Код скопирован'); }
  if (d.d == 'pack') pack();
};

/* метод для открытия карты по расшаренной ссылке с проверкой токена, скачиванием из облака и определением прав */
async function openLink(id, tok) {
  let r = null;
  try { r = await DB.get('maps', id); } catch {}

  if (supabase && navigator.onLine) {
    const { data: m, error } = await supabase.from('maps').select('*').eq('id', id).maybeSingle();
    if (error) {
      console.error('openLink', error);
      if (!r) return deny('Не удалось получить карту из облака: ' + esc(error.message));
    } else if (m) {
      const remote = { id: m.id, name: m.name, desc: m.desc, share: { mode: m.share_mode, token: m.share_token }, data: m.data, updated: Number(m.updated), dirty: false };
      if (!r || remote.updated >= r.updated) { r = remote; await DB.put('maps', r); if (!EMB) toast('Карта сохранена для офлайн-доступа'); }
    } else if (r && r.share.token !== tok) { await DB.del('maps', id); r = null; }
  }

  let ro = r && r.share.token === tok && r.share.mode != 'off' ? r.share.mode : null;
  if (!tok && r) ro = 'owner';
  if (EMB && ro) ro = 'view';

  if (!ro) return deny('Карта не найдена, удалена или владелец закрыл доступ по этой ссылке.');
  openRec(r, ro, !!tok);
}

/* метод для уменьшения разрешения изображения перед загрузкой (ужимает ширину до заданного лимита через canvas) */
const shrink = (f, w, q) => new Promise((ok, no) => {
  const u = URL.createObjectURL(f), i = new Image();
  i.onload = () => {
    URL.revokeObjectURL(u);
    const k = Math.min(1, w / i.width), c = document.createElement('canvas');
    c.width = Math.round(i.width * k); c.height = Math.round(i.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(i, 0, 0, c.width, c.height);
    c.toBlob(b => b ? ok(b) : no(new Error('toBlob')), 'image/jpeg', q);
  };
  i.onerror = () => no(new Error('bad image'));
  i.src = u;
});

/* метод для загрузки произвольного изображения (плана этажа) в бакет Supabase Storage */
window.uploadImage = async function (file, { max = 4096, q = .85, prefix = '' } = {}) {
  if (!supabase) { toast('Облако недоступно (не загрузился Supabase)'); return null; }
  if (!navigator.onLine) { toast('Нет интернета — файл сейчас не загрузить'); return null; }
  try {
    const blob = await shrink(file, max, q), name = prefix + Date.now() + '_' + rnd().slice(0, 8) + '.jpg';
    const { error } = await supabase.storage.from('panoramas').upload(name, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
    if (error) { console.error('upload', error); toast('Ошибка загрузки: ' + error.message); return null; }
    const url = supabase.storage.from('panoramas').getPublicUrl(name).data.publicUrl;
    const chk = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (!chk || !chk.ok) { console.error('public url check', url, chk && chk.status); toast('Файл загружен, но по ссылке недоступен (HTTP ' + (chk ? chk.status : 'сеть/CORS') + '). Сделайте бакет panoramas публичным.'); return null; }
    return url;
  } catch (e) { console.error(e); toast('Не удалось обработать файл'); return null; }
};

/* метод для загрузки 360-панорам с увеличенным лимитом разрешения (8192px) */
window.uploadPanorama = file => window.uploadImage(file, { max: 8192, q: .88 });

/* метод (IIFE), выполняющийся при старте приложения: инициализирует Service Worker, обрабатывает роутинг по хешу и запускает синхронизацию */
(async () => {
  body.toggleAttribute('data-embed', EMB);
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !PKG) navigator.serviceWorker.register('sw.js').catch(() => {});
  addEventListener('online', () => { sync(); pull().then(nav); });
  addEventListener('hashchange', () => /^#\/m\//.test(location.hash) && location.reload());
  
  if (PKG) {
    let r = PKG.map;
    try { const o = await DB.get('maps', r.id); if (o && o.updated > r.updated) r = o; } catch {}
    return openRec(r, PKG.role, true);
  }
  
  const l = location.hash.match(/^#\/m\/([\w-]+)\/([\w-]*)/);
  if (l) return openLink(l[1], l[2]);
  
  if (EMB) return deny('Не указана карта для показа.');
  await nav(); home(); pull().then(nav); sync();
})();
})();
