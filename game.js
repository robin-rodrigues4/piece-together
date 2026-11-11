(() => {
'use strict';
// Gallery indexes are part of saved room state. Append new pictures to preserve existing rooms.
const scenes = [
  ["Golden Morning","1470252649378-9c29740c9fa8",0],
  ["Mountain Lake","1470770841072-f978cf4d019e",0],
  ["Forest Light","1441974231531-c6227db76b6e",0],
  ["Ocean Breeze","1500375592092-40eb2168fd21",0],
  ["Gallery Colors","1579783902614-a3fb3927b6a5",1],
  ["Color Study","1541961017774-22349e4a1262",1],
  ["Artist’s Studio","1513364776144-60967b0f800f",1],
  ["Painted Layers","1577083552431-6e5fd01aa342",1],
  ["Better Together","1516589178581-6cd7833ae3b2",2],
  ["Sweetheart","1518199266791-5375a83190b7",2],
  ["Wedding Day","1529636798458-92182e662485",2],
  ["For You","1518895949257-7621c3c786d7",2],
  ["Paris","1502602898657-3e91760cbb34",3],
  ["Tokyo","1540959733332-eab4deabeeaf",3],
  ["Santorini","1613395877344-13d4a8e0d49e",3],
  ["Taj Mahal","1564507592333-c60657eea523",3],
  ["Curious Cat","1514888286974-6c03e2ca1dba",4],
  ["Good Dog","1543466835-00a7907e9de1",4],
  ["Woodland Fox","1474511320723-9a56873867b5",4],
  ["Woodland Watch","1472396961693-142e6e269027",4],
  ["Coffee Break","1509042239860-f550ce710b93",5],
  ["Pizza Night","1574071318508-1cdbab80d002",5],
  ["Fresh Berries","1464965911861-746a04b4bca6",5],
  ["Bakery Morning","1555507036-ab1f4038808a",5]
];
const categories = ["Nature","Art","Love","Travel","Animals","Food & Drink"];
const photo = (id, width) => 'https://images.unsplash.com/photo-' + scenes[id][1] + '?auto=format&fit=crop&w=' + width + '&q=85';
const $ = id => document.getElementById(id);
const board = $('board');
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
};
const bytes = n => crypto.getRandomValues(new Uint8Array(n));
const hex = data => [...data].map(n => n.toString(16).padStart(2, '0')).join('');
const unhex = str => Uint8Array.from(str.match(/../g), n => parseInt(n, 16));
const id = hex(bytes(12));
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const local = new URL(location.href).searchParams.has('local');
const dimensions = {12:[4,3],20:[5,4],30:[6,5],48:[8,6],70:[10,7]};
const boardX = 38, boardY = 31, boardWidth = 524, boardHeight = 388;
let room, key, topic, host = false, guestId, peerSeen = 0, online = false;
let sendWire, inbound = Promise.resolve(), outbound = Promise.resolve();
let model, cells = [], nodes = [], piecesLayer, imageHint, selected = null, drag = null, version = 0, receivedVersion = -1;
let locks = new Map(), movingAt = 0, shown = false;
let trayButtons = [], edgesOnly = false, customPhoto = null, viewport, pingLayer;
let zoom = 1, offsetX = 0, offsetY = 0, panMode = false, pingMode = false, gesture, pointers = new Map();
let mySeat = null;
let term = 0, leader = null, checkpoint, electionAt = 0, lastPing = 0, blocked = false;
const saveDays = 7;
const roomLife = saveDays * 86400;
const hintText = 'Tap a tray piece, then tap the board. Pinch to zoom.';
const storageKey = () => 'piece-v2-' + room;
const safeStorage = (method, ...args) => {
  try { return sessionStorage[method](...args); } catch { return null; }
};
function announce(message) { $('hint').textContent = message; }
function status(message) { $('status').textContent = message; $('status').hidden = false; }

let activeCategory = 0;
let selectedScene = 0;
const categoryButtons = categories.map((name,index)=>{
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = name;
  button.addEventListener('click',()=>{
    activeCategory = index;
    renderGallery();
  });
  $('categories').append(button);
  return button;
});
function updateGallerySelection() {
  const inputs = $('gallery').querySelectorAll('input');
  for (const input of inputs) input.checked = !customPhoto && Number(input.value) === selectedScene;
  $('picture-selection').textContent = 'Selected: '+(customPhoto ? 'Your photo' : scenes[selectedScene][0]);
}
function chooseScene(index) {
  selectedScene = index;
  customPhoto = null;
  $('photo-status').textContent = '';
  updateGallerySelection();
}
function renderGallery() {
  categoryButtons.forEach((button,i)=>button.setAttribute('aria-pressed',i === activeCategory));
  const gallery = $('gallery');
  gallery.replaceChildren();
  for (const [index,[name,,category]] of scenes.entries()) {
    if (category !== activeCategory) continue;
    const label = document.createElement('label');
    label.className = 'scene';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'scene';
    input.value = index;
    input.addEventListener('change',()=>chooseScene(index));
    const img = document.createElement('img');
    img.src = photo(index,360);
    img.alt = '';
    img.decoding = 'async';
    const caption = document.createElement('span');
    caption.textContent = name;
    label.append(input,img,caption);
    gallery.append(label);
  }
  updateGallerySelection();
}
$('shuffle-picture').addEventListener('click',()=>{
  const other = scenes.map((_,i)=>i).filter(i=>customPhoto || i !== selectedScene);
  const index = other[Math.floor(Math.random()*other.length)];
  activeCategory = scenes[index][2];
  chooseScene(index);
  renderGallery();
});
renderGallery();

function makeModel(scene, count) {
  const order = Array.from({length: count}, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {scene, count, customPhoto: scene === -1 ? customPhoto : null,
    pieces: order.map(slot => ({x:300,y:230,done:false,tray:true,slot}))};
}

function edge(x,y,dx,dy,sign) {
  const pos = (u,v) => (x + dx*u - dy*v*sign) + ' ' + (y + dy*u + dx*v*sign);
  if (!sign) return 'L ' + pos(1,0);
  return 'L ' + pos(.36,0) + ' C ' + pos(.44,0) + ' ' + pos(.39,.08) + ' ' + pos(.39,.13) +
    ' C ' + pos(.39,.26) + ' ' + pos(.61,.26) + ' ' + pos(.61,.13) +
    ' C ' + pos(.61,.08) + ' ' + pos(.56,0) + ' ' + pos(.64,0) + ' L ' + pos(1,0);
}
function shape(r,c,cols,rows,w,h) {
  const horizontal = (row,col) => (row * 7 + col * 3 + Math.floor(col / 2)) % 2 ? 1 : -1;
  const vertical = (row,col) => (row * 3 + col * 5 + Math.floor(row / 2)) % 2 ? 1 : -1;
  const x = -w/2, y = -h/2;
  return 'M ' + x + ' ' + y + ' ' +
    edge(x,y,w,0,r ? -horizontal(r-1,c) : 0) + ' ' +
    edge(-x,y,0,h,c < cols-1 ? vertical(r,c) : 0) + ' ' +
    edge(-x,-y,-w,0,r < rows-1 ? horizontal(r,c) : 0) + ' ' +
    edge(x,-y,0,-h,c ? -vertical(r,c-1) : 0) + ' Z';
}

function build() {
  const [cols,rows] = dimensions[model.count];
  const w = boardWidth/cols, h = boardHeight/rows;
  const source = model.customPhoto || photo(model.scene, 1100);
  board.replaceChildren();
  $('title').textContent = model.customPhoto ? 'Your photo' : scenes[model.scene][0];
  $('reference').disabled = false;
  viewport = svg('g');
  board.append(viewport);
  viewport.append(svg('rect',{x:boardX,y:boardY,width:boardWidth,height:boardHeight,rx:4,fill:'#101913',stroke:'#77927b','stroke-width':2}));
  imageHint = svg('image',{href:source,x:boardX,y:boardY,width:boardWidth,height:boardHeight,preserveAspectRatio:'xMidYMid slice',opacity:shown ? .55 : 0,'pointer-events':'none'});
  viewport.append(imageHint);
  const defs = svg('defs');
  piecesLayer = svg('g');
  pingLayer = svg('g',{'pointer-events':'none'});
  viewport.append(defs,piecesLayer,pingLayer);
  $('tray').replaceChildren();
  trayButtons = [];
  cells = [];
  nodes = [];
  for (let i = 0; i < model.count; i++) {
    const c = i % cols, r = Math.floor(i/cols);
    cells.push({x:boardX+(c+.5)*w,y:boardY+(r+.5)*h,w,h});
    const path = shape(r,c,cols,rows,w,h);
    const clip = svg('clipPath',{id:'cut-'+i});
    clip.append(svg('path',{d:path}));
    defs.append(clip);
    const g = svg('g',{class:'piece',tabindex:0,role:'button','aria-label':'Piece '+(i+1),'data-piece':i});
    g.append(svg('path',{d:path,fill:'#4a6553'}));
    g.append(svg('image',{href:source,x:-(c+.5)*w,y:-(r+.5)*h,width:boardWidth,height:boardHeight,
      preserveAspectRatio:'xMidYMid slice','clip-path':'url(#cut-'+i+')','pointer-events':'none'}));
    g.append(svg('path',{d:path,fill:'transparent'}));
    g.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(i); }
      if (event.key.startsWith('Arrow') && selected === i) {
        event.preventDefault();
        const p = model.pieces[i];
        const delta = {ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[event.key];
        if (delta) drop(i,p.x+delta[0],p.y+delta[1]);
      }
    });
    const art = svg('g',{id:'piece-art-'+i});
    art.append(...g.children);
    defs.append(art);
    g.append(svg('use',{href:'#piece-art-'+i}));
    g.append(svg('path',{d:path,fill:'transparent'}));
    piecesLayer.append(g);
    nodes.push(g);
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label','Select piece '+(i+1));
    const thumb = svg('svg',{viewBox:[-w*.83,-h*.83,w*1.66,h*1.66].join(' '),'aria-hidden':true});
    thumb.append(svg('use',{href:'#piece-art-'+i}));
    button.append(thumb);
    button.addEventListener('click',()=>choose(i));
    trayButtons.push(button);
  }
  const order = model.pieces.map((p,i)=>[p.slot ?? i,i]).sort((a,b)=>a[0]-b[0]);
  $('tray').append(...order.map(([,i])=>trayButtons[i]));
  const empty = document.createElement('p'); empty.id = 'tray-empty'; $('tray').append(empty);
  updateView();
  render();
}
function rememberSeat(seat) {
  mySeat = seat;
  safeStorage('setItem',storageKey()+'-seat',String(seat));
  try { localStorage.setItem(storageKey()+'-seat',String(seat)); } catch { /* Storage is optional. */ }
}
function preferredSeat() {
  let saved = safeStorage('getItem',storageKey()+'-seat');
  if (!saved) {
    try { saved = localStorage.getItem(storageKey()+'-seat'); } catch { /* Storage is optional. */ }
  }
  return saved === '2' ? 2 : 1;
}
function renderScore(done) {
  const scores = [0,0];
  for (const piece of model.pieces) {
    if (piece.done && (piece.scoredBy === 1 || piece.scoredBy === 2)) scores[piece.scoredBy-1]++;
  }
  $('scoreboard').hidden = false;
  scores.forEach((score,i)=>{
    const seat = i+1, own = mySeat === seat;
    const name = 'Player '+seat+(own ? ' (You)' : '');
    const label = $('player-'+seat), points = $('points-'+seat);
    if (label.textContent !== name) label.textContent = name;
    if (points.textContent !== String(score)) points.textContent = String(score);
    $('score-'+seat).classList.toggle('own-score',own);
  });
  const unscored = done-scores[0]-scores[1];
  $('unscored').hidden = unscored === 0;
  if (unscored) $('unscored').textContent = unscored+' placed before scoring was available.';
}
function render() {
  if (!model) return;
  const [cols,rows] = dimensions[model.count];
  let visible = 0;
  model.pieces.forEach((piece,i) => {
    const node = nodes[i], lock = locks.get(i);
    const shift = drag?.moved && drag.origins.get(i);
    const here = shift ? {x:shift.x+drag.x-drag.origin.x,y:shift.y+drag.y-drag.origin.y} : piece;
    node.setAttribute('transform','translate('+here.x+' '+here.y+')');
    node.style.display = piece.tray ? 'none' : '';
    node.classList.toggle('placed',piece.done);
    node.classList.toggle('selected',selected === i);
    node.classList.toggle('locked',!!lock && lock.owner !== id);
    node.classList.toggle('mine',lock?.owner === id);
    node.classList.toggle('theirs',!!lock && lock.owner !== id);
    node.setAttribute('tabindex',piece.done || piece.tray ? -1 : 0);
    if (piece.done && !node.dataset.settled) { piecesLayer.prepend(node); node.dataset.settled = 'yes'; }
    const border = i%cols===0 || i%cols===cols-1 || i<cols || i>=cols*(rows-1);
    const button = trayButtons[i];
    button.hidden = !piece.tray || (edgesOnly && !border);
    button.setAttribute('aria-pressed',selected === i);
    if (!button.hidden) visible++;
  });
  $('tray-empty').hidden = visible > 0;
  $('tray-empty').textContent = edgesOnly ? 'No edge pieces in the tray.' : 'All pieces are on the board.';
  const done = model.pieces.filter(piece => piece.done).length;
  renderScore(done);
  $('progress').textContent = done + ' / ' + model.count + ' pieces';
  $('meter').style.width = (done/model.count*100) + '%';
  if (done === model.count) announce('Puzzle complete! You finished it together.');
}

function members(i) {
  const group = model.pieces[i].group;
  return group === undefined ? [i] : model.pieces.flatMap((piece,j)=>piece.group === group ? [j] : []);
}
function stableModel() {
  return {...model,pieces:model.pieces.map((piece,i)=>locks.get(i)?.before ?? piece)};
}
function snapshot() {
  if (!host || !model) return;
  const payload = {term,version,model:stableModel(),savedAt:Date.now()};
  checkpoint = {...payload,sender:id};
  cache(checkpoint);
  send('saved',payload,true);
}
function cache(value) {
  try { localStorage.setItem(storageKey(),JSON.stringify(value)); } catch { /* Browser storage can be full or disabled. */ }
}
function state(to) {
  return send('state',{to,term,version,model,seat:3-mySeat,locks:[...locks].map(([i,lock])=>[i,{owner:lock.owner}])});
}
function patch(indices) {
  version++;
  render();
  return send('patch',{term,version,changes:indices.map(i=>[i,model.pieces[i],locks.get(i)?.owner ?? null])});
}
function moveGroup(indices,dx,dy) {
  for (const i of indices) {
    const p = model.pieces[i];
    model.pieces[i] = {...p,x:p.x+dx,y:p.y+dy,tray:false};
  }
}
function settle(indices,seat) {
  for (const i of indices) model.pieces[i] = {...model.pieces[i],x:cells[i].x,y:cells[i].y,done:true,tray:false,scoredBy:seat};
}
function attach(indices,seat) {
  const [cols] = dimensions[model.count];
  const moving = new Set(indices);
  let nearest;
  for (const i of indices) {
    const p = model.pieces[i], target = cells[i];
    const neighbors = [i-cols,i+cols];
    if (i%cols) neighbors.push(i-1);
    if (i%cols < cols-1) neighbors.push(i+1);
    for (const j of neighbors) {
      const q = model.pieces[j], other = cells[j];
      if (!q || q.tray || moving.has(j) || locks.has(j)) continue;
      const dx = q.x + target.x-other.x-p.x, dy = q.y + target.y-other.y-p.y;
      const distance = Math.hypot(dx,dy);
      if (distance < Math.min(target.w,target.h)*.27 && (!nearest || distance < nearest.distance)) {
        nearest = {j,dx,dy,distance};
      }
    }
  }
  if (!nearest) return indices;
  const other = model.pieces[nearest.j];
  if (other.done) { settle(indices,seat); return indices; }
  const merged = [...indices,...members(nearest.j)];
  moveGroup(indices,nearest.dx,nearest.dy);
  const group = Math.min(...merged);
  for (const j of merged) model.pieces[j] = {...model.pieces[j],group};
  return merged;
}
function applyMove(player, action, data) {
  const i = data.piece, p = model.pieces[i];
  if (!Number.isInteger(i) || !p || p.done) return;
  const indices = members(i), lock = locks.get(i);
  if (lock && lock.owner !== player) return;
  if (action === 'grab') {
    if (!lock && !p.tray) {
      for (const j of indices) locks.set(j,{owner:player,before:model.pieces[j],seen:Date.now()});
      patch(indices);
    }
    return;
  }
  if (action === 'cancel') {
    if (lock) {
      for (const j of indices) { model.pieces[j] = locks.get(j).before; locks.delete(j); }
      patch(indices);
    }
    return;
  }
  if (!Number.isFinite(data.x) || !Number.isFinite(data.y) || (action === 'move' && !lock)) return;
  const target = cells[i];
  const offsetsX = indices.map(j=>model.pieces[j].x-p.x);
  const offsetsY = indices.map(j=>model.pieces[j].y-p.y);
  const x = Math.max(18-Math.min(...offsetsX),Math.min(582-Math.max(...offsetsX),data.x));
  const y = Math.max(18-Math.min(...offsetsY),Math.min(448-Math.max(...offsetsY),data.y));
  const snap = action === 'drop' && Math.hypot(x-target.x,y-target.y) < Math.min(target.w,target.h)*.42;
  moveGroup(indices,x-p.x,y-p.y);
  if (action === 'drop') {
    for (const j of indices) locks.delete(j);
    const seat = player === id ? mySeat : 3-mySeat;
    if (snap) settle(indices,seat);
    const changed = snap ? indices : attach(indices,seat);
    patch(changed);
    snapshot();
  } else {
    for (const j of indices) locks.get(j).seen = Date.now();
    patch(indices);
  }
}
function command(action, data) {
  if (host) applyMove(id,action,data);
  else if (online && leader && !blocked) send(action,{...data,to:leader});
}
function choose(piece) {
  if (!model?.pieces[piece] || model.pieces[piece].done || (locks.has(piece) && locks.get(piece).owner !== id)) return;
  selected = selected === piece ? null : piece;
  if (selected !== null) announce('Tap the board to place the selected piece.');
  else announce(hintText);
  render();
}
function coords(event) {
  return new DOMPoint(event.clientX,event.clientY).matrixTransform(board.getScreenCTM().inverse());
}
function world(point) { return {x:(point.x-offsetX)/zoom,y:(point.y-offsetY)/zoom}; }
function updateView() {
  offsetX = Math.min(0,Math.max(600*(1-zoom),offsetX));
  offsetY = Math.min(0,Math.max(466*(1-zoom),offsetY));
  viewport?.setAttribute('transform','translate('+offsetX+' '+offsetY+') scale('+zoom+')');
  $('zoom-reset').textContent = Math.round(zoom*100)+'%';
  $('zoom-out').disabled = zoom <= 1;
  $('zoom-in').disabled = zoom >= 4;
}
function zoomTo(value,anchor={x:300,y:233},next=anchor) {
  const point = world(anchor);
  zoom = Math.max(1,Math.min(4,value));
  offsetX = next.x-point.x*zoom;
  offsetY = next.y-point.y*zoom;
  updateView();
}
$('zoom-out').onclick = ()=>zoomTo(zoom/1.35);
$('zoom-in').onclick = ()=>zoomTo(zoom*1.35);
$('zoom-reset').onclick = ()=>zoomTo(1);
$('pan').onclick = () => { panMode = !panMode; $('pan').setAttribute('aria-pressed',panMode); };
$('edges').onclick = () => { edgesOnly = !edgesOnly; $('edges').setAttribute('aria-pressed',edgesOnly); render(); };
$('ping').onclick = () => {
  pingMode = !pingMode;
  $('ping').setAttribute('aria-pressed',pingMode);
  announce(pingMode ? 'Tap the board to show your friend a spot.' : hintText);
};
function showPing(x,y,mine) {
  if (!pingLayer || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const ring = svg('circle',{cx:x,cy:y,r:13,fill:'none',stroke:mine?'#dded99':'#79dfff','stroke-width':4,class:'ping-ring'});
  pingLayer.append(ring);
  setTimeout(()=>ring.remove(),1900);
}
function pair() {
  const [a,b] = [...pointers.values()];
  return {mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))};
}
board.addEventListener('pointerdown', event => {
  if (!model || event.button !== 0 || pointers.size >= 2) return;
  const point = coords(event);
  pointers.set(event.pointerId,point);
  board.setPointerCapture(event.pointerId);
  if (pointers.size === 2) {
    if (drag?.moved) command('cancel',{piece:drag.piece});
    drag = null;
    render();
    gesture = pair();
    return;
  }
  const target = world(point);
  if (pingMode) {
    pingMode = false; $('ping').setAttribute('aria-pressed',false);
    if (Date.now()-lastPing > 600) {
      lastPing = Date.now(); showPing(target.x,target.y,true); send('ping',target);
    }
    return;
  }
  const node = event.target.closest('[data-piece]');
  if (selected !== null && model.pieces[selected]?.tray && !panMode) {
    const chosen = selected; selected = null;
    command('drop',{piece:chosen,x:target.x,y:target.y}); render(); return;
  }
  const piece = node ? Number(node.dataset.piece) : selected;
  const p = model.pieces[piece];
  if (panMode || (!p && zoom > 1)) { gesture = {pan:point}; return; }
  if (!p || p.done || (locks.has(piece) && locks.get(piece).owner !== id)) return;
  if (!node) {
    const chosen = selected; selected = null;
    command('drop',{piece:chosen,x:target.x,y:target.y}); render(); return;
  }
  const group = members(piece);
  drag = {piece,pointer:event.pointerId,start:target,origin:{...p},x:p.x,y:p.y,
    origins:new Map(group.map(i=>[i,{...model.pieces[i]}])),moved:false};
  for (const i of group) piecesLayer.append(nodes[i]);
});
board.addEventListener('pointermove',event => {
  if (!pointers.has(event.pointerId)) return;
  const point = coords(event);
  pointers.set(event.pointerId,point);
  if (pointers.size === 2) {
    const next = pair();
    zoomTo(zoom*next.distance/gesture.distance,gesture.mid,next.mid);
    gesture = next;
    return;
  }
  if (gesture?.pan) {
    offsetX += point.x-gesture.pan.x; offsetY += point.y-gesture.pan.y;
    gesture.pan = point; updateView(); return;
  }
  if (drag?.pointer !== event.pointerId) return;
  const target = world(point), dx = target.x-drag.start.x, dy = target.y-drag.start.y;
  if (!drag.moved && Math.hypot(dx,dy)*zoom < 7) return;
  if (!drag.moved) { drag.moved = true; command('grab',{piece:drag.piece}); }
  drag.x = drag.origin.x+dx; drag.y = drag.origin.y+dy;
  render();
  if (Date.now()-movingAt > 85) {
    movingAt = Date.now(); command('move',{piece:drag.piece,x:drag.x,y:drag.y});
  }
});
function endDrag(event) {
  if (!pointers.delete(event.pointerId)) return;
  if (gesture) { gesture = pointers.size ? {pan:[...pointers.values()][0]} : null; return; }
  if (drag?.pointer !== event.pointerId) return;
  const finished = drag; drag = null;
  if (finished.moved) {
    selected = null;
    if (event.type === 'pointerup') command('drop',{piece:finished.piece,x:finished.x,y:finished.y});
    else command('cancel',{piece:finished.piece});
  } else if (event.type === 'pointerup') choose(finished.piece);
  render();
}
board.addEventListener('pointerup',endDrag);
board.addEventListener('pointercancel',endDrag);
board.addEventListener('lostpointercapture',endDrag);

function send(type,data = {},retained = false) {
  if (!online) return;
  // Serialize now so later drags cannot change a queued snapshot.
  const body = encoder.encode(JSON.stringify({sender:id,type,...data}));
  outbound = outbound.catch(()=>{}).then(async () => {
    if (!online) return;
    const iv = bytes(12);
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,body));
    const payload = new Uint8Array(iv.length+encrypted.length);
    payload.set(iv); payload.set(encrypted,iv.length);
    if (online) sendWire(payload,retained);
  }).catch(()=>{});
}
function validModel(value) {
  return value && Object.hasOwn(dimensions,value.count) && Array.isArray(value.pieces) &&
    value.pieces.length === value.count && value.pieces.every(p=>p && Number.isFinite(p.x) && Number.isFinite(p.y)) &&
    (value.scene === -1 ? /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value.customPhoto) :
      Number.isInteger(value.scene) && value.scene >= 0 && value.scene < scenes.length);
}
function loadModel(next) {
  const rebuild = !model || next.count !== model.count || next.scene !== model.scene || next.customPhoto !== model.customPhoto;
  model = next;
  if (rebuild) build(); else render();
}
function newer(a,b) {
  return !b || a.term > b.term || (a.term === b.term && (a.sender > b.sender ||
    a.sender === b.sender && a.version > b.version));
}
function takeLead() {
  if (!online || !checkpoint || blocked) return;
  term = Math.max(term,checkpoint.term)+1;
  leader = id; host = true; guestId = null; version = checkpoint.version;
  rememberSeat(mySeat ?? preferredSeat());
  locks.clear(); drag = null;
  loadModel(checkpoint.model);
  status('Waiting for friend');
  announce(hintText);
  snapshot();
  send('beacon',{term});
}
function scheduleElection() {
  electionAt = Date.now()+4800+Math.random()*1900;
}
function acceptLeader(message) {
  if (!Number.isSafeInteger(message.term) || message.term < term) return false;
  if (message.term === term && leader && leader !== message.sender && message.sender < leader) return false;
  if (leader !== message.sender || term !== message.term) {
    term = message.term; leader = message.sender; host = false;
    receivedVersion = -1; locks.clear(); drag = null; guestId = null; blocked = false;
  }
  peerSeen = Date.now();
  return true;
}
function receive(payload) {
  if (payload.length < 29 || payload.length > 320000) return;
  inbound = inbound.catch(()=>{}).then(async () => {
    const body = await crypto.subtle.decrypt({name:'AES-GCM',iv:payload.slice(0,12)},key,payload.slice(12));
    const message = JSON.parse(decoder.decode(body));
    if (message.sender === id || typeof message.sender !== 'string' || (message.to && message.to !== id)) return;
    if (message.type === 'saved') {
      if (!Number.isSafeInteger(message.term) || !Number.isSafeInteger(message.version) ||
          !validModel(message.model) || Date.now()-message.savedAt > roomLife*1000) return;
      if (newer(message,checkpoint)) {
        checkpoint = message; cache(checkpoint);
        if (!host && !model && !blocked && !leader) status('Resuming room…');
      }
      return;
    }
    if (message.type === 'beacon') {
      if (!acceptLeader(message)) return;
      if (!blocked && receivedVersion < 0) send('hello',{resync:true,to:leader});
      return;
    }
    if (message.type === 'ping') {
      if ((host && message.sender === guestId) || (!host && !blocked && message.sender === leader)) {
        showPing(message.x,message.y,false);
        announce('Your friend pinged the board.');
      }
      return;
    }
    if (host) {
      if (message.type === 'hello') {
        if (guestId && guestId !== message.sender && Date.now()-peerSeen < 12000) {
          send('full',{to:message.sender,term}); return;
        }
        const joining = guestId !== message.sender || message.resync;
        guestId = message.sender;
        peerSeen = Date.now();
        status('● 2 players connected');
        if (joining) state(guestId);
        else send('pong',{to:guestId,term,version});
      } else if (message.sender === guestId && ['grab','move','drop','cancel'].includes(message.type)) {
        peerSeen = Date.now(); applyMove(guestId,message.type,message);
      }
      return;
    }
    if (message.type === 'full' && acceptLeader(message)) {
      blocked = true; drag = null; selected = null; model = null;
      board.replaceChildren(); $('tray').replaceChildren(); $('title').textContent = 'Room is full';
      $('scoreboard').hidden = true;
      $('progress').textContent = ''; $('meter').style.width = '0'; $('reference').disabled = true;
      status('Room is full'); announce('Waiting for a player slot to open.');
      return;
    }
    if (message.type === 'state' && validModel(message.model) && acceptLeader(message)) {
      if (message.version < receivedVersion) return;
      const joining = blocked || receivedVersion < 0;
      blocked = false;
      receivedVersion = message.version;
      if (message.seat === 1 || message.seat === 2) rememberSeat(message.seat);
      locks = new Map(message.locks);
      status('● 2 players connected');
      if (joining) announce(hintText);
      loadModel(message.model);
      return;
    }
    if (message.sender !== leader || message.term !== term || blocked) return;
    peerSeen = Date.now();
    if (message.type === 'pong') {
      status('● 2 players connected');
      if (receivedVersion !== message.version) send('hello',{resync:true,to:leader});
      return;
    }
    if (message.type !== 'patch' || !model || message.version <= receivedVersion) return;
    if (message.version !== receivedVersion+1) { send('hello',{resync:true,to:leader}); return; }
    receivedVersion = message.version;
    for (const [piece,value,owner] of message.changes) {
      model.pieces[piece] = value;
      if (owner) locks.set(piece,{owner}); else locks.delete(piece);
    }
    render();
  }).catch(()=>{});
}
function connected() {
  online = true;
  if (host) {
    status(guestId ? '● 2 players connected' : 'Waiting for friend');
    snapshot();
    send('beacon',{term});
  } else {
    status('Finding room…'); peerSeen = 0; scheduleElection(); send('hello',{resync:true});
  }
}
function transport() {
  if (local) {
    const channel = new BroadcastChannel(topic);
    channel.onmessage = event => receive(event.data);
    sendWire = payload => channel.postMessage(payload);
    connected();
    return;
  }
  if (!window.mqtt) { status('Multiplayer unavailable'); announce('The multiplayer library could not load. Reload to retry.'); return; }
  const client = window.mqtt.connect('wss://broker.emqx.io:8084/mqtt',{
    protocolVersion:5,clientId:'pt-'+id,reconnectPeriod:3000,connectTimeout:9000,keepalive:15,
    clean:true,resubscribe:false,queueQoSZero:false
  });
  sendWire = (payload,retained) => {
    if (retained) client.publish(topic+'/saved',payload,{qos:1,retain:true,properties:{messageExpiryInterval:roomLife}},error => {
      if (error) announce('The online save failed. Your browser still has a local copy.');
    });
    else client.publish(topic,payload,{qos:0,retain:false});
  };
  client.on('connect',()=>client.subscribe([topic,topic+'/saved'],{qos:1},(error,granted)=>{
    if (!error && granted?.every(g=>g.qos < 128)) connected();
    else status('Multiplayer subscription failed');
  }));
  client.on('message',(_topic,payload)=>receive(payload));
  client.on('close',()=>{
    online = false;
    if (host) {
      // Rejoin through election so a friend who took over keeps their newer board.
      host = false; leader = null; peerSeen = 0; receivedVersion = -1;
      locks.clear(); drag = null;
    }
    status('Reconnecting…');
  });
  client.on('error',()=>status('Multiplayer connection failed'));
}
function tick() {
  if (!online) return;
  const now = Date.now();
  if (host) {
    if (guestId && now-peerSeen > 12000) { guestId = null; status('Waiting for friend'); }
    for (const [piece,lock] of locks) {
      if (now-lock.seen > 12000 && !drag?.origins.has(piece)) applyMove(lock.owner,'cancel',{piece});
    }
    send('beacon',{term});
    return;
  }
  if (leader && now-peerSeen > 12000) {
    leader = null; blocked = false; receivedVersion = -1;
    locks.clear(); drag = null; scheduleElection();
    status('Reconnecting room…');
  }
  if (!leader && checkpoint && now >= electionAt) { takeLead(); return; }
  if (!leader && !checkpoint && now >= electionAt) {
    status('Room unavailable');
    announce('Check the invite link. Online saves are kept for up to seven days.');
  }
  send('hello',{resync:!model || receivedVersion < 0,to:leader});
}
async function start(token, setup) {
  room = token;
  const raw = unhex(token);
  key = await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
  topic = 'piece-together/v2/'+hex(new Uint8Array(await crypto.subtle.digest('SHA-256',raw))).slice(0,40);
  $('home').hidden = true; $('game').hidden = false; $('reference').disabled = true;
  status('Connecting…');
  if (setup) {
    host = true; leader = id; term = 1;
    rememberSeat(1);
    loadModel(setup); snapshot();
  } else {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey()));
      if (stored && validModel(stored.model) && Date.now()-stored.savedAt < roomLife*1000) {
        checkpoint = stored;
      }
    } catch { /* An unavailable cache does not prevent joining. */ }
    const legacy = safeStorage('getItem','piece-host-'+room);
    if (!checkpoint && legacy) {
      try {
        const previous = JSON.parse(legacy);
        if (validModel(previous)) {
          previous.pieces = previous.pieces.map((p,i)=>({...p,tray:!p.done && p.y>448,slot:i}));
          host = true; leader = id; term = 1;
          rememberSeat(preferredSeat());
          loadModel(previous); snapshot();
        }
      } catch { /* A corrupt legacy save can be ignored. */ }
    }
  }
  transport();
  setInterval(tick,2200);
}
const crop = $('crop'), preview = $('crop-preview');
let cropImage, cropRequest = 0;
function drawCrop() {
  if (!cropImage) return;
  const {width,height} = preview;
  const scale = Math.max(width/cropImage.naturalWidth,height/cropImage.naturalHeight)*Number($('crop-zoom').value)/100;
  const w = cropImage.naturalWidth*scale, h = cropImage.naturalHeight*scale;
  preview.getContext('2d').fillStyle = '#141c17';
  preview.getContext('2d').fillRect(0,0,width,height);
  preview.getContext('2d').drawImage(cropImage,(width-w)*Number($('crop-x').value)/100,
    (height-h)*Number($('crop-y').value)/100,w,h);
}
for (const name of ['crop-x','crop-y','crop-zoom']) $(name).addEventListener('input',drawCrop);
$('custom-photo').addEventListener('change',async event=>{
  const file = event.target.files[0], request = ++cropRequest;
  if (!file) return;
  if (file.size > 30*1024*1024) { $('photo-status').textContent = 'Choose a photo under 30 MB.'; event.target.value = ''; return; }
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url; await image.decode();
    if (request !== cropRequest) return;
    cropImage = image;
    $('crop-x').value = '50'; $('crop-y').value = '50'; $('crop-zoom').value = '100';
    crop.returnValue = ''; drawCrop(); crop.showModal();
  } catch { $('photo-status').textContent = 'Could not open this photo. Try a JPEG, PNG, or WebP.'; }
  finally { URL.revokeObjectURL(url); event.target.value = ''; }
});
crop.addEventListener('close',()=>{
  if (crop.returnValue !== 'apply' || !cropImage) return;
  let quality = .87;
  customPhoto = preview.toDataURL('image/jpeg',quality);
  while (customPhoto.length > 185000 && quality > .35) {
    quality -= .1; customPhoto = preview.toDataURL('image/jpeg',quality);
  }
  if (customPhoto.length > 185000) {
    customPhoto = null;
    $('photo-status').textContent = 'Try a smaller or less detailed photo.';
    updateGallerySelection();
    return;
  }
  $('photo-status').textContent = 'Your cropped photo is selected.';
  updateGallerySelection();
});
$('setup').addEventListener('submit',async event=>{
  event.preventDefault();
  if (!crypto.subtle) { alert('Open this game over HTTPS or localhost.'); return; }
  const token = hex(bytes(32));
  const scene = customPhoto ? -1 : selectedScene;
  const setup = makeModel(scene,Number($('size').value));
  history.replaceState(null,'','#'+token);
  await start(token,setup);
});
$('reference').addEventListener('click',() => {
  shown = !shown;
  imageHint.setAttribute('opacity',shown ? '.55' : '0');
  $('reference').textContent = shown ? 'Hide picture' : 'Show picture';
  $('reference').setAttribute('aria-pressed',shown);
});
$('invite').addEventListener('click',async () => {
  const url = location.href;
  if (navigator.share && !local) {
    try { await navigator.share({title:'Piece Together',text:'Join my jigsaw puzzle',url}); return; }
    catch (error) { if (error.name === 'AbortError') return; }
  }
  $('link').value = url; $('copy').textContent = 'Copy link'; $('share').showModal();
});
$('copy').addEventListener('click',async () => {
  try { await navigator.clipboard.writeText($('link').value); $('copy').textContent = 'Copied!'; }
  catch { $('link').select(); }
});
if (/^#[a-f0-9]{64}$/.test(location.hash)) {
  if (crypto.subtle) start(location.hash.slice(1)).catch(() => status('Could not open room'));
  else status('Open over HTTPS or localhost');
}
})();
