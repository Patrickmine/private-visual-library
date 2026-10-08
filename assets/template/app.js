const fields = { category: 'CATEGORY', imageType: 'IMAGE TYPE', composition: 'COMPOSITION', background: 'BACKGROUND' };
const copy = {
  en: { category: 'CATEGORY', imageType: 'IMAGE TYPE', composition: 'COMPOSITION', background: 'BACKGROUND', all: 'ALL', images: 'IMAGES', image: 'IMAGE', newest: 'NEWEST', oldest: 'OLDEST', clearAll: 'CLEAR ALL', noMatches: 'No images match this combination.', back: 'BACK TO LIBRARY', viewOriginal: 'VIEW ORIGINAL ↗', lowResolution: 'LOW-RESOLUTION ORIGINAL\nShown without enlargement.', inCollection: 'IN THIS COLLECTION', noMatchesLabel: 'NO MATCHES IN THIS COLLECTION' },
  zh: { category: '品类', imageType: '图片类型', composition: '构图', background: '背景', all: '全部', images: '张图片', image: '图片', newest: '最新', oldest: '最早', clearAll: '清除全部', noMatches: '没有符合此组合的图片。', back: '返回图库', viewOriginal: '查看原图 ↗', lowResolution: '原图分辨率较低\n未作放大显示。', inCollection: '当前结果', noMatchesLabel: '当前筛选下无匹配图片' },
};
const gallery = document.querySelector('#gallery');
const filterPanel = document.querySelector('#filter-panel');
const focus = document.querySelector('#focus');
const focusImage = document.querySelector('#focus-image');
const library = document.querySelector('#library');
const header = document.querySelector('.site-header');
const navButtons = [...document.querySelectorAll('[data-filter]')];
const languageButtons = [...document.querySelectorAll('[data-language]')];
const state = { references: [], taxonomy: {}, selected: {}, sort: 'newest', language: 'en', openFilter: null, focusedId: null, scroll: 0, triggerId: null };
let columns = getColumns();
let resizing;
let transitionRunning = false;
let hoverOpenTimer;
let hoverCloseTimer;
let blockedHoverField = null;
let ignoreNavFocus = false;
let lastNavPointerType = 'mouse';

function cancelHoverTimers() { clearTimeout(hoverOpenTimer); clearTimeout(hoverCloseTimer); }
function insideFilterZone(target) { return target instanceof Node && header.contains(target); }
function scheduleFilterClose() {
  clearTimeout(hoverOpenTimer); clearTimeout(hoverCloseTimer);
  hoverCloseTimer = setTimeout(() => closeFilter(), 180);
}

function getColumns() { return innerWidth > 1649 ? 5 : innerWidth > 1100 ? 4 : innerWidth > 600 ? 3 : 2; }
function pad(number) { return String(number).padStart(2, '0'); }
function scrollToResults() {
  window.scrollTo({
    top: 0,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}
function filtered(except) { return state.references.filter(item => Object.entries(state.selected).every(([field, value]) => field === except || item[field] === value)); }
function ordered(except) { return filtered(except).toSorted((a, b) => state.sort === 'newest' ? b.id - a.id : a.id - b.id); }
function button(text, className) { const node = document.createElement('button'); node.type = 'button'; node.className = className; node.textContent = text; return node; }
function text(key) { return copy[state.language][key]; }
function fieldLabel(field) { return text(field); }
function valueLabel(field, value) { return state.language === 'zh' ? state.taxonomy[field]?.find(entry => entry.value === value)?.zh || value : value; }
function renderInterface() {
  document.documentElement.lang = state.language === 'zh' ? 'zh-CN' : 'en';
  navButtons.forEach(node => { node.textContent = fieldLabel(node.dataset.filter); });
  languageButtons.forEach(node => node.setAttribute('aria-pressed', String(node.dataset.language === state.language)));
  document.querySelector('.filters').setAttribute('aria-label', state.language === 'zh' ? '筛选参考图' : 'Filter references');
  document.querySelector('#empty-message').textContent = text('noMatches');
  document.querySelector('#empty-clear').textContent = text('clearAll');
  document.querySelector('#clear-all').textContent = text('clearAll');
  document.querySelector('#close-focus').innerHTML = `${text('back')} <span aria-hidden="true">×</span>`;
  document.querySelector('#original').textContent = text('viewOriginal');
  document.querySelector('#resolution-note').innerHTML = text('lowResolution').replace('\n', '<br>');
}

function renderGallery() {
  const items = ordered();
  gallery.replaceChildren();
  let row;
  let used = columns;
  items.forEach((item, index) => {
    const ratio = item.width / item.height;
    const span = ratio >= 1.6 ? 2 : 1;
    if (used + span > columns) { row = document.createElement('div'); row.className = 'editorial-row'; gallery.append(row); used = 0; }
    const reference = button('', 'reference');
    reference.dataset.id = item.id;
    reference.style.setProperty('--span', span);
    reference.style.setProperty('--ratio', ratio);
    reference.style.setProperty('--intrinsic-width', `${item.width}px`);
    reference.setAttribute('aria-label', `${state.language === 'zh' ? '打开图片' : 'Open reference'} ${pad(item.id)}: ${valueLabel('category', item.category)}, ${valueLabel('imageType', item.imageType)}`);
    const image = new Image();
    image.src = item.image;
    image.alt = `${valueLabel('category', item.category)}: ${valueLabel('imageType', item.imageType)}, ${valueLabel('composition', item.composition)}, ${valueLabel('background', item.background)}`;
    image.width = item.width;
    image.height = item.height;
    image.className = 'reference-image';
    image.loading = index < columns ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => reference.classList.add('image-error'));
    const caption = document.createElement('span');
    caption.className = 'hover-caption';
    caption.setAttribute('aria-hidden', 'true');
    const category = document.createElement('span'); category.textContent = valueLabel('category', item.category);
    const type = document.createElement('span'); type.className = 'caption-type'; type.textContent = valueLabel('imageType', item.imageType);
    const number = document.createElement('span'); number.className = 'serial'; number.textContent = pad(item.id);
    caption.append(category, type, number);
    reference.append(image, caption);
    reference.addEventListener('click', () => openFocus(item.id));
    row.append(reference);
    used += span;
  });
  document.querySelector('#empty').hidden = items.length > 0;
  document.querySelector('#count').innerHTML = `<span>${pad(items.length)}</span> ${state.language === 'zh' ? text('images') : items.length === 1 ? text('image') : text('images')}`;
  const conditions = document.querySelector('#conditions');
  conditions.replaceChildren();
  Object.keys(fields).forEach(key => {
    if (!state.selected[key]) return;
    const condition = button('', 'condition');
    condition.setAttribute('aria-label', `${state.language === 'zh' ? '移除' : 'Remove'} ${fieldLabel(key)} ${valueLabel(key, state.selected[key])}`);
    const field = document.createElement('span'); field.className = 'condition-label'; field.textContent = `${fieldLabel(key)} /`;
    const value = document.createElement('span'); value.className = 'condition-value'; value.textContent = valueLabel(key, state.selected[key]);
    const remove = document.createElement('span'); remove.className = 'condition-remove'; remove.textContent = '×'; remove.setAttribute('aria-hidden', 'true');
    condition.append(field, value, remove); conditions.append(condition);
    condition.addEventListener('click', () => { delete state.selected[key]; closeFilter(); renderGallery(); scrollToResults(); navButtons.find(node => node.dataset.filter === key)?.focus({preventScroll:true}); });
  });
  document.querySelector('#clear-all').hidden = Object.keys(state.selected).length === 0;
  const sort = document.querySelector('#sort');
  sort.textContent = text(state.sort);
  sort.setAttribute('aria-label', `${state.language === 'zh' ? '排序：' : 'Sort images: '}${text(state.sort)}${state.language === 'zh' ? '优先' : ' first'}`);
  navButtons.forEach(node => node.classList.toggle('is-active', Boolean(state.selected[node.dataset.filter])));
}

function closeFilter(returnFocus = false) {
  cancelHoverTimers();
  const prior = state.openFilter;
  const trigger = navButtons.find(node => node.dataset.filter === prior);
  blockedHoverField = trigger?.matches(':hover') ? prior : null;
  state.openFilter = null;
  filterPanel.hidden = true;
  navButtons.forEach(node => node.setAttribute('aria-expanded', 'false'));
  if (returnFocus && trigger) { ignoreNavFocus = true; trigger.focus({preventScroll:true}); ignoreNavFocus = false; }
}

function openFilter(field, toggle = false) {
  cancelHoverTimers();
  if (!state.taxonomy[field] || !focus.hidden) return;
  if (state.openFilter === field) { if (toggle) closeFilter(); return; }
  state.openFilter = field;
  filterPanel.replaceChildren();
  filterPanel.hidden = false;
  filterPanel.setAttribute('aria-label', `${fieldLabel(field)} ${state.language === 'zh' ? '筛选项' : 'filter options'}`);
  navButtons.forEach(node => node.setAttribute('aria-expanded', String(node.dataset.filter === field)));
  const available = filtered(field);
  const entries = state.taxonomy[field].map(entry => ({...entry, count:available.filter(item => item[field] === entry.value).length}));
  const options = [{value:'ALL', label:text('all'), count:available.length}, ...entries.filter(entry => entry.count > 0), ...entries.filter(entry => entry.count === 0)];
  let separated = false;
  options.forEach(({value, label, count, zh, definition}) => {
    if (!count && value !== 'ALL' && !separated) {
      const separator = document.createElement('p'); separator.className = 'unavailable-label'; separator.textContent = text('noMatchesLabel'); filterPanel.append(separator); separated = true;
    }
    const option = button(label || valueLabel(field, value), 'filter-option');
    option.dataset.value = value;
    option.disabled = count === 0 && value !== 'ALL';
    if (definition) option.title = `${zh} — ${definition}`;
    option.setAttribute('aria-pressed', String((state.selected[field] || 'ALL') === value));
    const number = document.createElement('span'); number.className = 'option-count'; number.textContent = pad(count);
    option.append(number);
    option.addEventListener('click', () => {
      if (value === 'ALL') delete state.selected[field]; else state.selected[field] = value;
      closeFilter(true); renderGallery(); scrollToResults();
    });
    filterPanel.append(option);
  });
  positionFilter();
}

function positionFilter() {
  if (!state.openFilter) return;
  const trigger = navButtons.find(node => node.dataset.filter === state.openFilter).getBoundingClientRect();
  const edge = parseFloat(getComputedStyle(document.querySelector('.header-bar')).paddingLeft) || 20;
  const width = Math.min(340, innerWidth - edge * 2);
  const left = Math.max(edge, Math.min(trigger.left, innerWidth - edge - width));
  filterPanel.style.width = `${width}px`; filterPanel.style.left = `${left}px`;
}

async function transition(update, id) {
  if (transitionRunning) return;
  const source = document.querySelector(`.reference[data-id="${id}"] .reference-image`);
  const shared = Boolean(document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches && source?.complete && source.naturalWidth && source.getBoundingClientRect().bottom > 0 && source.getBoundingClientRect().top < innerHeight);
  if (!shared) {
    if (!focus.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      transitionRunning = true;
      focus.classList.add('is-closing');
      await new Promise(resolve => setTimeout(resolve, 180));
      update(); focus.classList.remove('is-closing'); transitionRunning = false;
    } else update();
    return;
  }
  transitionRunning = true;
  const name = `reference-${id}`;
  (focus.hidden ? source : focusImage).style.viewTransitionName = name;
  let updated = false;
  const commit = () => { if (!updated) { update(); updated = true; } };
  try {
    const view = document.startViewTransition(() => {
      source.style.viewTransitionName = '';
      focusImage.style.viewTransitionName = '';
      commit();
      (focus.hidden ? source : focusImage).style.viewTransitionName = name;
    });
    await view.finished;
  } catch { commit(); }
  finally { source.style.viewTransitionName = ''; focusImage.style.viewTransitionName = ''; transitionRunning = false; }
}

function renderFocus() {
  const item = state.references.find(item => item.id === state.focusedId);
  focusImage.src = item.image;
  focusImage.alt = `${valueLabel('category', item.category)}: ${valueLabel('imageType', item.imageType)}, ${valueLabel('composition', item.composition)}`;
  document.querySelector('#focus-number').innerHTML = `${text('image')} <span>${pad(item.id)}</span>`;
  const details = document.querySelector('#focus-details'); details.replaceChildren();
  Object.entries(fields).forEach(([field, label]) => {
    const group = document.createElement('div');
    const term = document.createElement('dt'); term.textContent = fieldLabel(field);
    const description = document.createElement('dd'); description.textContent = valueLabel(field, item[field]);
    group.append(term, description); details.append(group);
  });
  document.querySelector('#original').href = item.image;
  const items = ordered();
  const index = items.findIndex(item => item.id === state.focusedId);
  document.querySelector('#focus-progress').textContent = `${pad(index + 1)} / ${pad(items.length)} ${text('inCollection')}`;
  document.querySelector('#resolution-note').hidden = item.width >= 500 && item.height >= 300;
  document.querySelector('#previous').disabled = index <= 0;
  document.querySelector('#next').disabled = index >= items.length - 1;
}

function openFocus(id) {
  closeFilter(); state.scroll = scrollY; state.triggerId = id; state.focusedId = id;
  transition(() => {
    renderFocus(); focus.hidden = false; library.inert = true; header.inert = true;
    document.body.style.overflow = 'hidden'; focus.scrollTop = 0; document.querySelector('.focus-info').scrollTop = 0; document.querySelector('#close-focus').focus({ preventScroll: true });
  }, id);
}
function closeFocus() {
  if (focus.hidden) return;
  const closingId = state.focusedId;
  transition(() => {
    focus.hidden = true; library.inert = false; header.inert = false; document.body.style.overflow = '';
    state.focusedId = null; window.scrollTo({ top: state.scroll, behavior: 'instant' });
    document.querySelector(`.reference[data-id="${state.triggerId}"]`)?.focus({ preventScroll: true });
  }, closingId);
}
function navigate(direction) {
  if (transitionRunning) return;
  const items = ordered(); const index = items.findIndex(item => item.id === state.focusedId);
  const next = items[index + direction]; if (!next) return;
  state.focusedId = next.id; renderFocus(); focus.scrollTop = 0;
}
function clearAll() { state.selected = {}; closeFilter(); renderGallery(); scrollToResults(); }
function goHome(event) {
  event.preventDefault();
  if (transitionRunning) return;
  focus.hidden = true; state.focusedId = null; library.inert = false; header.inert = false; document.body.style.overflow = '';
  clearAll(); window.scrollTo({top:0,behavior:'instant'});
}

document.querySelector('#home').addEventListener('click', goHome);
languageButtons.forEach(node => node.addEventListener('click', () => {
  if (node.dataset.language === state.language) return;
  state.language = node.dataset.language;
  closeFilter(); renderInterface(); renderGallery();
  if (!focus.hidden) renderFocus();
}));
navButtons.forEach(node => {
  const field = node.dataset.filter;
  node.addEventListener('pointerdown', event => { lastNavPointerType = event.pointerType; });
  node.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'mouse' || blockedHoverField === field) return;
    cancelHoverTimers(); hoverOpenTimer = setTimeout(() => openFilter(field), 80);
  });
  node.addEventListener('pointerleave', event => {
    clearTimeout(hoverOpenTimer);
    if (blockedHoverField === field) blockedHoverField = null;
    if (!insideFilterZone(event.relatedTarget)) scheduleFilterClose();
  });
  node.addEventListener('click', event => {
    const toggle = event.detail === 0 || lastNavPointerType === 'touch' || lastNavPointerType === 'pen';
    blockedHoverField = null; openFilter(field, toggle);
  });
  node.addEventListener('focus', () => {
    if (!ignoreNavFocus && node.matches(':focus-visible')) openFilter(field);
  });
  node.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault(); openFilter(field);
    const options = [...filterPanel.querySelectorAll('button:not(:disabled)')];
    (event.key === 'ArrowDown' ? options[0] : options.at(-1))?.focus();
  });
});
header.addEventListener('pointerenter', () => clearTimeout(hoverCloseTimer));
header.addEventListener('pointerleave', event => {
  if (!insideFilterZone(event.relatedTarget)) { blockedHoverField = null; scheduleFilterClose(); }
});
filterPanel.addEventListener('pointerenter', cancelHoverTimers);
filterPanel.addEventListener('pointerleave', event => { if (!insideFilterZone(event.relatedTarget)) scheduleFilterClose(); });
filterPanel.addEventListener('keydown', event => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const options = [...filterPanel.querySelectorAll('button:not(:disabled)')];
  const index = options.indexOf(document.activeElement);
  if (index < 0) return;
  event.preventDefault(); options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length].focus();
});
header.addEventListener('focusout', event => { if (!insideFilterZone(event.relatedTarget)) closeFilter(); });
document.querySelector('#clear-all').addEventListener('click', clearAll);
document.querySelector('#sort').addEventListener('click', () => { state.sort = state.sort === 'newest' ? 'oldest' : 'newest'; renderGallery(); window.scrollTo({ top: 0, behavior: 'instant' }); });
document.querySelector('#empty-clear').addEventListener('click', clearAll);
document.querySelector('#close-focus').addEventListener('click', closeFocus);
document.querySelector('#previous').addEventListener('click', () => navigate(-1));
document.querySelector('#next').addEventListener('click', () => navigate(1));
document.addEventListener('click', event => { if (state.openFilter && !insideFilterZone(event.target)) closeFilter(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { if (!focus.hidden) closeFocus(); else closeFilter(true); }
  if (!focus.hidden && event.key === 'ArrowLeft') { event.preventDefault(); navigate(-1); }
  if (!focus.hidden && event.key === 'ArrowRight') { event.preventDefault(); navigate(1); }
  if (!focus.hidden && event.key === 'Tab') {
    const controls = [...focus.querySelectorAll('button:not(:disabled), a[href]')];
    const first = controls[0]; const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
window.addEventListener('resize', () => {
  clearTimeout(resizing); resizing = setTimeout(() => { const current = getColumns(); if (current !== columns) { columns = current; renderGallery(); } positionFilter(); }, 120);
});
new ResizeObserver(() => { document.documentElement.style.setProperty('--header-height', `${header.offsetHeight}px`); positionFilter(); }).observe(header);

try {
  const responses = await Promise.all([
    fetch('references.json', {cache: 'no-store'}),
    fetch('taxonomy.json', {cache: 'no-store'}),
  ]);
  if (responses.some(response => !response.ok)) throw new Error('Reference data could not be loaded.');
  [state.references, state.taxonomy] = await Promise.all(responses.map(response => response.json()));
  if (!Array.isArray(state.references) || !state.references.length) throw new Error('Expected a non-empty reference collection.');
  for (const item of state.references) for (const field of Object.keys(fields)) {
    if (!state.taxonomy[field].some(entry => entry.value === item[field])) throw new Error(`Unapproved ${field}: ${item[field]}`);
  }
  renderInterface();
  renderGallery();
} catch (error) {
  gallery.replaceChildren(); const message = document.createElement('p'); message.className = 'load-status';
  message.textContent = 'The reference data could not be loaded. Please open this archive through its local server.';
  gallery.append(message); navButtons.forEach(node => node.disabled = true); console.error(error);
}
