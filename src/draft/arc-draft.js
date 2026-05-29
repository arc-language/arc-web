/* arc-draft.js — inline block editor, zero dependencies */
(function () {
  'use strict';

  const TOKEN = new URLSearchParams(location.search).get('draft');
  if (!TOKEN) return;

  let blockTypes = new Map();
  let activeBlockId = null;
  let saveTimer = null;
  let overlay = null;
  let toolbar = null;

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  async function init() {
    const res = await fetch('/admin/api/draft?token=' + encodeURIComponent(TOKEN));
    if (!res.ok) return;
    const { valid } = await res.json();
    if (!valid) return;

    const typesRes = await fetch('/admin/api/block-types');
    if (typesRes.ok) {
      const data = await typesRes.json();
      for (const [k, v] of Object.entries(data)) blockTypes.set(k, v);
    }

    injectStyles();
    buildToolbar();
    buildOverlay();
    attachEvents();
    markBlocks();
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
[data-block-id] { outline: 2px dashed transparent; outline-offset: 2px; transition: outline-color .15s; cursor: pointer; }
[data-block-id]:hover { outline-color: #6366f1; }
[data-block-id].arc-active { outline-color: #4f46e5; outline-style: solid; }
#arc-toolbar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
  height: 44px; background: #18181b; color: #fff; display: flex;
  align-items: center; padding: 0 16px; gap: 12px; font: 13px/1 system-ui, sans-serif;
  box-shadow: 0 2px 8px rgba(0,0,0,.35);
}
#arc-toolbar .arc-t-logo { font-size: 15px; opacity: .8; }
#arc-toolbar .arc-t-label { font-weight: 600; letter-spacing: .01em; }
#arc-toolbar .arc-t-sep { width: 1px; height: 20px; background: rgba(255,255,255,.15); }
#arc-toolbar button {
  background: rgba(255,255,255,.08); color: #fff; border: 1px solid rgba(255,255,255,.15);
  border-radius: 6px; padding: 5px 12px; font: inherit; cursor: pointer; transition: background .15s;
}
#arc-toolbar button:hover { background: rgba(255,255,255,.18); }
#arc-toolbar .arc-t-pub { background: #4f46e5; border-color: #4f46e5; }
#arc-toolbar .arc-t-pub:hover { background: #4338ca; }
#arc-toolbar .arc-t-exit { background: transparent; border: none; opacity: .6; font-size: 16px; padding: 4px 8px; margin-left: auto; }
#arc-toolbar .arc-t-exit:hover { opacity: 1; }
#arc-dropdown {
  position: absolute; top: 44px; left: 0; background: #18181b; border: 1px solid rgba(255,255,255,.1);
  border-radius: 8px; padding: 4px; min-width: 180px; z-index: 99998;
  box-shadow: 0 8px 24px rgba(0,0,0,.4);
}
#arc-dropdown button {
  display: block; width: 100%; text-align: left; background: none; border: none;
  color: #e4e4e7; padding: 8px 12px; border-radius: 5px; font: 13px system-ui, sans-serif; cursor: pointer;
}
#arc-dropdown button:hover { background: rgba(255,255,255,.08); }
#arc-overlay {
  position: fixed; z-index: 99990; background: #fff; color: #0a0a0a;
  border: 1px solid #e5e5e5; border-radius: 10px; padding: 16px;
  min-width: 260px; max-width: 380px; box-shadow: 0 12px 40px rgba(0,0,0,.15);
  font: 13px system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  #arc-overlay { background: #18181b; color: #f0f0f0; border-color: rgba(255,255,255,.1); }
}
#arc-overlay .arc-o-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
#arc-overlay .arc-o-type { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; opacity: .5; }
#arc-overlay .arc-o-close { background: none; border: none; font-size: 16px; cursor: pointer; opacity: .5; padding: 0; }
#arc-overlay .arc-o-close:hover { opacity: 1; }
#arc-overlay .arc-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
#arc-overlay .arc-field label { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; opacity: .5; }
#arc-overlay .arc-field input, #arc-overlay .arc-field textarea {
  background: transparent; border: 1px solid rgba(0,0,0,.12); border-radius: 6px;
  padding: 7px 10px; font: 13px system-ui, sans-serif; color: inherit; width: 100%; box-sizing: border-box;
}
@media (prefers-color-scheme: dark) {
  #arc-overlay .arc-field input, #arc-overlay .arc-field textarea { border-color: rgba(255,255,255,.12); }
}
#arc-overlay .arc-field input:focus, #arc-overlay .arc-field textarea:focus {
  outline: 2px solid #4f46e5; outline-offset: -1px; border-color: transparent;
}
#arc-overlay .arc-field textarea { resize: vertical; min-height: 72px; }
#arc-overlay .arc-o-foot { display: flex; justify-content: space-between; margin-top: 12px; }
#arc-overlay .arc-o-del { background: none; border: 1px solid rgba(220,38,38,.4); color: #dc2626; border-radius: 6px; padding: 5px 10px; font: 13px system-ui, sans-serif; cursor: pointer; }
#arc-overlay .arc-o-del:hover { background: rgba(220,38,38,.08); }
#arc-overlay .arc-o-status { font-size: 11px; opacity: .5; align-self: center; }
#arc-overlay .arc-o-status.saved { color: #22c55e; opacity: 1; }
#arc-overlay .arc-o-status.error { color: #ef4444; opacity: 1; }
body { padding-top: 44px !important; }`;
    document.head.appendChild(s);
  }

  // ── Toolbar ────────────────────────────────────────────────────────────────

  function buildToolbar() {
    toolbar = document.createElement('div');
    toolbar.id = 'arc-toolbar';
    toolbar.innerHTML = `
      <span class="arc-t-logo">◈</span>
      <span class="arc-t-label">Draft</span>
      <span class="arc-t-sep"></span>
      <button id="arc-blocks-btn">Blocks ▾</button>
      <button class="arc-t-pub" id="arc-pub-btn">Publish</button>
      <button class="arc-t-exit" id="arc-exit-btn" title="Exit draft mode">✕</button>`;
    document.body.insertAdjacentElement('afterbegin', toolbar);

    document.getElementById('arc-blocks-btn').addEventListener('click', toggleDropdown);
    document.getElementById('arc-pub-btn').addEventListener('click', publish);
    document.getElementById('arc-exit-btn').addEventListener('click', exitDraft);
  }

  function toggleDropdown() {
    let dd = document.getElementById('arc-dropdown');
    if (dd) { dd.remove(); return; }
    dd = document.createElement('div');
    dd.id = 'arc-dropdown';
    if (blockTypes.size === 0) {
      dd.innerHTML = '<button disabled style="opacity:.5">No block types defined</button>';
    } else {
      for (const [type, schema] of blockTypes) {
        const btn = document.createElement('button');
        btn.textContent = schema.label || type;
        btn.addEventListener('click', () => { addBlock(type); dd.remove(); });
        dd.appendChild(btn);
      }
    }
    toolbar.appendChild(dd);
  }

  async function addBlock(type) {
    const page = location.pathname.replace(/^\//, '') || 'home';
    const res = await fetch('/admin/blocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Draft-Token': TOKEN },
      body: JSON.stringify({ page, type, data: '{}' })
    });
    if (res.ok) location.reload();
  }

  async function publish() {
    const btn = document.getElementById('arc-pub-btn');
    btn.textContent = 'Saving…';
    const res = await fetch('/admin/api/publish', {
      method: 'POST',
      headers: { 'X-Draft-Token': TOKEN }
    });
    btn.textContent = res.ok ? 'Published ✓' : 'Error';
    setTimeout(() => { btn.textContent = 'Publish'; }, 2000);
  }

  function exitDraft() {
    const url = new URL(location.href);
    url.searchParams.delete('draft');
    location.replace(url.toString());
  }

  // ── Overlay ────────────────────────────────────────────────────────────────

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'arc-overlay';
    overlay.style.display = 'none';
    document.body.appendChild(overlay);
  }

  function openOverlay(blockEl) {
    const id = blockEl.dataset.blockId;
    const type = blockEl.dataset.blockType;
    const schema = blockTypes.get(type);
    activeBlockId = id;

    // Collect current field values from DOM
    const currentData = {};
    blockEl.querySelectorAll('[data-field]').forEach(el => {
      currentData[el.dataset.field] = el.textContent;
    });

    const safeType = type.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fields = schema ? schema.fields : [];
    overlay.innerHTML = `
      <div class="arc-o-hd">
        <span class="arc-o-type">${safeType}</span>
        <button class="arc-o-close">✕</button>
      </div>
      ${fields.map(f => buildFieldHtml(f, currentData[f.name] ?? '')).join('')}
      <div class="arc-o-foot">
        <button class="arc-o-del">Delete block</button>
        <span class="arc-o-status" id="arc-save-status"></span>
      </div>`;

    overlay.querySelector('.arc-o-close').addEventListener('click', closeOverlay);
    overlay.querySelector('.arc-o-del').addEventListener('click', () => deleteBlock(id, blockEl));

    overlay.querySelectorAll('input, textarea').forEach(input => {
      input.addEventListener('input', () => scheduleSave(blockEl, schema));
    });

    positionOverlay(blockEl);
    overlay.style.display = 'block';
  }

  function buildFieldHtml(f, value) {
    const escaped = value.replace(/"/g, '&quot;').replace(/</g, '&lt;');
    if (f.type === 'Bool') {
      return `<div class="arc-field">
        <label><input type="checkbox" data-fname="${f.name}"${value ? ' checked' : ''}> ${f.label || f.name}</label>
      </div>`;
    }
    const tag = f.type === 'Text' ? 'textarea' : 'input';
    const attrs = tag === 'input' ? `type="text" value="${escaped}"` : '';
    return `<div class="arc-field">
      <label>${f.label || f.name}</label>
      <${tag} data-fname="${f.name}" ${attrs}>${tag === 'textarea' ? escaped : ''}</${tag}>
    </div>`;
  }

  function positionOverlay(blockEl) {
    const rect = blockEl.getBoundingClientRect();
    const ow = 380;
    let left = rect.right + 8;
    if (left + ow > window.innerWidth) left = Math.max(8, rect.left - ow - 8);
    let top = rect.top + window.scrollY;
    overlay.style.left = left + 'px';
    overlay.style.top = top + 'px';
  }

  function closeOverlay() {
    if (activeBlockId) {
      const el = document.querySelector(`[data-block-id="${activeBlockId}"]`);
      if (el) el.classList.remove('arc-active');
    }
    activeBlockId = null;
    overlay.style.display = 'none';
    clearTimeout(saveTimer);
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  function scheduleSave(blockEl, schema) {
    clearTimeout(saveTimer);
    setStatus('');
    saveTimer = setTimeout(() => saveBlock(blockEl, schema), 800);
  }

  async function saveBlock(blockEl, schema) {
    const id = blockEl.dataset.blockId;
    const fields = schema ? schema.fields : [];

    // Read values from overlay inputs
    const newData = {};
    overlay.querySelectorAll('[data-fname]').forEach(input => {
      const name = input.dataset.fname;
      newData[name] = input.type === 'checkbox' ? input.checked : input.value;
    });

    // Optimistic DOM update
    const rollback = {};
    fields.forEach(f => {
      const domEl = blockEl.querySelector(`[data-field="${f.name}"]`);
      if (domEl) { rollback[f.name] = domEl.textContent; domEl.textContent = String(newData[f.name] ?? ''); }
    });

    try {
      const res = await fetch(`/admin/blocks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Draft-Token': TOKEN },
        body: JSON.stringify({ data: newData })
      });
      if (!res.ok) throw new Error('save failed');
      setStatus('Saved ✓', 'saved');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      console.error('[arc:cms] save failed:', err?.message ?? String(err))
      // Roll back optimistic update
      fields.forEach(f => {
        const domEl = blockEl.querySelector(`[data-field="${f.name}"]`);
        if (domEl && rollback[f.name] !== undefined) domEl.textContent = rollback[f.name];
      });
      setStatus('Save failed', 'error');
    }
  }

  function setStatus(msg, cls) {
    const el = document.getElementById('arc-save-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'arc-o-status' + (cls ? ' ' + cls : '');
  }

  // ── Delete / reorder ───────────────────────────────────────────────────────

  async function deleteBlock(id, blockEl) {
    if (!confirm('Delete this block?')) return;
    const res = await fetch(`/admin/blocks/${id}`, {
      method: 'DELETE',
      headers: { 'X-Draft-Token': TOKEN }
    });
    if (res.ok) {
      closeOverlay();
      blockEl.remove();
    }
  }

  // ── Events (single delegation) ─────────────────────────────────────────────

  function attachEvents() {
    document.body.addEventListener('click', e => {
      // Close dropdown on outside click
      const dd = document.getElementById('arc-dropdown');
      if (dd && !dd.contains(e.target) && !document.getElementById('arc-blocks-btn').contains(e.target)) {
        dd.remove();
      }
      // Close overlay on outside click
      if (overlay.style.display !== 'none' && !overlay.contains(e.target) && !e.target.closest('[data-block-id]')) {
        closeOverlay();
        return;
      }
      const block = e.target.closest('[data-block-id]');
      if (!block || overlay.contains(e.target)) return;

      document.querySelectorAll('[data-block-id].arc-active').forEach(el => el.classList.remove('arc-active'));
      block.classList.add('arc-active');
      openOverlay(block);
    });

    // Reposition overlay on scroll
    document.addEventListener('scroll', () => {
      if (overlay.style.display === 'none' || !activeBlockId) return;
      const el = document.querySelector(`[data-block-id="${activeBlockId}"]`);
      if (el) positionOverlay(el);
    }, { passive: true });
  }

  function markBlocks() {
    document.querySelectorAll('[data-block-id]').forEach(el => {
      if (!el.dataset.blockType) return;
      // Add up/down order controls
      const nav = document.createElement('div');
      nav.className = 'arc-block-nav';
      nav.style.cssText = 'position:absolute;top:4px;right:4px;display:none;gap:2px;z-index:10;';
      nav.innerHTML = `<button onclick="arcMoveBlock(this,'up')" style="background:#18181b;color:#fff;border:none;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:11px;">↑</button>
        <button onclick="arcMoveBlock(this,'down')" style="background:#18181b;color:#fff;border:none;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:11px;">↓</button>`;
      const pos = getComputedStyle(el).position;
      if (pos === 'static') el.style.position = 'relative';
      el.appendChild(nav);
      el.addEventListener('mouseenter', () => { nav.style.display = 'flex'; });
      el.addEventListener('mouseleave', () => { nav.style.display = 'none'; });
    });
  }

  window.arcMoveBlock = async function (btn, dir) {
    const block = btn.closest('[data-block-id]');
    const id = block.dataset.blockId;
    const sibling = dir === 'up' ? block.previousElementSibling : block.nextElementSibling;
    if (!sibling || !sibling.dataset.blockId) return;

    const res = await fetch(`/admin/blocks/${id}/reorder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Draft-Token': TOKEN },
      body: JSON.stringify({ direction: dir })
    });
    if (res.ok) {
      if (dir === 'up') block.parentNode.insertBefore(block, sibling);
      else sibling.parentNode.insertBefore(sibling, block);
    }
  };

  init();
})();
