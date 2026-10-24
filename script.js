/* Метод инициализации констант, категорий объектов и вспомогательных утилит (поиск DOM, генерация ID, экранирование HTML, расчет углов) */
const GW = 28, GH = 18, KEY = 'tk-spacemap-v1';
const CATS = {
  stand: ['🏷', 'Стенд'],
  hall: ['🎤', 'Зал'],
  door: ['🚪', 'Вход'],
  desk: ['🛎', 'Стойка'],
  wifi: ['📶', 'Wi-Fi'],
  food: ['☕', 'Кафе'],
  other: ['📍', 'Другое']
};
const $ = s => document.querySelector(s),
      uid = () => Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const brg = (a, b) => Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI;

/* Метод создания пустого объекта этажа с массивами для хранения залов, стен, коридоров, точек интереса и панорам */
const floor = (name, o = {}) => ({ id: 'f' + uid(), name, bg: null, bgo: .7, cor: [], walls: [], rooms: [], pois: [], panos: [], ...o });

/* Метод создания базовой структуры пустой карты (state по умолчанию) */
const blank = () => ({ name: '', floors: [floor('Этаж 1')] });

/* Метод миграции устаревшего формата данных (когда не было этажей) в новую структуру с поддержкой мультиэтажности и массивом стен */
function migrate(d) {
  if (!d.floors) {
    d.floors = [floor('Этаж 1', { id: 'f1', bg: d.bg || null, cor: d.cor || [], walls: d.walls || [], rooms: d.rooms || [], pois: d.pois || [], panos: d.panos || [] })];
    delete d.bg; delete d.cor; delete d.rooms; delete d.pois; delete d.panos; delete d.walls;
  }
  return d;
}

/* Метод загрузки сохраненных данных карты из локального хранилища браузера (localStorage) */
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)); }
  catch { return null; }
}

/* Инициализация глобальных переменных состояния приложения: режим работы, выбранный инструмент, активный маршрут, история отмен */
let S = blank(),
    mode = 'v',
    tool = 'sel',
    sh = null,
    route = null,
    unlocked = false,
    WS, RS, dr = null, pt = null, dg = null,
    undoStack = [];

let F = S.floors[0], fi = 0; 

/* Метод-обертка для передачи обновленного состояния карты (S) в ядро сохранения (сохраняет в IndexedDB) */
function save() { if (window.Core && Core.onSave) Core.onSave(S); }

/* Метод для отображения кратковременных всплывающих уведомлений (toast) на экране */
function toast(t) {
  const e = $('#toast');
  e.textContent = t;
  e.style.display = 'block';
  clearTimeout(toast.t);
  toast.t = setTimeout(() => e.style.display = 'none', 2600);
}

/* Метод для сохранения текущего состояния карты в стек истории отмен (с лимитом в 30 шагов) */
function pushState() {
  if (mode !== 'o') return;
  const cur = JSON.stringify({ fi, S });
  if (undoStack.length === 0 || undoStack[undoStack.length - 1] !== cur) {
    undoStack.push(cur);
    if (undoStack.length > 30) undoStack.shift();
  }
}

/* Метод для отмены последнего действия (Undo): извлекает предыдущее состояние из стека и перерисовывает карту */
function undo() {
  if (mode !== 'o' || undoStack.length === 0) return;
  const prev = JSON.parse(undoStack.pop());
  S = prev.S;
  fi = prev.fi;
  if (fi >= S.floors.length) fi = Math.max(0, S.floors.length - 1);
  F = S.floors[fi];
  sh = null; route = null; dr = null; pt = null; dg = null;
  save(); plan(); sheet();
  toast('Отменено');
}

/* Метод обработки клавиатурных сокращений (перехватывает Ctrl+Z или Cmd+Z для вызова функции отмены) */
window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
    undo();
    e.preventDefault();
  }
});

/* Методы-хелперы для быстрого поиска объектов (точек, панорам, залов) по их уникальному ID на текущем этаже */
const P = id => F.pois.find(p => p.id == id),
      N = id => F.panos.find(p => p.id == id),
      R_ = id => F.rooms.find(r => r.id == id);

/* Метод подготовки данных для поиска маршрута: собирает все проходимые клетки (коридоры и залы) в единую сетку (Set) */
function mk() {
  WS = new Set(F.cor);
  RS = new Set();
  F.rooms.forEach(r => {
    for (let i = 0; i < r.w; i++)
      for (let j = 0; j < r.h; j++) {
        const k = (r.x + i) + ',' + (r.y + j);
        WS.add(k);
        RS.add(k);
      }
  });
}

/* Метод поиска кратчайшего пути (алгоритм BFS) между двумя клетками на сетке, учитывающий препятствия в виде нарисованных стен */
function bfs(a, b) {
  const q = [[a.x, a.y]],
        prev = { [a.x + ',' + a.y]: null },
        t = b.x + ',' + b.y;
  
  const walls = new Set(F.walls || []);
        
  for (let i = 0; i < q.length && !(t in prev); i++) {
    const [x, y] = q[i];
    
    const moves = [
      [1, 0, `${x+1},${y},v`],
      [-1, 0, `${x},${y},v`],
      [0, 1, `${x},${y+1},h`],
      [0, -1, `${x},${y},h`]
    ];
    
    for (const [dx, dy, wall] of moves) {
      const nx = x + dx, ny = y + dy;
      const k = nx + ',' + ny;
      if (WS.has(k) && !(k in prev) && !walls.has(wall)) {
        prev[k] = x + ',' + y;
        q.push([nx, ny]);
      }
    }
  }
  
  if (!(t in prev)) return null;
  const p = [];
  for (let k = t; k; k = prev[k]) p.push(k.split(',').map(Number));
  return p.reverse();
}

/* Основной метод рендеринга 2D-плана: динамически генерирует SVG-код для фона, сетки, залов, коридоров, стен, точек интереса и маршрута */
function plan() {
  mk();
  const svg = $('#plan');
  let h = '', w = '', g = '';
  
  if (F.bg) h += `<image href="${F.bg}" width="28" height="18" preserveAspectRatio="xMidYMid meet" opacity="${F.bgo ?? .7}"/>`;
  
  WS.forEach(k => {
    const [x, y] = k.split(',').map(Number);
    h += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="var(--${RS.has(k) ? 'room' : 'cor'})"${F.bg ? ' fill-opacity=".55"' : ''}/>`;
    if (!WS.has(x + ',' + (y - 1))) w += `M${x} ${y}h1`;
    if (!WS.has(x + ',' + (y + 1))) w += `M${x} ${y + 1}h1`;
    if (!WS.has((x - 1) + ',' + y)) w += `M${x} ${y}v1`;
    if (!WS.has((x + 1) + ',' + y)) w += `M${x + 1} ${y}v1`;
  });
  
  if (mode == 'o') {
    for (let i = 0; i <= GW; i++) g += `M${i} 0v${GH}`;
    for (let j = 0; j <= GH; j++) g += `M0 ${j}h${GW}`;
    h += `<path d="${g}" stroke="var(--line)" stroke-width=".03" fill="none"/>`;
  }
  
  h += `<path d="${w}" stroke="var(--wall)" stroke-width=".16" stroke-linecap="square" fill="none"/>`;
  
  if (F.walls) {
    let wp = '';
    F.walls.forEach(k => {
      const [x, y, d] = k.split(',');
      if (d == 'h') wp += `M${x} ${y}h1`;
      if (d == 'v') wp += `M${x} ${y}v1`;
    });
    if (wp) {
      h += `<path d="${wp}" stroke="#a09b95" stroke-width=".26" stroke-linecap="round" fill="none"/>`;
      h += `<path d="${wp}" stroke="#ffffff" stroke-width=".16" stroke-linecap="round" fill="none"/>`;
    }
  }
  
  F.rooms.forEach(r => h += `<text x="${r.x + r.w / 2}" y="${r.y + .75}" class="lbl" style="font-size:.5px;fill:var(--mut);stroke:none">${esc(r.name)}</text>`);
  
  if (dr) {
    const x = Math.min(dr.x0, dr.x1), y = Math.min(dr.y0, dr.y1);
    h += `<rect x="${x}" y="${y}" width="${Math.abs(dr.x1 - dr.x0) + 1}" height="${Math.abs(dr.y1 - dr.y0) + 1}" fill="#e2231a44" stroke="#e2231a" stroke-width=".1"/>`;
  }
  
  if (route && route.path) h += `<polyline class="route" points="${route.path.map(p => (p[0] + .5) + ',' + (p[1] + .5)).join(' ')}"/>`;
  
  F.panos.forEach(n => h += `<g transform="translate(${n.x + .5} ${n.y + .5})">${dg && dg.moved && dg.it === n ? '<circle r=".6" fill="#e2231a33"/>' : ''}<circle r=".32" fill="var(--card)" stroke="var(--red)" stroke-width=".1"/><text y=".14" font-size=".36" text-anchor="middle">📷</text></g>`);
  
  F.pois.forEach(p => {
    const on = (sh && sh.id == p.id) || (dg && dg.moved && dg.it === p);
    h += `<g transform="translate(${p.x + .5} ${p.y + .5})">${on ? '<circle r=".62" fill="#e2231a33"/>' : ''}<circle r=".42" fill="var(--red)" stroke="#fff" stroke-width=".07"/><text y=".16" font-size=".46" text-anchor="middle">${CATS[p.cat][0]}</text><text y="1" class="lbl">${esc(p.name)}</text></g>`;
  });
  
  if (mode == 'o' && !F.bg && !WS.size) h += `<text x="14" y="9" class="lbl" style="font-size:.6px;fill:var(--mut);stroke:none">Загрузите готовый план (⚙ Карта) или нарисуйте залы и коридоры</text>`;
  svg.innerHTML = h;
  floorsBar();
  svg.style.touchAction = mode == 'o' && ['room', 'cor', 'wall', 'era'].includes(tool) ? 'none' : 'pan-y';
  $('#mname').textContent = S.name;
  $('#chips').innerHTML = F.pois.map(p => `<button data-c="${p.id}">${CATS[p.cat][0]} ${esc(p.name)}</button>`).join('');
}

/* Метод отрисовки панели управления этажами (создание кнопок переключения между этажами) */
function floorsBar() {
  const el = $('#floors');
  el.hidden = S.floors.length < 2 && mode != 'o';
  el.innerHTML = S.floors.map((f, i) => `<button data-fl="${i}" class="${i == fi ? 'on' : ''}">${esc(f.name)}</button>`).join('') +
    (mode == 'o' ? '<button data-fl="add" class="add">＋ Этаж</button>' : '');
}

/* Метод переключения активного этажа по его индексу и обновления отображения плана */
function goFloor(i) {
  if (i == fi || !S.floors[i]) return;
  fi = i; F = S.floors[i];
  if (!(sh && sh.t == 'menu')) sh = null;
  route = null; dr = null; dg = null;
  plan(); sheet();
}

/* Метод добавления нового пустого этажа в карту и переключения на него */
function addFloor() {
  pushState();
  const f = floor('Этаж ' + (S.floors.length + 1));
  S.floors.push(f); fi = S.floors.length - 1; F = f;
  route = null; sh = { t: 'menu' }; tool = 'menu';
  save(); tools(); plan(); sheet();
  toast('Этаж добавлен — загрузите план или нарисуйте залы');
}

/* Метод обработки кликов по панели этажей (делегирование событий на переключение или добавление) */
$('#floors').onclick = e => {
  const b = e.target.closest('[data-fl]');
  if (!b) return;
  if (b.dataset.fl == 'add') addFloor(); else goFloor(+b.dataset.fl);
};

/* Метод рендеринга панели инструментов организатора (выбор, рисование, точки, ластик, отмена) */
function tools() {
  $('#tools').innerHTML = [['sel', '☝ Выбор'], ['room', '▭ Зал'], ['cor', '▬ Коридор'], ['wall', '⬜ Стена'], ['era', '⌫ Ластик'], ['poi', '📍 Точка'], ['pano', '📷 Панорама'], ['undo', '↩ Назад'], ['menu', '⚙ Карта']]
    .map(([t, l]) => `<button data-t="${t}" class="${tool == t ? 'on' : ''}">${l}</button>`)
    .join('');
}

const svg = $('#plan');

/* Метод проверки, можно ли установить точку/панораму в указанные координаты сетки (чтобы не поставить друг на друга) */
const canPut = (x, y, it) => {
  const free = !WS.size && !!F.bg;
  return (free || WS.has(x + ',' + y)) && !F.pois.concat(F.panos).some(o => o !== it && o.x == x && o.y == y);
};

/* Метод преобразования экранных пиксельных координат события (мыши/касания) в целочисленные координаты клеток сетки 2D-плана */
function cell(e) {
  const r = svg.getBoundingClientRect();
  return [
    Math.min(GW - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * GW))),
    Math.min(GH - 1, Math.max(0, Math.floor((e.clientY - r.top) / r.height * GH)))
  ];
}

/* Метод вычисления ближайшей границы клетки (левая, правая, верхняя, нижняя) для точного рисования тонких стен */
function edge(e) {
  const r = svg.getBoundingClientRect();
  let rx = (e.clientX - r.left) / r.width * GW;
  let ry = (e.clientY - r.top) / r.height * GH;
  rx = Math.max(0, Math.min(GW, rx));
  ry = Math.max(0, Math.min(GH, ry));
  
  let x = Math.floor(rx), y = Math.floor(ry);
  if (x >= GW) x = GW - 1;
  if (y >= GH) y = GH - 1;
  
  const dx = rx - x, dy = ry - y;
  const distL = dx, distR = 1 - dx, distT = dy, distB = 1 - dy;
  const min = Math.min(distL, distR, distT, distB);

  if (min == distT) return `${x},${y},h`;
  if (min == distB) return `${x},${y+1},h`;
  if (min == distL) return `${x},${y},v`;
  return `${x+1},${y},v`;
}

/* Метод применения активного инструмента рисования (коридор, стена, ластик) к указанным координатам */
function paint(x, y, ed) {
  const k = x + ',' + y;
  if (tool == 'cor' && !WS.has(k)) { 
    F.cor.push(k); 
  }
  if (tool == 'wall') { 
    if (!F.walls) F.walls = [];
    if (!F.walls.includes(ed)) F.walls.push(ed);
  }
  if (tool == 'era') {
    if (F.cor) F.cor = F.cor.filter(c => c != k);
    if (F.walls) F.walls = F.walls.filter(w => w != ed);
    F.rooms = F.rooms.filter(r => !(x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h));
  }
  plan();
}

/* Метод-обработчик начала касания/нажатия мыши на SVG-карте (сохраняет стейт, фиксирует начальные координаты и начинает рисование) */
svg.onpointerdown = e => {
  if (mode == 'o') pushState();
  const [x, y] = cell(e);
  const ed = edge(e);
  svg.setPointerCapture(e.pointerId);
  pt = { x, y, lx: x, ly: y, le: ed, m: false };
  dg = null;
  if (mode == 'o' && ['sel', 'poi', 'pano'].includes(tool)) {
    const it = F.pois.find(p => p.x == x && p.y == y) || F.panos.find(p => p.x == x && p.y == y);
    if (it) dg = { it, moved: false };
  }
  if (mode == 'o') {
    if (tool == 'room') dr = { x0: x, y0: y, x1: x, y1: y };
    if (tool == 'cor' || tool == 'wall' || tool == 'era') paint(x, y, ed);
  }
};

/* Метод-обработчик движения мыши/пальца по карте (обновляет прямоугольник выделения зала, перемещает точки или продолжает рисование) */
svg.onpointermove = e => {
  if (!pt) return;
  const [x, y] = cell(e);
  const ed = edge(e);
  if (x == pt.lx && y == pt.ly && ed == pt.le) return;
  pt.lx = x; pt.ly = y; pt.le = ed; pt.m = true;
  if (dg) {
    if (canPut(x, y, dg.it)) { dg.it.x = x; dg.it.y = y; dg.moved = true; plan(); }
    return;
  }
  if (dr) { dr.x1 = x; dr.y1 = y; plan(); }
  else if (mode == 'o' && (tool == 'cor' || tool == 'wall' || tool == 'era')) paint(x, y, ed);
};

/* Метод-обработчик завершения касания (завершает рисование зала, сохраняет изменения в БД или определяет точечный клик 'tap') */
svg.onpointerup = e => {
  if (!pt) return;
  const { x, y } = pt;
  if (dg) {
    const d = dg; dg = null;
    if (d.moved) { pt = null; save(); plan(); return; }
  }
  if (dr) {
    const r = { id: 'r' + uid(), x: Math.min(dr.x0, dr.x1), y: Math.min(dr.y0, dr.y1), w: Math.abs(dr.x1 - dr.x0) + 1, h: Math.abs(dr.y1 - dr.y0) + 1, name: 'Новый зал' };
    dr = null;
    F.rooms.push(r);
    save();
    sh = { t: 'er', id: r.id };
    plan();
    sheet();
  }
  else if (mode == 'o' && (tool == 'cor' || tool == 'wall' || tool == 'era')) { save(); }
  else if (!pt.m) { tap(x, y); }
  pt = null;
};

/* Метод-обработчик отмены касания (например, если браузер прервал свайп) — возвращает перетаскиваемый объект на место */
svg.onpointercancel = () => { if (dg && dg.moved) save(); dg = null; pt = null; plan(); };

/* Метод предотвращения стандартной прокрутки экрана на мобильных устройствах во время перетаскивания объектов */
svg.addEventListener('touchmove', e => { if (dg) e.preventDefault(); }, { passive: false });

/* Метод обработки одиночного клика по клетке плана (открывает карточку объекта, ставит новую точку/панораму или выбирает зал) */
function tap(x, y) {
  const poi = F.pois.find(p => p.x == x && p.y == y),
        pn = F.panos.find(p => p.x == x && p.y == y),
        o = mode == 'o';
        
  if (poi) { sh = { t: o ? 'ep' : 'pv', id: poi.id }; }
  else if (pn) { if (o && tool != 'sel' || o) { sh = { t: 'en', id: pn.id }; } else { openPano(pn.id); } }
  else if (o && tool == 'poi' && canPut(x, y)) {
    const p = { id: 'p' + uid(), x, y, name: 'Новая точка', cat: 'other', desc: '' };
    F.pois.push(p); save(); sh = { t: 'ep', id: p.id };
  }
  else if (o && tool == 'pano' && canPut(x, y)) {
    const p = { id: 'n' + uid(), x, y, name: 'Панорама', demo: 'Панорама', rot: 0, hs: [] };
    F.panos.push(p); save(); sh = { t: 'en', id: p.id };
  }
  else if (o && tool == 'sel') {
    const r = F.rooms.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    sh = r ? { t: 'er', id: r.id } : null;
  }
  else sh = null;
  
  plan();
  sheet();
}

/* Метод поиска ближайшей панорамы к выбранной точке интереса (для предложения виртуального тура в карточке места) */
const nearPano = p => {
  let b = null, d = 6;
  F.panos.forEach(n => {
    const k = Math.hypot(n.x - p.x, n.y - p.y);
    if (k <= d) { d = k; b = n; }
  });
  return b;
};

/* Метод пересчета маршрута (запускает BFS) и формирования списка панорам (tour), находящихся поблизости от найденного пути */
function recalc() {
  if (!route) return;
  const a = P(route.from), b = P(route.to);
  route.path = a && b ? bfs(a, b) : null;
  route.tour = [];
  if (route.path) {
    const seen = new Set();
    route.path.forEach((c, i) => {
      F.panos.forEach(n => {
        if (!seen.has(n.id) && Math.hypot(n.x - c[0], n.y - c[1]) <= 2.5) {
          seen.add(n.id);
          route.tour.push(n.id);
        }
      });
    });
  }
}

/* Метод генерации HTML-кода для выпадающих списков (<option>), содержащих все точки интереса на этаже */
const opts = (sel) => F.pois.map(p => `<option value="${p.id}" ${p.id == sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

/* Метод-шаблон для генерации стандартного заголовка нижнего всплывающего окна (шторки) с иконкой и кнопкой закрытия */
const head = (ic, t, s) => `<div class="grab"></div><div class="row"><span class="ic">${ic}</span><div><h3>${esc(t)}</h3><small>${s}</small></div><button class="x" data-a="x">✕</button></div>`;

/* Основной метод рендеринга нижнего всплывающего окна (sheet), генерирующий HTML-содержимое в зависимости от выбранного объекта (карточка точки, настройки зала, меню) */
function sheet() {
  const el = $('#sheet');
  if (!sh) { el.className = ''; return; }
  el.className = 'open';
  let h = '';
  
  if (sh.t == 'pv') {
    const p = P(sh.id), n = nearPano(p);
    h = head(CATS[p.cat][0], p.name, CATS[p.cat][1]) + `<p>${esc(p.desc) || '<small>Описание пока не добавлено</small>'}</p><div class="btns"><button class="pri" data-a="to">Маршрут сюда</button>${n ? `<button data-a="pano" data-id="${n.id}">Смотреть панораму</button>` : ''}</div>`;
  }
  if (sh.t == 'ep') {
    const p = P(sh.id);
    h = head(CATS[p.cat][0], 'Точка', 'на плане и в панорамах') + `<label>Название</label><input type="text" data-f="name" value="${esc(p.name)}"><label>Категория</label><select data-f="cat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${k == p.cat ? 'selected' : ''}>${v[0]} ${v[1]}</option>`).join('')}</select><label>Описание</label><textarea data-f="desc">${esc(p.desc)}</textarea><div class="btns"><button class="pri" data-a="x">Готово</button><button class="del" data-a="delp">Удалить</button></div>`;
  }
  if (sh.t == 'en') {
    const p = N(sh.id);
    h = head('📷', 'Панорама', p.src ? 'своё фото' : 'без фото') + `<label>Название</label><input type="text" data-f="name" value="${esc(p.name)}"><label>Загрузить панораму 360° (equirectangular)</label><input type="file" accept="image/*" data-up="pano"><label>Поворот относительно плана: ${p.rot}°</label><input type="range" min="0" max="359" value="${p.rot}" data-f="rot" style="width:100%"><div class="btns"><button class="pri" data-a="pano" data-id="${p.id}">Открыть и добавить точки</button><button class="del" data-a="deln">Удалить</button></div>`;
  }
  if (sh.t == 'er') {
    const r = R_(sh.id);
    h = head('▭', 'Зал', 'помещение') + `<label>Название</label><input type="text" data-f="name" value="${esc(r.name)}"><div class="btns"><button class="pri" data-a="x">Готово</button><button class="del" data-a="delr">Удалить</button></div>`;
  }
  if (sh.t == 'rt') {
    recalc();
    const r = route, m = r.path ? (r.path.length - 1) * 2 : 0;
    h = head('🧭', 'Маршрут', 'по плану здания') + `<label>Откуда</label><select data-r="from">${opts(r.from)}</select><label>Куда</label><select data-r="to">${opts(r.to)}</select>` + (r.path ? `<div class="stat"><span>${m} м<small>путь</small></span><span>${Math.max(1, Math.round(m / 80))} мин<small>пешком</small></span><span>${r.tour.length}<small>панорам</small></span></div><div class="btns"><button class="pri" data-a="tour">Пройти по панорамам</button></div>` : `<p><small>${r.from == r.to ? 'Выберите разные точки.' : 'Маршрут не найден: проверьте, что коридоры соединены.'}</small></p>`);
  }
  if (sh.t == 'menu') {
    const full = { name: S.name, floors: S.floors.map(f => ({ ...f, bg: f.bg ? '…' : null, panos: f.panos.map(p => ({ ...p, src: p.src ? '…' : undefined })) })) };
    h = head('⚙', 'Карта', 'настройки организатора') +
      `<label>Название карты</label><input type="text" data-f="name" value="${esc(S.name)}">` +
      `<label>Этаж: название</label><input type="text" data-ff="name" value="${esc(F.name)}">` +
      `<label>План этажа: готовое изображение (JPG, PNG)</label><input type="file" accept="image/*" data-up="bg">` +
      (F.bg ? `<label>Прозрачность плана: ${Math.round((F.bgo ?? .7) * 100)}%</label><input type="range" min="10" max="100" value="${Math.round((F.bgo ?? .7) * 100)}" data-ff="bgo" style="width:100%">` : '') +
      `<div class="btns">${F.bg ? '<button data-a="nobg">Убрать план</button>' : ''}${S.floors.length > 1 ? '<button class="del" data-a="delf">Удалить этаж</button>' : ''}</div>` +
      `<label>План этажа из JSON-файла</label><input type="file" accept=".json,application/json" data-up="json"><div class="btns"><button data-a="dlfloor">⬇ Скачать этаж (.json)</button></div><p><small>Файл можно загрузить на любой этаж; формат тот же, что даёт «Скачать этаж».</small></p>` +
      `<label>Данные карты (JSON) — копируйте или вставьте для переноса</label><textarea id="json" style="min-height:90px">${esc(JSON.stringify(full))}</textarea>` +
      `<div class="btns"><button data-a="imp">Применить JSON</button></div><p><small>Изменения сохраняются автоматически на устройстве.</small></p>`;
  }
  
  if (h) el.innerHTML = h;
}

/* Метод получения объекта, который в данный момент редактируется в открытой шторке (точка, панорама, зал или вся карта) */
const cur = () => sh.t == 'ep' ? P(sh.id) : sh.t == 'en' ? N(sh.id) : sh.t == 'er' ? R_(sh.id) : sh.t == 'menu' ? S : null;

/* Метод-обработчик ввода текста в поля шторки: мгновенно сохраняет изменения атрибутов текущего объекта (имя, описание, прозрачность плана) */
$('#sheet').oninput = e => {
  const t = e.target, o = cur();
  if (t.dataset.ff) {
    const range = t.type == 'range';
    F[t.dataset.ff] = range ? +t.value / 100 : t.value;
    if (range) t.previousElementSibling.textContent = 'Прозрачность плана: ' + t.value + '%';
    save(); plan();
    return;
  }
  if (o && t.dataset.f) {
    o[t.dataset.f] = t.type == 'range' ? +t.value : t.value;
    if (t.type == 'range') t.previousElementSibling.textContent = 'Поворот относительно плана: ' + t.value + '°';
    save();
    plan();
  }
};

/* Метод валидации URL-строк: проверяет, является ли строка безопасной ссылкой (http/data:image) без XSS-символов */
const okUrl = u => typeof u == 'string' && /^(https?:\/\/|data:image\/)/.test(u) && !/["<>\s]/.test(u);

/* Метод проверки, является ли этаж полностью пустым (нет фона, стен, точек и комнат) */
const isEmpty = f => !f.bg && !f.cor.length && !f.rooms.length && !f.pois.length && !f.panos.length;

/* Метод очистки импортируемого JSON-файла этажа: удаляет мусор, проверяет выход за границы сетки и генерирует уникальные ID */
function cleanFloor(f, used) {
  if (!f || typeof f != 'object') throw new Error('bad floor');
  const arr = v => Array.isArray(v) ? v : [], int = v => Number.isFinite(+v) ? Math.round(+v) : NaN,
        inGrid = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH,
        uniq = (id, pre) => { id = id == null ? '' : String(id); while (!id || used.has(id)) id = pre + uid(); used.add(id); return id; };
  const cor = [...new Set(arr(f.cor).map(c => Array.isArray(c) ? c.join(',') : String(c)).filter(k => {
    const p = k.split(',').map(Number);
    return p.length == 2 && p.every(Number.isInteger) && inGrid(p[0], p[1]);
  }))];
  const walls = [...new Set(arr(f.walls).map(c => Array.isArray(c) ? c.join(',') : String(c)).filter(k => {
    const p = k.split(',');
    return p.length == 3 && Number.isInteger(+p[0]) && Number.isInteger(+p[1]) && (p[2] == 'h' || p[2] == 'v');
  }))];
  const rooms = arr(f.rooms).map(r => ({ x: int(r.x), y: int(r.y), w: int(r.w), h: int(r.h), name: String(r.name ?? 'Зал'), id: r.id }))
    .filter(r => [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0 && inGrid(r.x, r.y))
    .map(r => ({ ...r, w: Math.min(r.w, GW - r.x), h: Math.min(r.h, GH - r.y), id: uniq(r.id, 'r') }));
  const pois = arr(f.pois).map(p => ({ id: p.id, x: int(p.x), y: int(p.y), name: String(p.name ?? 'Точка'), cat: CATS[p.cat] ? p.cat : 'other', desc: String(p.desc ?? '') }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && inGrid(p.x, p.y))
    .map(p => ({ ...p, id: uniq(p.id, 'p') }));
  const ids = new Set(pois.map(p => p.id));
  const panos = arr(f.panos).map(n => ({ id: n.id, x: int(n.x), y: int(n.y), name: String(n.name ?? 'Панорама'), rot: Number.isFinite(+n.rot) ? +n.rot : 0,
      src: okUrl(n.src) ? n.src : (n.src == '…' ? '…' : undefined), hs: arr(n.hs).filter(h => ids.has(h.poi) && Number.isFinite(+h.yaw) && Number.isFinite(+h.pitch)).map(h => ({ poi: h.poi, yaw: +h.yaw, pitch: +h.pitch })) }))
    .filter(n => Number.isFinite(n.x) && Number.isFinite(n.y) && inGrid(n.x, n.y))
    .map(n => { n.id = uniq(n.id, 'n'); if (!n.src) { delete n.src; n.demo = n.name; } return n; });
  return { name: String(f.name || ''), bg: f.bg == '…' ? '…' : (okUrl(f.bg) ? f.bg : null), bgo: Number.isFinite(+f.bgo) ? Math.min(1, Math.max(.1, +f.bgo)) : .7, cor, walls, rooms, pois, panos };
}

/* Метод импорта плана из текстовой JSON-строки: парсит файл, очищает его и интегрирует в текущую карту с сохранением существующих изображений */
function importPlan(text) {
  const j = JSON.parse(text);
  if (!j || typeof j != 'object') throw new Error('bad json');
  const list = Array.isArray(j.floors) ? j.floors : [j];
  if (!list.length) throw new Error('no floors');
  const multi = list.length > 1;
  const used = new Set();
  if (!multi) S.floors.forEach(f => { if (f !== F) f.panos.forEach(p => used.add(p.id)); });
  const clean = list.map(f => cleanFloor(f, used));
  const had = multi ? S.floors.some(f => !isEmpty(f)) : !isEmpty(F);
  if (had && !confirm(multi ? 'Заменить все этажи карты данными из файла?' : 'Заменить содержимое этажа «' + F.name + '» данными из файла?')) return null;
  const keepBg = (c, old) => { if (c.bg == '…') c.bg = old ? old.bg : null; c.panos.forEach(p => { if (p.src == '…') { const o = old && old.panos.find(q => q.id == p.id); if (o && o.src) p.src = o.src; else { delete p.src; p.demo = p.name; } } }); };
  if (multi) {
    const old = S.floors;
    S.floors = clean.map((c, i) => { keepBg(c, old[i]); return floor(c.name || 'Этаж ' + (i + 1), { ...c, name: c.name || 'Этаж ' + (i + 1) }); });
    fi = 0; F = S.floors[0];
  } else {
    const c = clean[0]; keepBg(c, F);
    Object.assign(F, c, { id: F.id, name: c.name || F.name });
  }
  TX = {}; route = null;
  return clean.reduce((a, c) => ({ rooms: a.rooms + c.rooms.length, pois: a.pois + c.pois.length, panos: a.panos + c.panos.length }), { rooms: 0, pois: 0, panos: 0 });
}

/* Метод экспорта: формирует JSON-файл из данных текущего этажа и скачивает его на устройство пользователя */
function downloadFloor() {
  const blob = new Blob([JSON.stringify(F, null, 1)], { type: 'application/json' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = ((S.name || 'map') + '_' + F.name).replace(/[^\p{L}\p{N}]+/gu, '_') + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4e4);
}

/* Метод-обработчик загрузки файлов через <input type="file"> в шторке: загружает фоновые планы, JSON-карты или 360-панорамы в облако */
$('#sheet').onchange = async e => {
  const t = e.target;
  if (t.dataset.r) { route[t.dataset.r] = t.value; sheet(); plan(); return; }
  if (t.dataset.f == 'cat') { sheet(); }
  
  if (t.dataset.up && t.files[0]) {
    pushState();
    const file = t.files[0];
    
    if (t.dataset.up == 'bg') {
        toast('Загружаем план…');
        let url = null;
        try { url = window.uploadImage ? await window.uploadImage(file, { max: 2400, q: .9, prefix: 'plans/' }) : null; } catch {}
        if (url) { F.bg = url; save(); plan(); sheet(); toast('План загружен'); }
        else img(file, 1600, src => { F.bg = src; save(); plan(); sheet(); toast('План применён (сохранён на этом устройстве)'); });
    } else if (t.dataset.up == 'json') {
        try {
          const r = importPlan(await file.text());
          if (r) { save(); plan(); sheet(); toast('План загружен: залов ' + r.rooms + ', точек ' + r.pois + ', панорам ' + r.panos); }
          else { sheet(); }
        } catch (err) { console.error('plan json', err); toast('Не удалось прочитать файл: это не JSON плана'); sheet(); }
    } else {
        toast('Загружаем панораму в облако...');
        try {
            const publicUrl = await window.uploadPanorama(file);
            
            if (publicUrl) {
                const n = N(sh.id); 
                n.src = publicUrl; 
                n.demo = null; 
                delete TX[n.id];
                save(); plan(); sheet(); toast('Панорама загружена'); 
            } else {
                /* ошибка уже показана в uploadPanorama */
            }
        } catch (err) {
            toast('Ошибка при загрузке');
        }
    }
  }
};

/* Метод конвертации изображения в строку Base64 для локального сохранения, если загрузка в облако недоступна */
function img(f, mx, cb) {
  const fr = new FileReader();
  fr.onload = () => {
    const i = new Image();
    i.onload = () => {
      const pano = mx == 2048, k = Math.min(1, mx / i.width),
            c = document.createElement('canvas');
      c.width = pano ? 2048 : i.width * k;
      c.height = pano ? 1024 : i.height * k;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(i, 0, 0, c.width, c.height);
      cb(c.toDataURL('image/jpeg', .82));
    };
    i.src = fr.result;
  };
  fr.readAsDataURL(f);
}

/* Метод-маршрутизатор кликов по кнопкам в нижнем меню (шторке): удаление точек, построение маршрута, открытие панорам, скачивание и т.д. */
$('#sheet').onclick = e => {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const a = b.dataset.a;
  
  if (['delp', 'deln', 'delr', 'nobg', 'imp', 'delf'].includes(a)) pushState();

  if (a == 'x') { sh = null; }
  if (a == 'to') { route = { from: (F.pois.find(p => p.id != sh.id) || {}).id, to: sh.id }; sh = { t: 'rt' }; }
  if (a == 'pano') { openPano(b.dataset.id, undefined); return; }
  if (a == 'tour') { if (!route.tour.length) return toast('Вдоль маршрута нет панорам'); openPano(route.tour[0], route.tour); return; }
  if (a == 'delp') { F.pois = F.pois.filter(p => p.id != sh.id); F.panos.forEach(n => n.hs = n.hs.filter(h => h.poi != sh.id)); sh = null; }
  if (a == 'deln') { F.panos = F.panos.filter(p => p.id != sh.id); sh = null; }
  if (a == 'delr') { F.rooms = F.rooms.filter(r => r.id != sh.id); sh = null; }
  if (a == 'dlfloor') { downloadFloor(); return; }
  if (a == 'nobg') { F.bg = null; }
  if (a == 'imp') {
    try {
      const j = JSON.parse($('#json').value);
      if (j.floors) {
        const old = {}; S.floors.forEach(f => f.panos.forEach(p => old[p.id] = p.src));
        j.floors.forEach(f => {
          const o = S.floors.find(x => x.id == f.id);
          if (f.bg == '…') f.bg = o ? o.bg : null;
          (f.panos || []).forEach(p => { p.src = old[p.id]; });
        });
        S = { ...S, ...j };
        S.floors.forEach(f => Object.assign(f, { cor: f.cor || [], walls: f.walls || [], rooms: f.rooms || [], pois: f.pois || [], panos: f.panos || [] }));
      } else { 
        const keep = {}; F.panos.forEach(p => keep[p.id] = p.src);
        (j.panos || []).forEach(p => { p.src = keep[p.id]; });
        Object.assign(F, { cor: j.cor || [], walls: j.walls || [], rooms: j.rooms || [], pois: j.pois || [], panos: j.panos || [] });
        if (j.name) S.name = j.name;
      }
      fi = Math.min(fi, S.floors.length - 1); F = S.floors[fi];
      toast('Карта обновлена');
    } catch { toast('Не удалось прочитать JSON'); }
  }
  if (a == 'delf' && S.floors.length > 1 && confirm('Удалить этаж «' + F.name + '» со всеми точками и панорамами?')) {
    S.floors.splice(fi, 1);
    fi = Math.min(fi, S.floors.length - 1); F = S.floors[fi];
    sh = null; route = null; tool = 'sel'; tools();
  }
  save(); plan(); sheet();
};

/* Метод-обработчик клика по карточкам-чипсам на 2D-плане для открытия подробной информации */
$('#chips').onclick = e => {
  const b = e.target.closest('[data-c]');
  if (b) { sh = { t: 'pv', id: b.dataset.c }; plan(); sheet(); }
};

/* Метод-обработчик главной плавающей кнопки (FAB) для открытия интерфейса построения маршрута */
$('#rbtn').onclick = () => {
  route = route || { from: F.pois[0]?.id, to: F.pois[1]?.id };
  sh = { t: 'rt' }; plan(); sheet();
};

/* Метод-обработчик выбора инструмента в панели редактирования (записывает выбранный tool или вызывает функцию 'undo'/'menu') */
$('#tools').onclick = e => {
  const b = e.target.closest('[data-t]');
  if (!b) return;
  if (b.dataset.t == 'undo') { undo(); return; }
  tool = b.dataset.t;
  if (tool == 'menu') { sh = { t: 'menu' }; }
  else if (sh && sh.t == 'menu') sh = null;
  tools(); plan(); sheet();
};


/* Метод переключения глобального режима работы приложения: 'v' (посетитель/view) или 'o' (организатор/owner), скрывает и показывает панели */
function setMode(m) {
  mode = m;
  document.body.classList.toggle('o', m == 'o');
  $('#mv').className = m == 'v' ? 'on' : '';
  $('#mo').className = m == 'o' ? 'on' : '';
  sh = null; route = null; tool = 'sel';
  tools(); plan(); sheet();
}

/* Метод привязки кнопки 'Посетитель' к переключению в режим просмотра */
$('#mv').onclick = () => setMode('v');

/* Метод привязки кнопки 'Организатор' к переключению в режим редактирования (срабатывает только если есть права 'unlocked') */
$('#mo').onclick = () => {
  if (unlocked) setMode('o');
};


let RN, SC, CAM, MESH, V = null, TX = {}, raf = 0;
const cv = $('#cv');

/* Метод генерации текстуры-заглушки (цветного фона с текстом), которая отображается в 3D-просмотре, если настоящая панорама еще не загружена */
function gen(name) {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 1024;
  const g = c.getContext('2d');
  let hue = 0;
  for (const ch of name) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  
  let q = g.createLinearGradient(0, 0, 0, 512);
  q.addColorStop(0, '#2a2a2e');
  q.addColorStop(.25, `hsl(${hue},10%,88%)`);
  q.addColorStop(1, `hsl(${hue},12%,74%)`);
  g.fillStyle = q; g.fillRect(0, 0, 2048, 512);
  
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? '#0000000d' : '#ffffff22';
    g.fillRect(i * 128, 120, 128, 392);
  }
  
  g.fillStyle = '#e2231a'; g.fillRect(0, 400, 2048, 22);
  
  q = g.createLinearGradient(0, 512, 0, 1024);
  q.addColorStop(0, '#a09b95');
  q.addColorStop(1, '#2e2c2a');
  g.fillStyle = q; g.fillRect(0, 512, 2048, 512);
  
  g.strokeStyle = '#ffffff22'; g.lineWidth = 3;
  for (let i = 0; i < 32; i++) {
    g.beginPath(); g.moveTo(i * 64, 512); g.lineTo(i * 64, 1024); g.stroke();
  }
  for (const y of [560, 640, 760, 900]) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(2048, y); g.stroke();
  }
  
  g.fillStyle = '#fff';
  for (let i = 0; i < 16; i++) { g.fillRect(i * 128 + 40, 36, 48, 10); }
  
  g.fillStyle = '#1a1a1a'; g.font = '800 84px Manrope,Arial,sans-serif'; g.textAlign = 'center';
  [1024, 0, 2048, 512, 1536].forEach(x => g.fillText(name, x, 330));
  g.font = '600 36px Manrope,Arial,sans-serif'; g.fillStyle = '#6d6a66';
  g.fillText('панорама не загружена', 1024, 462);
  
  return c;
}

/* Метод загрузки текстуры панорамы: скачивает изображение по URL (CORS), кэширует его в TX и подставляет на 3D-сферу (или выдает заглушку) */
function tex(p) {
  if (TX[p.id]) return TX[p.id];
  const t = p.src ? new THREE.TextureLoader().setCrossOrigin('anonymous').load(p.src, undefined, undefined, () => fetch(p.src, { method: 'HEAD' }).then(r => { console.error('pano load failed', p.src, r.status); toast(r.ok ? 'Панорама скачивается, но не читается как изображение' : 'Панорама недоступна: HTTP ' + r.status + ' (бакет не публичный или файл удалён)'); }).catch(() => toast('Панорама не загрузилась: нет сети или заблокировано CORS'))) : new THREE.CanvasTexture(gen(p.demo || p.name));
  t.wrapS = THREE.RepeatWrapping; t.offset.x = -.25;
  t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return TX[p.id] = t;
}

/* Метод перевода сферических координат в 3D-вектор для правильного позиционирования маркеров на панораме */
const vec = (y, p) => {
  const a = y * Math.PI / 180, b = p * Math.PI / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(b), Math.sin(b), -Math.cos(a) * Math.cos(b));
};

/* Метод запуска 3D-движка Three.js: создает сцену, сферу, камеру, натягивает на нее панораму и включает полноэкранный режим просмотра */
function openPano(id, tour) {
  if (typeof THREE == 'undefined') return toast('Не удалось загрузить 3D-библиотеку');
  if (!RN) {
    RN = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    RN.setPixelRatio(Math.min(devicePixelRatio, 2));
    SC = new THREE.Scene();
    CAM = new THREE.PerspectiveCamera(75, 1, .1, 1100);
    const g = new THREE.SphereGeometry(500, 48, 32);
    g.scale(-1, 1, 1);
    MESH = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    SC.add(MESH);
  }
  const p = N(id);
  V = { ...(V || { yaw: 0, pitch: 0, fov: 75 }), id, add: false, tour: tour === undefined ? (V && V.tour) : tour };
  sh = null; sheet();
  $('#pv').hidden = false;
  MESH.material.map = tex(p);
  MESH.material.needsUpdate = true;
  $('#pvn').textContent = p.name;
  $('#pvinfo').style.display = 'none';
  build(); bar();
  if (!raf) loop();
}

/* Метод сборки интерактивных HTML-маркеров (хотспотов) поверх 3D-канваса: добавляет точки интереса и стрелки перехода к соседним панорамам */
function build() {
  const p = N(V.id); V.hs = [];
  p.hs.forEach((s, i) => {
    const o = P(s.poi);
    if (o) V.hs.push({ yaw: s.yaw, pitch: s.pitch, html: `<button class="hs" data-i="${i}"><i>${CATS[o.cat][0]}</i>${esc(o.name)}</button>` });
  });
  F.panos.forEach(q => {
    if (q.id != p.id && Math.hypot(q.x - p.x, q.y - p.y) <= 11) V.hs.push({ yaw: brg(p, q) + p.rot, pitch: -16, html: `<button class="hs go" data-g="${q.id}"><i>↑</i>${esc(q.name)}</button>` });
  });
  $('#hsl').innerHTML = V.hs.map(x => x.html).join('');
  V.els = [...$('#hsl').children];
}

/* Метод отрисовки навигационной панели внутри 3D-тура (кнопки "вперед/назад" по маршруту и кнопка "Добавить точку" для организаторов) */
function bar() {
  const t = V.tour, i = t ? t.indexOf(V.id) : -1;
  $('#pvbar').innerHTML = (t && i >= 0 ? `<button data-v="prev" ${i ? '' : 'disabled'}>◀</button><button>${i + 1} / ${t.length}</button><button data-v="next" ${i < t.length - 1 ? '' : 'disabled'}>▶</button>` : '') + (mode == 'o' ? `<button data-v="add" class="${V.add ? 'on' : ''}">＋ Точка на панораме</button>` : '');
}

/* Главный цикл рендеринга 3D (requestAnimationFrame): постоянно перерисовывает сцену, реагирует на движения камеры и приклеивает HTML-маркеры к 3D-координатам */
function loop() {
  raf = requestAnimationFrame(loop);
  if ($('#pv').hidden) { cancelAnimationFrame(raf); raf = 0; return; }
  const w = cv.clientWidth, h = cv.clientHeight;
  if (V.w != w || V.h != h) { V.w = w; V.h = h; RN.setSize(w, h, false); }
  CAM.aspect = w / h; CAM.fov = V.fov; CAM.updateProjectionMatrix();
  const d = vec(V.yaw, V.pitch);
  CAM.lookAt(d); CAM.updateMatrixWorld();
  RN.render(SC, CAM);
  V.hs.forEach((s, i) => {
    const v = vec(s.yaw, s.pitch), el = V.els[i];
    if (v.dot(d) < .2) { el.style.display = 'none'; return; }
    const q = v.multiplyScalar(50).project(CAM);
    el.style.display = 'flex';
    el.style.transform = `translate(${(q.x + 1) / 2 * w}px,${(1 - q.y) / 2 * h}px) translate(-50%,-50%)`;
  });
}

let gd = null;

/* Метод-перехватчик начала вращения панорамы: запоминает координаты касания мыши или пальца на 3D-холсте */
cv.onpointerdown = e => { gd = { x: e.clientX, y: e.clientY, m: 0 }; cv.setPointerCapture(e.pointerId); };

/* Метод-обработчик движения: вращает камеру панорамы, рассчитывая сдвиг по осям X (yaw) и Y (pitch) с учетом текущего зума (fov) */
cv.onpointermove = e => {
  if (!gd) return;
  const dx = e.clientX - gd.x, dy = e.clientY - gd.y;
  gd.m += Math.abs(dx) + Math.abs(dy);
  gd.x = e.clientX; gd.y = e.clientY;
  const k = V.fov / cv.clientHeight;
  V.yaw -= dx * k; V.pitch = Math.max(-85, Math.min(85, V.pitch + dy * k));
};

/* Метод-обработчик отпускания мыши на панораме: если сдвиг минимальный (клик), открывает диалог привязки новой точки к этим 3D-координатам */
cv.onpointerup = e => {
  if (gd && gd.m < 6) {
    $('#pvinfo').style.display = 'none';
    if (V.add) {
      const r = cv.getBoundingClientRect(),
            v = new THREE.Vector3((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height * 2 - 1), .5).unproject(CAM).normalize();
      V.pend = { yaw: Math.atan2(v.x, -v.z) * 180 / Math.PI, pitch: Math.asin(v.y) * 180 / Math.PI };
      const i = $('#pvinfo');
      i.style.display = 'block';
      i.innerHTML = `<label style="margin-top:0">Какую точку закрепить здесь?</label><select id="hsel">${opts()}</select><div class="btns"><button class="pri" data-v="hok">Закрепить</button></div>`;
    }
  }
  gd = null;
};

/* Метод для работы зума в 3D (приближение/отдаление) с помощью колесика мыши (изменяет FOV камеры) */
cv.onwheel = e => { V.fov = Math.max(40, Math.min(100, V.fov + e.deltaY * .05)); };

/* Метод обработки всех интерфейсных кликов поверх 3D-панорамы (закрытие плеера, переходы по туру, привязка или отвязка точек организатором) */
$('#pv').onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset, t = V.tour, i = t ? t.indexOf(V.id) : -1, inf = $('#pvinfo');
  
  if (d.v == 'close') { $('#pv').hidden = true; V = null; return; }
  if (d.v == 'prev' && i > 0) openPano(t[i - 1]);
  if (d.v == 'next' && i < t.length - 1) openPano(t[i + 1]);
  if (d.v == 'add') {
    V.add = !V.add; bar();
    inf.style.display = 'block';
    inf.innerHTML = V.add ? '<small>Коснитесь панорамы там, где нужно разместить точку.</small>' : '';
    if (!V.add) inf.style.display = 'none';
  }
  if (d.v == 'hok') {
    N(V.id).hs.push({ poi: $('#hsel').value, ...V.pend });
    V.add = false; save(); build(); bar(); inf.style.display = 'none';
  }
  if (d.g) { V.tour = t && t.includes(d.g) ? t : null; openPano(d.g); }
  if (d.i !== undefined) {
    const s = N(V.id).hs[+d.i], o = P(s.poi);
    inf.style.display = 'block';
    inf.innerHTML = `<h3>${CATS[o.cat][0]} ${esc(o.name)}</h3><p style="margin:6px 0 0">${esc(o.desc)}</p>` + (mode == 'o' ? `<div class="btns"><button class="del" data-v="dh" data-i="${d.i}">Убрать с панорамы</button></div>` : '');
  }
  if (d.v == 'dh') {
    N(V.id).hs.splice(+d.i, 1);
    save(); build(); inf.style.display = 'none';
  }
};


/* Глобальный метод инициализации карты (вызывается из app.js): очищает старые кэши, скрывает 3D, включает нужный режим прав доступа */
window.Core = {
  open(d, r) {
    S = migrate(d); fi = 0; F = S.floors[0]; TX = {}; route = null; sh = null;
    undoStack = [];
    if (V) { $('#pv').hidden = true; V = null; }
    unlocked = r != 'view';
    setMode('v');
    $('.seg').style.display = unlocked ? '' : 'none';
  }
};

/* Метод поддержки мультитач-жестов на смартфонах: запоминает первое касание экрана на 3D-панораме */
const pts = new Map();
cv.addEventListener('pointerdown', e => { pts.set(e.pointerId, e); if (pts.size == 2) gd = null; });

/* Метод-обработчик жеста 'щипок' (pinch-to-zoom) на смартфонах: измеряет дистанцию между двумя пальцами и плавно меняет угол обзора (зум) панорамы */
cv.addEventListener('pointermove', e => {
  if (!pts.has(e.pointerId)) return;
  const two = pts.size == 2, [a, b] = [...pts.values()],
        before = two ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) : 0;
  pts.set(e.pointerId, e);
  if (two && V) {
    const [c, d] = [...pts.values()];
    V.fov = Math.max(40, Math.min(100, V.fov * before / Math.max(1, Math.hypot(c.clientX - d.clientX, c.clientY - d.clientY))));
  }
});

/* Методы очистки массива касаний при отрывании пальца от экрана смартфона, чтобы мультитач-жесты не сбоили */
cv.addEventListener('pointerup', e => pts.delete(e.pointerId));
cv.addEventListener('pointercancel', e => { pts.delete(e.pointerId); gd = null; });
