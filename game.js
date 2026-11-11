(() => {
'use strict';
const scenes = [
  ['Golden Morning', '1470252649378-9c29740c9fa8'],
  ['Mountain Lake', '1470770841072-f978cf4d019e'],
  ['Forest Light', '1441974231531-c6227db76b6e']
];
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
const dimensions = {12:[4,3],20:[5,4],30:[6,5]};
const boardX = 38, boardY = 31, boardWidth = 524, boardHeight = 388;
let room, key, topic, host = false, hostId, guestId, peerSeen = 0, online = false;
let sendWire, inbound = Promise.resolve(), outbound = Promise.resolve();
let model, cells = [], nodes = [], piecesLayer, imageHint, selected = null, drag = null, version = 0, receivedVersion = -1;
let locks = new Map(), movingAt = 0, shown = false, pendingDrop = null;
const safeStorage = (method, ...args) => {
  try { return sessionStorage[method](...args); } catch { return null; }
};
function announce(message) { $('hint').textContent = message; }
function status(message) { $('status').textContent = message; $('status').hidden = false; }

for (const [index, [name]] of scenes.entries()) {
  const label = document.createElement('label');
  label.className = 'scene';
  label.innerHTML = '<input type="radio" name="scene" value="' + index + '"' + (index ? '' : ' checked') + '><img alt=""><span></span>';
  label.querySelector('img').src = photo(index, 280);
  label.querySelector('span').textContent = name;
  $('gallery').append(label);
}

function makeModel(scene, count) {
  const order = Array.from({length: count}, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const trayCols = count === 12 ? 4 : count === 20 ? 5 : 6;
  const trayRows = Math.ceil(count / trayCols);
  return {scene, count, pieces: order.map(slot => ({
    x: 600 * (slot % trayCols + .5) / trayCols,
    y: 490 + 312 * (Math.floor(slot / trayCols) + .5) / trayRows, done: false
  }))};
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
  const source = photo(model.scene, 1100);
  board.replaceChildren();
  $('title').textContent = scenes[model.scene][0];
  $('reference').disabled = false;
  board.append(svg('rect',{x:boardX,y:boardY,width:boardWidth,height:boardHeight,rx:4,fill:'#101913',stroke:'#77927b','stroke-width':2}));
  imageHint = svg('image',{href:source,x:boardX,y:boardY,width:boardWidth,height:boardHeight,preserveAspectRatio:'xMidYMid slice',opacity:shown ? .55 : 0,'pointer-events':'none'});
  board.append(imageHint);
  const tray = svg('text',{x:24,y:469,fill:'#bec9bb','font-size':15,'font-weight':700,'letter-spacing':2});
  tray.textContent = 'PIECE TRAY';
  board.append(tray);
  const defs = svg('defs');
  piecesLayer = svg('g');
  board.append(defs,piecesLayer);
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
    piecesLayer.append(g);
    nodes.push(g);
  }
  render();
}
function render() {
  if (!model) return;
  model.pieces.forEach((piece,i) => {
    const node = nodes[i];
    if (!node) return;
    const here = drag?.piece === i && drag.moved ? drag : pendingDrop?.piece === i ? pendingDrop : piece;
    node.setAttribute('transform','translate('+here.x+' '+here.y+')');
    node.classList.toggle('placed',piece.done);
    node.classList.toggle('selected',selected === i);
    node.classList.toggle('locked',locks.has(i) && locks.get(i).owner !== id);
    node.setAttribute('tabindex',piece.done ? -1 : 0);
    if (piece.done && !node.dataset.settled) { piecesLayer.prepend(node); node.dataset.settled = 'yes'; }
  });
  const done = model.pieces.filter(piece => piece.done).length;
  $('progress').textContent = done + ' / ' + model.count + ' pieces';
  $('meter').style.width = (done/model.count*100) + '%';
  if (done === model.count) announce('Puzzle complete! You finished it together.');
}
function save() {
  if (!host) return;
  const pieces = model.pieces.map((p,i) => locks.get(i)?.before ?? p);
  safeStorage('setItem','piece-host-'+room,JSON.stringify({...model,pieces}));
}
function state(to) {
  return send('state',{to,version,model,locks:[...locks].map(([i,lock]) => [i,{owner:lock.owner}])});
}
function patch(piece) {
  version++;
  const lock = locks.get(piece);
  render();
  return send('patch',{version,piece,value:model.pieces[piece],owner:lock?.owner ?? null});
}
function applyMove(player, action, data) {
  const i = data.piece, p = model.pieces[i];
  if (!Number.isInteger(i) || !p || p.done) return;
  const lock = locks.get(i);
  if (lock && lock.owner !== player) return;
  if (action === 'grab') {
    if (!lock) { locks.set(i,{owner:player,before:{...p},seen:Date.now()}); patch(i); }
    return;
  }
  if (action === 'cancel') {
    if (lock) { model.pieces[i] = lock.before; locks.delete(i); patch(i); }
    return;
  }
  if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
  if (action === 'move' && !lock) return;
  const target = cells[i], x = Math.max(8,Math.min(592,data.x)), y = Math.max(8,Math.min(842,data.y));
  const snap = action === 'drop' && Math.hypot(x-target.x,y-target.y) < Math.min(target.w,target.h)*.43;
  model.pieces[i] = snap ? {x:target.x,y:target.y,done:true} : {x,y,done:false};
  if (action === 'drop') { locks.delete(i); save(); }
  else lock.seen = Date.now();
  patch(i);
}
function command(action, data) {
  if (host) applyMove(id,action,data);
  else if (online && hostId) send(action,data);
}
function choose(piece) {
  if (!model?.pieces[piece] || model.pieces[piece].done || (locks.has(piece) && locks.get(piece).owner !== id)) return;
  selected = selected === piece ? null : piece;
  if (selected !== null) { piecesLayer.append(nodes[piece]); announce('Tap its spot on the board, or drag the piece.'); }
  else announce('Drag a piece, or tap it and then tap its place on the board.');
  render();
}
function drop(piece,x,y) {
  if (!host && (!online || !hostId)) { announce('Waiting for the host to reconnect.'); return; }
  command('drop',{piece,x,y});
}
function coords(event) {
  return new DOMPoint(event.clientX,event.clientY).matrixTransform(board.getScreenCTM().inverse());
}
board.addEventListener('pointerdown', event => {
  if (!model || drag || event.button !== 0 || (!host && (!online || !hostId))) return;
  const point = coords(event);
  const node = event.target.closest('[data-piece]');
  if (!node) {
    if (selected !== null && point.x >= boardX && point.x <= boardX+boardWidth && point.y >= boardY && point.y <= boardY+boardHeight) {
      const piece = selected; selected = null; drop(piece,point.x,point.y); render();
    }
    return;
  }
  const piece = Number(node.dataset.piece), p = model.pieces[piece];
  if (p.done || (locks.has(piece) && locks.get(piece).owner !== id)) return;
  drag = {piece,pointer:event.pointerId,startX:point.x,startY:point.y,dx:p.x-point.x,dy:p.y-point.y,x:p.x,y:p.y,moved:false};
  piecesLayer.append(node);
  board.setPointerCapture(event.pointerId);
});
board.addEventListener('pointermove', event => {
  if (drag?.pointer !== event.pointerId) return;
  const p = coords(event);
  if (!drag.moved && Math.hypot(p.x-drag.startX,p.y-drag.startY)<7) return;
  if (!drag.moved) { drag.moved = true; command('grab',{piece:drag.piece}); }
  drag.x = p.x+drag.dx; drag.y = p.y+drag.dy;
  nodes[drag.piece].setAttribute('transform','translate('+drag.x+' '+drag.y+')');
  if (Date.now()-movingAt > 85) {
    movingAt = Date.now();
    command('move',{piece:drag.piece,x:drag.x,y:drag.y});
  }
});
function endDrag(event) {
  if (drag?.pointer !== event.pointerId) return;
  const finished = drag; drag = null;
  const {piece,moved} = finished;
  if (moved) {
    selected = null;
    if (event.type === 'pointerup') {
      const p = coords(event);
      if (!host) {
        pendingDrop = {piece,x:p.x+finished.dx,y:p.y+finished.dy};
        const pending = pendingDrop;
        setTimeout(() => { if (pendingDrop === pending) { pendingDrop = null; render(); } },1200);
      }
      drop(piece,p.x+finished.dx,p.y+finished.dy);
    } else command('cancel',{piece});
  } else if (event.type === 'pointerup') choose(piece);
  render();
}
board.addEventListener('pointerup',endDrag);
board.addEventListener('pointercancel',endDrag);
board.addEventListener('lostpointercapture',endDrag);

function send(type,data = {}) {
  if (!online) return;
  outbound = outbound.catch(() => {}).then(async () => {
    if (!online) return;
    const iv = bytes(12);
    const body = encoder.encode(JSON.stringify({sender:id,type,...data}));
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,body));
    const payload = new Uint8Array(iv.length+encrypted.length);
    payload.set(iv); payload.set(encrypted,iv.length);
    if (online) sendWire(payload);
  }).catch(() => {});
}
function receive(payload) {
  if (payload.length < 29 || payload.length > 12000) return;
  inbound = inbound.catch(() => {}).then(async () => {
    const body = await crypto.subtle.decrypt({name:'AES-GCM',iv:payload.slice(0,12)},key,payload.slice(12));
    const message = JSON.parse(decoder.decode(body));
    if (message.sender === id || (message.to && message.to !== id)) return;
    if (host) {
      if (message.type === 'hello') {
        if (guestId && guestId !== message.sender && Date.now()-peerSeen < 14000) {
          send('full',{to:message.sender}); return;
        }
        const joining = guestId !== message.sender || message.resync;
        guestId = message.sender;
        peerSeen = Date.now();
        status('● 2 players connected');
        if (joining) state(guestId);
        else send('pong',{to:guestId});
      } else if (message.sender === guestId && ['grab','move','drop','cancel'].includes(message.type)) {
        peerSeen = Date.now(); applyMove(guestId,message.type,message);
      }
      return;
    }
    if (message.type === 'full' && !hostId) { status('Room is full'); announce('Both player slots are occupied.'); return; }
    if (message.type === 'state') {
      if (hostId && hostId !== message.sender && Date.now()-peerSeen < 14000) return;
      const newHost = hostId !== message.sender;
      if (!newHost && message.version < receivedVersion) return;
      peerSeen = Date.now(); hostId = message.sender;
      receivedVersion = message.version;
      const rebuild = !model || model.count !== message.model.count || model.scene !== message.model.scene;
      model = message.model;
      locks = new Map(message.locks);
      status('● 2 players connected');
      announce('Drag a piece, or tap it and then tap its place on the board.');
      if (rebuild) build(); else render();
    } else if (message.sender === hostId) {
      peerSeen = Date.now();
      if (message.type === 'pong') status('● 2 players connected');
      if (message.type !== 'patch' || message.version <= receivedVersion) return;
      if (message.version !== receivedVersion+1) { send('hello',{resync:true}); return; }
      receivedVersion = message.version;
      model.pieces[message.piece] = message.value;
      if (pendingDrop?.piece === message.piece && !message.owner) pendingDrop = null;
      if (message.owner) locks.set(message.piece,{owner:message.owner}); else locks.delete(message.piece);
      render();
    }
  }).catch(() => {});
}
function connected() {
  online = true;
  if (host) { status('● Waiting for friend'); if (guestId) state(guestId); }
  else { status('Finding host…'); send('hello',{resync:true}); }
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
    clientId:'pt-'+id, reconnectPeriod:3000, connectTimeout:9000, keepalive:15, clean:true, resubscribe:false
  });
  sendWire = payload => client.publish(topic,payload,{qos:0,retain:false});
  client.on('connect',() => client.subscribe(topic,{qos:0},error => { if (!error) connected(); }));
  client.on('message',(_topic,payload) => receive(payload));
  client.on('close',() => { online = false; status('Reconnecting…'); });
  client.on('error',() => { status('Multiplayer connection failed'); });
}
async function start(token, setup) {
  room = token;
  const raw = unhex(token);
  key = await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
  topic = 'piece-together/v1/'+hex(new Uint8Array(await crypto.subtle.digest('SHA-256',raw))).slice(0,40);
  $('home').hidden = true; $('game').hidden = false; $('reference').disabled = true;
  status('Connecting…');
  const stored = safeStorage('getItem','piece-host-'+room);
  host = !!setup || !!stored;
  if (host) {
    model = setup || JSON.parse(stored);
    save();
    build();
  }
  transport();
  setInterval(() => {
    const expired = Date.now()-peerSeen > 14000;
    if (host) {
      if (guestId && expired) { guestId = null; if (online) status('● Waiting for friend'); }
      for (const [piece,lock] of locks) {
        if (Date.now()-lock.seen > 12000 && drag?.piece !== piece) applyMove(lock.owner,'cancel',{piece});
      }
    } else if (online) {
      if (hostId && expired) {
        hostId = null; receivedVersion = -1;
        status('Waiting for host…'); announce('The host must reopen the original room tab.');
      }
      send('hello',{resync:!hostId});
    }
  },2600);
}
$('setup').addEventListener('submit',async event => {
  event.preventDefault();
  if (!crypto.subtle) { alert('Open this game over HTTPS or localhost.'); return; }
  const token = hex(bytes(32));
  history.replaceState(null,'','#'+token);
  await start(token,makeModel(Number(new FormData(event.currentTarget).get('scene')),Number($('size').value)));
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
