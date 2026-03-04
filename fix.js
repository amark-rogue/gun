/* fix.js - mobile thumb inspector (prototype) */
(() => {
  'use strict';

  const Fix = {
    _listeners: new Map(),
    on(evt, fn) {
      if (!this._listeners.has(evt)) this._listeners.set(evt, new Set());
      this._listeners.get(evt).add(fn);
      return () => this._listeners.get(evt)?.delete(fn);
    },
    emit(evt, data) {
      this._listeners.get(evt)?.forEach((fn) => {
        try { fn(data); } catch (e) { console.error(e); }
      });
    }
  };

  if (window.FixInspector) return;
  window.FixInspector = Fix;

  const state = {
    visible: false,
    dragging: false,
    pointerId: null,
    x: window.innerWidth * 0.7,
    y: window.innerHeight * 0.4,
    vx: 0,
    vy: 0,
    lastMoveTime: 0,
    edgeLockX: false,
    edgeLockY: false,
    zIndexOffset: 0,
    elementsStack: [],
    selectedEl: null,
    dimmedEls: new Set(),
    gesture: {
      tapCount: 0,
      lastTapTime: 0,
      startX: 0,
      startY: 0,
      axisLock: null,
      tapTimer: null,
      holdTimer: null,
      startedOnBubble: false,
      startedOnHalo: false,
      sliding: false,
      grabOffsetX: 0,
      grabOffsetY: 0,
      lastX: 0,
      lastY: 0
    }
  };

  const css = `
#fix-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483647;
  --fix-size: 0.5in;
  --fix-halo: calc(var(--fix-size) * 5);
  --fix-blur: 2px;
}
#fix-bubble {
  position: fixed;
  width: var(--fix-size);
  height: var(--fix-size);
  left: 0;
  top: 0;
  pointer-events: auto;
  z-index: 2147483647;
  filter: blur(var(--fix-blur)) contrast(1.1);
  background: rgba(255,255,255,0.02);
  border-radius: 0 calc(var(--fix-size) * 0.45) calc(var(--fix-size) * 0.45) calc(var(--fix-size) * 0.45);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.3);
  backdrop-filter: invert(1);
  -webkit-backdrop-filter: invert(1);
}
#fix-bubble::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: var(--fix-halo);
  height: var(--fix-halo);
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: black;
  opacity: 0.01;
  transition: opacity 250ms ease;
  pointer-events: none;
}
#fix-bubble.active::after { opacity: 0.1; }
#fix-outline {
  position: fixed;
  pointer-events: none;
  z-index: 2147483646;
  border-radius: 6px;
  padding: 2px;
}
#fix-outline::before {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 8px;
  background: conic-gradient(from 0deg, #ff4d4d, #ffa64d, #ffee4d, #4dff88, #4dd2ff, #7a4dff, #ff4dcb, #ff4d4d);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}
#fix-outline .label {
  position: absolute;
  top: -22px;
  left: 0;
  font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #111;
  background: rgba(255,255,255,0.9);
  padding: 2px 6px;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.2);
}
#fix-inspector {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  background: rgba(10,10,10,0.88);
  color: #f2f2f2;
  font: 14px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  display: none;
}
#fix-inspector .panel {
  position: absolute;
  inset: 6% 4% 8% 4%;
  background: #111;
  border-radius: 14px;
  border: 1px solid #2a2a2a;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#fix-inspector .header {
  padding: 10px 14px;
  background: #171717;
  border-bottom: 1px solid #2a2a2a;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
#fix-inspector .title { font-weight: 600; }
#fix-inspector .close {
  font-size: 13px;
  padding: 6px 10px;
  border-radius: 8px;
  background: #2b2b2b;
  color: #f2f2f2;
}
#fix-inspector .body {
  flex: 1;
  overflow: auto;
  padding: 10px 14px 16px;
}
#fix-inspector .section {
  margin-bottom: 16px;
}
#fix-inspector .section h3 {
  font-size: 12px;
  color: #a0a0a0;
  margin: 10px 0 6px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
#fix-inspector .row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px dashed #262626;
}
#fix-inspector .row label { color: #c8c8c8; }
#fix-inspector .row input {
  width: 100%;
  background: #141414;
  color: #f4f4f4;
  border: 1px solid #2c2c2c;
  border-radius: 6px;
  padding: 4px 6px;
  font: inherit;
}
#fix-inspector .note {
  color: #8a8a8a;
  font-size: 12px;
}
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  const root = document.createElement('div');
  root.id = 'fix-root';
  const bubble = document.createElement('div');
  bubble.id = 'fix-bubble';
  const outline = document.createElement('div');
  outline.id = 'fix-outline';
  const label = document.createElement('div');
  label.className = 'label';
  outline.appendChild(label);

  const inspector = document.createElement('div');
  inspector.id = 'fix-inspector';
  inspector.innerHTML = `
    <div class="panel">
      <div class="header">
        <div class="title">Fix Inspector</div>
        <button class="close" type="button">Close</button>
      </div>
      <div class="body"></div>
    </div>
  `;

  root.appendChild(outline);
  root.appendChild(bubble);
  document.body.appendChild(root);
  document.body.appendChild(inspector);

  const closeBtn = inspector.querySelector('.close');
  const bodyEl = inspector.querySelector('.body');

  closeBtn.addEventListener('click', () => { inspector.style.display = 'none'; });

  function show() {
    state.visible = true;
    bubble.style.display = 'block';
    outline.style.display = 'block';
    updateBubble();
    updateSelection();
  }

  function hide() {
    state.visible = false;
    bubble.style.display = 'none';
    outline.style.display = 'none';
    inspector.style.display = 'none';
  }

  function updateBubble() {
    bubble.style.left = `${state.x}px`;
    bubble.style.top = `${state.y}px`;

    bubble.style.transform = `translate(-50%, -50%) rotate(0deg) scale(${1 + state.zIndexOffset * 0.02})`;
  }

  function getBubbleRect() {
    return bubble.getBoundingClientRect();
  }

  function getHaloRadius() {
    const v = getComputedStyle(root).getPropertyValue('--fix-halo').trim();
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n / 2;
    return 60;
  }

  function withinHalo(x, y) {
    const cx = state.x;
    const cy = state.y;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist <= getHaloRadius();
  }

  function updateSelection() {
    if (!state.visible) return;
    const br = getBubbleRect();
    const tipX = br.left + br.width / 2;
    const tipY = br.top + br.height * 0.85;
    const stack = document.elementsFromPoint(tipX, tipY).filter(el => el !== bubble && el !== outline && el !== root && el !== inspector && !inspector.contains(el));
    state.elementsStack = stack;
    const idx = Math.min(Math.max(state.zIndexOffset, 0), stack.length - 1);
    const el = stack[idx] || null;
    if (el !== state.selectedEl) {
      clearDim();
      state.selectedEl = el;
      dimAbove(stack, idx);
    }
    if (!el) {
      outline.style.display = 'none';
      return;
    }
    outline.style.display = 'block';
    const rect = el.getBoundingClientRect();
    outline.style.left = `${rect.left}px`;
    outline.style.top = `${rect.top}px`;
    outline.style.width = `${rect.width}px`;
    outline.style.height = `${rect.height}px`;
    label.textContent = describeEl(el);
  }

  function describeEl(el) {
    const id = el.id ? `#${el.id}` : '';
    const cls = el.classList.length ? `.${[...el.classList].join('.')}` : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  }

  function dimAbove(stack, idx) {
    for (let i = 0; i < idx; i++) {
      const el = stack[i];
      if (!el || el === document.documentElement || el === document.body) continue;
      if (el.style && !state.dimmedEls.has(el)) {
        state.dimmedEls.add(el);
        el.dataset.fixPrevOpacity = el.style.opacity || '';
        el.style.opacity = '0.25';
      }
    }
  }

  function clearDim() {
    state.dimmedEls.forEach((el) => {
      if (!el || !el.style) return;
      el.style.opacity = el.dataset.fixPrevOpacity || '';
      delete el.dataset.fixPrevOpacity;
    });
    state.dimmedEls.clear();
  }

  function moveTo(x, y, fromUser = true) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const prevX = state.x;
    const prevY = state.y;

    if (x < 0 || x > w) {
      if (!state.edgeLockX) {
        x = Math.min(Math.max(x, 0), w);
        state.edgeLockX = true;
      } else {
        x = x < 0 ? w : 0;
      }
    } else {
      state.edgeLockX = false;
    }
    if (y < 0 || y > h) {
      if (!state.edgeLockY) {
        y = Math.min(Math.max(y, 0), h);
        state.edgeLockY = true;
      } else {
        y = y < 0 ? h : 0;
      }
    } else {
      state.edgeLockY = false;
    }

    state.x = x;
    state.y = y;
    const now = performance.now();
    const dt = Math.max(now - state.lastMoveTime, 1);
    state.vx = (state.x - prevX) / dt;
    state.vy = (state.y - prevY) / dt;
    state.lastMoveTime = now;
    updateBubble();
    updateSelection();

    if (fromUser) Fix.emit('move', { x: state.x, y: state.y });
  }

  function showInspector() {
    const el = state.selectedEl;
    if (!el) return;
    inspector.style.display = 'block';
    bodyEl.innerHTML = '';

    const sections = [];
    sections.push({
      title: 'Element',
      rows: [
        { name: 'tag', value: el.tagName.toLowerCase() },
        { name: 'id', value: el.id || '' },
        { name: 'class', value: el.className || '' }
      ],
      editable: false
    });

    const inlineProps = [];
    for (let i = 0; i < el.style.length; i++) {
      const p = el.style[i];
      inlineProps.push([p, el.style.getPropertyValue(p)]);
    }
    inlineProps.sort((a,b) => a[0].localeCompare(b[0]));

    sections.push({
      title: 'Inline Styles',
      rows: inlineProps.map(([name, value]) => ({ name, value })),
      editable: true,
      allowAdd: true
    });

    const matched = collectMatchedRules(el);
    if (matched.length) {
      sections.push({
        title: 'Matched Rules',
        rows: matched.map(m => ({ name: m.selector, value: m.decl })),
        editable: false
      });
    }

    sections.forEach(sec => {
      const section = document.createElement('div');
      section.className = 'section';
      const h3 = document.createElement('h3');
      h3.textContent = sec.title;
      section.appendChild(h3);
      sec.rows.slice(0, 200).forEach(row => {
        const r = document.createElement('div');
        r.className = 'row';
        const label = document.createElement('label');
        label.textContent = row.name;
        const input = document.createElement('input');
        input.value = row.value;
        input.disabled = !sec.editable;
        if (sec.editable) {
          input.addEventListener('change', () => {
            el.style.setProperty(row.name, input.value);
            Fix.emit('csschange', { el, name: row.name, value: input.value });
          });
        }
        r.appendChild(label);
        r.appendChild(input);
        section.appendChild(r);
      });
      if (sec.allowAdd) {
        const r = document.createElement('div');
        r.className = 'row';
        const label = document.createElement('label');
        label.textContent = '+ add property';
        const input = document.createElement('input');
        input.placeholder = 'property: value';
        input.addEventListener('change', () => {
          const raw = input.value.trim();
          if (!raw) return;
          const idx = raw.indexOf(':');
          if (idx === -1) return;
          const name = raw.slice(0, idx).trim();
          const value = raw.slice(idx + 1).trim();
          if (!name) return;
          el.style.setProperty(name, value);
          Fix.emit('csschange', { el, name, value });
          input.value = '';
          showInspector();
        });
        r.appendChild(label);
        r.appendChild(input);
        section.appendChild(r);
      }
      bodyEl.appendChild(section);
    });

    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = 'Edits apply as inline styles on the selected element.';
    bodyEl.appendChild(note);
  }

  function collectMatchedRules(el) {
    const out = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (const rule of rules) {
        if (rule.type !== 1 || !rule.selectorText) continue; // STYLE_RULE
        const selectors = rule.selectorText.split(',').map(s => s.trim());
        for (const sel of selectors) {
          try {
            if (el.matches(sel)) {
              out.push({ selector: sel, decl: rule.style.cssText });
              break;
            }
          } catch (e) { /* ignore */ }
        }
      }
    }
    return out;
  }

  function onGestureTap(type, data) {
    Fix.emit(type, data);
    if (type === 'tap') {
      // no-op
    } else if (type === 'doubletap') {
      // no-op
    } else if (type === 'tripletap') {
      // no-op
    }
  }

  function handleTapSequence(e, targetIsBubble, targetIsHalo) {
    const now = performance.now();
    const g = state.gesture;
    if (now - g.lastTapTime > 350) {
      g.tapCount = 0;
    }
    g.tapCount += 1;
    g.lastTapTime = now;
    g.startX = e.clientX;
    g.startY = e.clientY;
    g.axisLock = null;
    g.sliding = false;
    g.startedOnBubble = targetIsBubble;
    g.startedOnHalo = targetIsHalo;

    clearTimeout(g.tapTimer);
    g.tapTimer = setTimeout(() => {
      if (g.tapCount === 1) onGestureTap('tap', { x: e.clientX, y: e.clientY });
      if (g.tapCount === 2) onGestureTap('doubletap', { x: e.clientX, y: e.clientY });
      if (g.tapCount >= 3) onGestureTap('tripletap', { x: e.clientX, y: e.clientY });
      g.tapCount = 0;
    }, 320);
  }

  function handleSlide(e) {
    const g = state.gesture;
    if (g.tapCount < 2) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.axisLock) {
      if (Math.abs(dx) + Math.abs(dy) < 6) return;
      g.axisLock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      g.sliding = true;
      Fix.emit(`${g.tapCount === 2 ? 'doubletap' : 'tripletap'}+slide${g.axisLock.toUpperCase()}`, { dx, dy });
    } else {
      Fix.emit(`${g.tapCount === 2 ? 'doubletap' : 'tripletap'}+slide${g.axisLock.toUpperCase()}`, { dx, dy });
    }

    if (g.startedOnHalo && g.tapCount === 2 && g.axisLock === 'y') {
      // z-index traverse
      const dir = dy < 0 ? 1 : -1;
      state.zIndexOffset = Math.min(Math.max(state.zIndexOffset + dir, 0), Math.max(state.elementsStack.length - 1, 0));
      updateSelection();
      bubble.style.transform = bubble.style.transform.replace(/scale\([^\)]+\)/, `scale(${1 + state.zIndexOffset * 0.02})`);
    }
  }

  function isTargetBubble(e) {
    return e.target === bubble || bubble.contains(e.target);
  }

  function startDrag(t, startedOnBubble, startedOnHalo, e) {
    state.dragging = true;
    state.pointerId = t.identifier;
    bubble.classList.add('active');
    state.gesture.startX = t.clientX;
    state.gesture.startY = t.clientY;
    state.gesture.lastX = t.clientX;
    state.gesture.lastY = t.clientY;
    state.gesture.grabOffsetX = t.clientX - state.x;
    state.gesture.grabOffsetY = t.clientY - state.y;
    state.gesture.startedOnBubble = startedOnBubble;
    state.gesture.startedOnHalo = startedOnHalo;
    handleTapSequence(t, startedOnBubble, startedOnHalo);
    Fix.emit('touchstart', { x: t.clientX, y: t.clientY });
    if (e) e.preventDefault();
  }

  // Global triple tap + hold to show
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    if (state.dragging) return;
    const t = e.touches[0];
    if (state.visible && !state.dragging && withinHalo(t.clientX, t.clientY)) {
      startDrag(t, isTargetBubble(e), true, e);
      return;
    }
    handleTapSequence(t, isTargetBubble(e), state.visible && withinHalo(t.clientX, t.clientY));
    const g = state.gesture;
    if (g.tapCount >= 3) {
      clearTimeout(g.holdTimer);
      g.holdTimer = setTimeout(() => {
        if (!state.visible) show();
      }, 1000);
    }
  }, { passive: true });

  document.addEventListener('touchend', () => {
    clearTimeout(state.gesture.holdTimer);
  }, { passive: true });

  // Bubble drag + interactions
  bubble.addEventListener('touchstart', (e) => {
    if (!state.visible) return;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    startDrag(t, true, true, e);
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (!state.dragging) return;
    const t = [...e.touches].find(tt => tt.identifier === state.pointerId) || e.touches[0];
    if (!t) return;
    state.gesture.lastX = t.clientX;
    state.gesture.lastY = t.clientY;
    moveTo(t.clientX - state.gesture.grabOffsetX, t.clientY - state.gesture.grabOffsetY);
    handleSlide(t);
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    if (!state.dragging) return;
    state.dragging = false;
    state.pointerId = null;
    bubble.classList.remove('active');
    const g = state.gesture;
    const dx = g.lastX - g.startX;
    const dy = g.lastY - g.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (g.startedOnBubble && dist < 6 && !g.sliding) {
      showInspector();
    }
    Fix.emit('touchend', {});
  }, { passive: true });

  // Keep selection updated on resize
  window.addEventListener('resize', () => {
    moveTo(Math.min(state.x, window.innerWidth), Math.min(state.y, window.innerHeight), false);
  });

  // Default listener for tap+slide events on bubble area
  Fix.on('doubletap+slideY', () => {});
  Fix.on('tripletap+slideY', () => {});

  // Initially hidden
  hide();
})();
