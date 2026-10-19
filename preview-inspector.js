/**
 * Preview Studio inspector.
 *
 * Injected into every HTML document served by a preview origin. It draws the
 * selection and adjustment overlay inside the previewed app, captures pointer
 * interaction in select/adjust modes, and reports element locators and
 * requested changes to the Harness panel over postMessage.
 *
 * Run mode never intercepts events.
 */
(() => {
  if (window.__PREVIEW_STUDIO_INSPECTOR__) return
  window.__PREVIEW_STUDIO_INSPECTOR__ = true

  const BRAND = '#0ea5e9'
  const Z = 2147483646
  const MODES = { run: 'run', select: 'select', adjust: 'adjust' }

  /** @type {{
   *   mode: string,
   *   selected: undefined | { el: Element, values: object, original: object, editing: boolean },
   *   hovered: undefined | Element,
   *   overlay: undefined | object,
   *   drag: undefined | object,
   *   values: object,
   *   lastEmit: number,
   * }} */
  const state = {
    mode: MODES.run,
    selected: undefined,
    selections: [],
    hovered: undefined,
    overlay: undefined,
    drag: undefined,
    values: resetValues(),
    lastEmit: 0,
  }

  function resetValues() {
    return {
      x: 0,
      y: 0,
      width: undefined,
      height: undefined,
      rotation: 0,
      fontSize: undefined,
      text: undefined,
      color: undefined,
      backgroundColor: undefined,
    }
  }

  /** Stack of states before each adjustment, most recent last. */
  const history = []
  const MAX_HISTORY = 80
  /** Pristine inline state captured before the first restore of an element. */
  const restoredOriginals = new WeakMap()

  function captureOriginal(el) {
    return {
      transform: el.style.transform,
      width: el.style.width,
      height: el.style.height,
      color: el.style.color,
      backgroundColor: el.style.backgroundColor,
      fontSize: el.style.fontSize,
      textContent: el.textContent,
    }
  }

  function remember(el, textOverride) {
    if (!el) return
    history.push({
      el,
      values: { ...state.values },
      text: textOverride === undefined ? el.textContent ?? '' : textOverride,
    })
    if (history.length > MAX_HISTORY) history.shift()
  }

  function undo() {
    while (history.length > 0) {
      const item = history.pop()
      const el = item.el
      if (!el || !el.isConnected) continue
      if (state.selected?.el !== el) {
        state.selected = { el, original: captureOriginal(el), values: { ...item.values } }
        state.values = state.selected.values
        state.selected.path = domPath(el)
        state.selections = [{ el, path: state.selected.path }]
      } else {
        state.values = { ...item.values }
        state.selected.values = state.values
      }
      if (item.values.text === undefined && el.childElementCount === 0) {
        el.textContent = item.text
        state.selected.labelEl = undefined
      }
      applyValues()
      emitSelection()
      emit('ps:change', { final: true })
      return
    }
    post({ type: 'ps:error', message: '没有可撤回的调整了' })
  }

  function post(message) {
    try {
      window.parent.postMessage({ __previewStudio: 1, ...message }, '*')
    } catch {
      // Parent may be gone.
    }
  }

  function isOurs(node) {
    return node instanceof Element && node.closest('[data-preview-studio-ui]') !== null
  }

  function targetOf(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : []
    const first = path.find((node) => node instanceof Element)
    return first ?? (event.target instanceof Element ? event.target : undefined)
  }

  function round(value) {
    return Math.round(value * 10) / 10
  }

  function rectOf(el) {
    const rect = el.getBoundingClientRect()
    return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) }
  }

  function domPath(el) {
    const segments = []
    let node = el
    while (node && node.nodeType === 1 && segments.length < 14) {
      if (node === document.body || node === document.documentElement) {
        segments.unshift(node === document.body ? 'body' : 'html')
        break
      }
      const tag = node.tagName.toLowerCase()
      let index = 1
      let sibling = node.previousElementSibling
      while (sibling) {
        if (sibling.tagName === node.tagName) index++
        sibling = sibling.previousElementSibling
      }
      segments.unshift(`${tag}:nth-of-type(${index})`)
      node = node.parentElement
    }
    return segments.join('>')
  }

  function textOf(el) {
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
    return text.length > 160 ? text.slice(0, 157) + '…' : text
  }

  function attrsOf(el) {
    const attrs = {}
    for (const attr of Array.from(el.attributes)) {
      if (!/^(id|name|type|role|href|src|alt|placeholder|title|value|aria-[\w-]+|data-[\w-]+)$/i.test(attr.name)) continue
      attrs[attr.name] = String(attr.value).slice(0, 200)
    }
    return attrs
  }

  function describe(el) {
    const style = window.getComputedStyle(el)
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classes: Array.from(el.classList).slice(0, 8),
      text: textOf(el) || undefined,
      attrs: attrsOf(el),
      path: domPath(el),
      rect: rectOf(el),
      styles: {
        color: style.color,
        backgroundColor: style.backgroundColor,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        transform: style.transform,
      },
      editableText: el.childElementCount === 0,
      url: location.href,
    }
  }

  function metrics() {
    const selected = state.selected
    if (!selected) return undefined
    const el = selected.el
    const rect = rectOf(el)
    const style = window.getComputedStyle(el)
    return {
      rect,
      values: { ...state.values },
      text: textOf(el).slice(0, 160),
      editableText: el.childElementCount === 0,
      color: style.color,
      backgroundColor: style.backgroundColor,
      fontSize: Math.round(Number.parseFloat(style.fontSize) || 0),
    }
  }

  function emit(type, extra) {
    if (!state.selected) return
    post({
      type,
      selection: describe(state.selected.el),
      values: { ...state.values },
      metrics: metrics(),
      ...extra,
    })
  }

  function emitChange() {
    const now = Date.now()
    if (now - state.lastEmit < 80) return
    state.lastEmit = now
    emit('ps:change')
  }

  /* ------------------------------------------------------------------ */
  /* Overlay                                                             */
  /* ------------------------------------------------------------------ */

  function makeOverlay() {
    const root = document.createElement('div')
    root.setAttribute('data-preview-studio-ui', 'root')
    root.style.cssText = [
      'position:fixed', 'inset:0', 'pointer-events:none', `z-index:${Z}`,
      'contain:layout style', 'overflow:visible',
    ].join(';')

    const hover = document.createElement('div')
    hover.setAttribute('data-preview-studio-ui', 'hover')
    hover.style.cssText = [
      'position:fixed', 'display:none', 'pointer-events:none',
      `border:1px dashed ${BRAND}`, 'background:rgba(14,165,233,0.10)',
      'border-radius:2px', 'box-sizing:border-box', 'transition:opacity .08s linear',
    ].join(';')

    const box = document.createElement('div')
    box.setAttribute('data-preview-studio-ui', 'box')
    box.style.cssText = [
      'position:fixed', 'display:none', 'pointer-events:none',
      `border:2px solid ${BRAND}`, 'border-radius:3px', 'box-sizing:border-box',
      'box-shadow:0 0 0 1px rgba(255,255,255,.55) inset',
    ].join(';')

    const label = document.createElement('div')
    label.setAttribute('data-preview-studio-ui', 'label')
    label.style.cssText = [
      'position:fixed', 'font:11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace',
      'background:#0f172a', 'color:#f8fafc', 'padding:1px 6px', 'border-radius:4px',
      'white-space:nowrap', 'max-width:70vw', 'overflow:hidden', 'text-overflow:ellipsis',
      'pointer-events:none', 'box-shadow:0 2px 8px rgba(15,23,42,.28)',
    ].join(';')

    const badge = document.createElement('div')
    badge.setAttribute('data-preview-studio-ui', 'badge')
    badge.style.cssText = [
      'position:fixed', 'left:12px', 'bottom:12px', 'display:none',
      'font:12px/1.5 ui-sans-serif,system-ui,"Microsoft YaHei",sans-serif',
      'background:rgba(15,23,42,.92)', 'color:#f8fafc', 'padding:5px 10px',
      'border-radius:999px', 'pointer-events:none', 'box-shadow:0 4px 14px rgba(15,23,42,.35)',
      'letter-spacing:.2px',
    ].join(';')

    const handles = []
    const directions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
    for (const direction of directions) {
      const handle = document.createElement('div')
      handle.setAttribute('data-preview-studio-ui', `handle-${direction}`)
      handle.dataset.psHandle = direction
      handle.style.cssText = [
        'position:fixed', 'display:none', 'width:9px', 'height:9px',
        'margin:-5px 0 0 -5px', `background:${BRAND}`, 'border:1px solid #fff',
        'border-radius:2px', 'pointer-events:auto', 'box-sizing:border-box',
        `cursor:${direction === 'n' || direction === 's' ? 'ns-resize' : direction === 'e' || direction === 'w' ? 'ew-resize' : direction.includes('n') ? (direction === 'nw' ? 'nwse-resize' : 'nesw-resize') : (direction === 'sw' ? 'nesw-resize' : 'nwse-resize')}`,
      ].join(';')
      handle.addEventListener('mousedown', onHandleDown, true)
      root.appendChild(handle)
      handles.push(handle)
    }

    // Wider invisible strips along each edge make "grab the border to resize"
    // work without hunting for the small dots.
    const zones = []
    for (const direction of ['n', 'e', 's', 'w']) {
      const zone = document.createElement('div')
      zone.setAttribute('data-preview-studio-ui', `zone-${direction}`)
      zone.dataset.psHandle = direction
      zone.style.cssText = [
        'position:fixed', 'display:none', 'pointer-events:auto', 'background:transparent',
        'box-sizing:border-box',
        `cursor:${direction === 'n' || direction === 's' ? 'ns-resize' : 'ew-resize'}`,
      ].join(';')
      zone.addEventListener('mousedown', onHandleDown, true)
      root.appendChild(zone)
      zones.push(zone)
    }

    const rotate = document.createElement('div')
    rotate.setAttribute('data-preview-studio-ui', 'rotate')
    rotate.style.cssText = [
      'position:fixed', 'display:none', 'width:12px', 'height:12px', 'margin:-22px 0 0 -6px',
      `background:${BRAND}`, 'border:1px solid #fff', 'border-radius:50%',
      'pointer-events:auto', 'cursor:grab', 'box-sizing:border-box',
    ].join(';')
    rotate.addEventListener('mousedown', onRotateDown, true)

    const rotateStem = document.createElement('div')
    rotateStem.setAttribute('data-preview-studio-ui', 'rotate-stem')
    rotateStem.style.cssText = [
      'position:fixed', 'display:none', 'width:2px', 'height:16px', 'margin:0 0 0 -1px',
      `background:${BRAND}`, 'pointer-events:none', 'opacity:.85',
    ].join(';')

    root.append(hover, box, label, rotateStem, rotate, badge)
    return { root, hover, box, label, badge, handles, zones, rotate, rotateStem, extras: [] }
  }

  function ensureExtraBoxes(overlay, count) {
    while (overlay.extras.length < count) {
      const extra = document.createElement('div')
      extra.setAttribute('data-preview-studio-ui', 'extra')
      extra.style.cssText = [
        'position:fixed', 'display:none', 'pointer-events:none',
        `border:1.5px solid ${BRAND}`, 'background:rgba(14,165,233,0.07)',
        'border-radius:3px', 'box-sizing:border-box', 'opacity:.9',
      ].join(';')
      overlay.root.insertBefore(extra, overlay.label)
      overlay.extras.push(extra)
    }
  }

  function hidePrimaryOverlay(overlay) {
    overlay.box.style.display = 'none'
    overlay.label.style.display = 'none'
    for (const handle of overlay.handles) handle.style.display = 'none'
    for (const zone of overlay.zones ?? []) zone.style.display = 'none'
    overlay.rotate.style.display = 'none'
    overlay.rotateStem.style.display = 'none'
  }

  function ensureOverlay() {
    if (state.overlay && state.overlay.root.isConnected) return state.overlay
    const overlay = makeOverlay()
    document.documentElement.appendChild(overlay.root)
    state.overlay = overlay
    return overlay
  }

  function positionOverlay() {
    const overlay = state.overlay
    if (!overlay) return

    // The app may re-render its DOM; re-resolve every selected element by path
    // and keep the preview-only adjustments on the replacement node.
    for (const entry of state.selections) {
      if (entry.el.isConnected || !entry.path) continue
      let replacement = null
      try {
        replacement = document.querySelector(entry.path)
      } catch {
        replacement = null
      }
      if (!replacement) continue
      entry.el = replacement
      if (state.selected?.path === entry.path) {
        state.selected.el = replacement
        state.selected.labelEl = undefined
        applyValues()
      }
    }

    const selected = state.selected
    if (selected && !selected.el.isConnected && selected.path) {
      let replacement = null
      try {
        replacement = document.querySelector(selected.path)
      } catch {
        replacement = null
      }
      if (replacement) {
        selected.el = replacement
        selected.labelEl = undefined
        applyValues()
      }
    }

    const primary = selected && selected.el.isConnected ? selected : undefined
    if (!primary) {
      hidePrimaryOverlay(overlay)
    } else {
      const accent = state.mode === MODES.adjust ? '#f59e0b' : BRAND
      overlay.box.style.borderColor = accent
      overlay.label.style.background = state.mode === MODES.adjust ? '#7c2d12' : '#0f172a'
      for (const handle of overlay.handles) handle.style.background = accent
      overlay.rotate.style.background = accent
      overlay.rotateStem.style.background = accent

      const rect = primary.el.getBoundingClientRect()
      overlay.box.style.display = 'block'
      overlay.box.style.left = `${rect.left}px`
      overlay.box.style.top = `${rect.top}px`
      overlay.box.style.width = `${rect.width}px`
      overlay.box.style.height = `${rect.height}px`

      if (primary.labelEl !== primary.el) {
        const tag = primary.el.tagName.toLowerCase()
        const id = primary.el.id ? `#${primary.el.id}` : ''
        const text = (primary.el.innerText || primary.el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 36)
        overlay.label.textContent = `${state.mode === MODES.adjust ? '调整 · ' : ''}${tag}${id}${text ? ` “${text}”` : ''}`
        primary.labelEl = primary.el
      }
      overlay.label.style.display = 'block'
      const labelLeft = Math.max(6, Math.min(rect.left, window.innerWidth - 220))
      const labelTop = rect.top > 24 ? rect.top - 20 : Math.min(rect.bottom + 4, window.innerHeight - 22)
      overlay.label.style.left = `${labelLeft}px`
      overlay.label.style.top = `${labelTop}px`

      const showHandles = state.mode === MODES.adjust
      const points = {
        nw: [rect.left, rect.top],
        n: [rect.left + rect.width / 2, rect.top],
        ne: [rect.left + rect.width, rect.top],
        e: [rect.left + rect.width, rect.top + rect.height / 2],
        se: [rect.left + rect.width, rect.top + rect.height],
        s: [rect.left + rect.width / 2, rect.top + rect.height],
        sw: [rect.left, rect.top + rect.height],
        w: [rect.left, rect.top + rect.height / 2],
      }
      for (const handle of overlay.handles) {
        const direction = handle.dataset.psHandle
        const point = points[direction]
        handle.style.display = showHandles ? 'block' : 'none'
        handle.style.left = `${point[0]}px`
        handle.style.top = `${point[1]}px`
      }
      const zoneRects = {
        n: [rect.left + 6, rect.top - 6, Math.max(0, rect.width - 12), 12],
        s: [rect.left + 6, rect.top + rect.height - 6, Math.max(0, rect.width - 12), 12],
        w: [rect.left - 6, rect.top + 6, 12, Math.max(0, rect.height - 12)],
        e: [rect.left + rect.width - 6, rect.top + 6, 12, Math.max(0, rect.height - 12)],
      }
      for (const zone of overlay.zones ?? []) {
        const zoneRect = zoneRects[zone.dataset.psHandle]
        const visible = showHandles && zoneRect !== undefined && zoneRect[2] > 0 && zoneRect[3] > 0
        zone.style.display = visible ? 'block' : 'none'
        if (!visible) continue
        zone.style.left = `${zoneRect[0]}px`
        zone.style.top = `${zoneRect[1]}px`
        zone.style.width = `${zoneRect[2]}px`
        zone.style.height = `${zoneRect[3]}px`
      }
      overlay.rotate.style.display = showHandles ? 'block' : 'none'
      overlay.rotate.style.left = `${rect.left + rect.width / 2}px`
      overlay.rotate.style.top = `${rect.top}px`
      overlay.rotateStem.style.display = showHandles ? 'block' : 'none'
      overlay.rotateStem.style.left = `${rect.left + rect.width / 2}px`
      overlay.rotateStem.style.top = `${rect.top - 18}px`
    }

    const others = state.selections.filter((entry) => entry.el.isConnected && entry.path !== primary?.path)
    ensureExtraBoxes(overlay, others.length)
    for (const [index, entry] of others.entries()) {
      const box = overlay.extras[index]
      const rect = entry.el.getBoundingClientRect()
      box.style.display = 'block'
      box.style.left = `${rect.left}px`
      box.style.top = `${rect.top}px`
      box.style.width = `${rect.width}px`
      box.style.height = `${rect.height}px`
    }
    for (let index = others.length; index < overlay.extras.length; index++) {
      overlay.extras[index].style.display = 'none'
    }
  }

  let ticking = false

  function ensureTick() {
    if (ticking) return
    ticking = true
    requestAnimationFrame(tick)
  }

  function tick() {
    if (state.mode === MODES.run) {
      ticking = false
      return
    }
    ensureOverlay()
    const overlay = state.overlay
    if (overlay) {
      overlay.badge.style.display = 'block'
      overlay.badge.textContent = state.mode === MODES.select
        ? '选择模式：点击加入选择 · 再点取消 · Esc 清空'
        : '调整模式：拖动移动 · 角点缩放 · 顶部圆点旋转 · 双击改文字'
      const hover = overlay.hover
      if (state.mode === MODES.select && state.hovered && state.hovered.isConnected && state.hovered !== state.selected?.el) {
        const rect = state.hovered.getBoundingClientRect()
        hover.style.display = 'block'
        hover.style.left = `${rect.left}px`
        hover.style.top = `${rect.top}px`
        hover.style.width = `${rect.width}px`
        hover.style.height = `${rect.height}px`
      } else {
        hover.style.display = 'none'
      }
    }
    positionOverlay()
    requestAnimationFrame(tick)
  }

  /* ------------------------------------------------------------------ */
  /* Values, apply, restore                                              */
  /* ------------------------------------------------------------------ */

  function applyValuesTo(el, values, original) {
    const parts = []
    if (original.transform) parts.push(original.transform)
    if (values.x || values.y) parts.push(`translate(${values.x}px, ${values.y}px)`)
    if (values.rotation) parts.push(`rotate(${values.rotation}deg)`)
    el.style.transform = parts.join(' ')
    if (values.width !== undefined) {
      el.style.width = `${values.width}px`
      el.style.boxSizing = 'border-box'
    } else {
      el.style.width = original.width
    }
    if (values.height !== undefined) {
      el.style.height = `${values.height}px`
      el.style.boxSizing = 'border-box'
    } else {
      el.style.height = original.height
    }
    if (values.color !== undefined) el.style.color = values.color
    else el.style.color = original.color
    if (values.backgroundColor !== undefined) el.style.backgroundColor = values.backgroundColor
    else el.style.backgroundColor = original.backgroundColor
    if (values.fontSize !== undefined) el.style.fontSize = `${values.fontSize}px`
    else el.style.fontSize = original.fontSize
    if (values.text !== undefined && el.childElementCount === 0) {
      el.textContent = values.text
    }
  }

  function applyValues() {
    const selected = state.selected
    if (!selected) return
    applyValuesTo(selected.el, state.values, selected.original)
    selected.labelEl = undefined
    positionOverlay()
  }

  /**
   * Re-apply adjustments reported by the panel after the iframe reloaded, so
   * collapsing/expanding or a page reload does not drop the in-page preview.
   * @param {Array<{ selection: object, values: object }>} changes
   */
  function restoreChanges(changes) {
    if (!Array.isArray(changes)) return
    for (const change of changes) {
      const path = change?.selection?.path
      if (typeof path !== 'string' || path.length === 0) continue
      let el = null
      try {
        el = document.querySelector(path)
      } catch {
        el = null
      }
      if (!el) continue
      let original = restoredOriginals.get(el)
      if (!original) {
        original = captureOriginal(el)
        restoredOriginals.set(el, original)
      }
      applyValuesTo(el, change.values ?? {}, original)
    }
  }

  function selectElement(el) {
    if (!el) return
    if (state.selected?.el === el) return
    state.selected = {
      el,
      path: domPath(el),
      original: captureOriginal(el),
      values: resetValues(),
    }
    state.values = state.selected.values
    positionOverlay()
  }

  /**
   * Selection mode keeps every clicked element selected. The most recent one
   * is the primary element used by adjust mode.
   * @param {Element} el
   */
  function addToSelection(el) {
    const path = domPath(el)
    if (!state.selections.some((entry) => entry.path === path)) {
      state.selections.push({ el, path })
    }
    selectElement(el)
    emitSelection()
    positionOverlay()
  }

  /**
   * Remove one element from the selection set, promoting the last remaining
   * element to primary.
   * @param {string} path
   */
  function removeFromSelection(path) {
    state.selections = state.selections.filter((entry) => entry.path !== path)
    if (state.selected?.path === path) {
      const last = state.selections[state.selections.length - 1]
      if (last) {
        state.selected = {
          el: last.el,
          path: last.path,
          original: captureOriginal(last.el),
          values: resetValues(),
        }
        state.values = state.selected.values
      } else {
        state.selected = undefined
        state.values = resetValues()
      }
    }
    emitSelection()
    positionOverlay()
  }

  /** Report the whole selection set to the panel. */
  function emitSelection() {
    const visible = state.selections.filter((entry) => entry.el.isConnected)
    post({
      type: 'ps:select',
      selections: visible.map((entry) => describe(entry.el)),
      primaryPath: state.selected?.el.isConnected ? state.selected.path : visible[visible.length - 1]?.path ?? null,
      metrics: metrics(),
    })
  }

  function clearSelection(notify) {
    state.selected = undefined
    state.selections = []
    state.values = resetValues()
    if (state.overlay) {
      state.overlay.box.style.display = 'none'
      state.overlay.label.style.display = 'none'
      state.overlay.hover.style.display = 'none'
      for (const handle of state.overlay.handles) handle.style.display = 'none'
      for (const zone of state.overlay.zones ?? []) zone.style.display = 'none'
      for (const extra of state.overlay.extras) extra.style.display = 'none'
      state.overlay.rotate.style.display = 'none'
      state.overlay.rotateStem.style.display = 'none'
    }
    if (notify) post({ type: 'ps:clear' })
  }

  /* ------------------------------------------------------------------ */
  /* Interaction                                                         */
  /* ------------------------------------------------------------------ */

  function finishDrag() {
    const drag = state.drag
    state.drag = undefined
    if (drag) post({ type: 'ps:gesture', active: false })
    if (drag?.moved && state.selected) emit('ps:change', { final: true })
  }

  /**
   * Apply one pointer position to the active gesture. Coordinates are in the
   * preview document's CSS pixels; the panel forwards them while the pointer
   * is outside the iframe, which is what makes dragging past the phone screen
   * edge continue instead of stopping.
   * @param {number} clientX
   * @param {number} clientY
   */
  function applyDrag(clientX, clientY) {
    if (!state.drag) return
    const dx = clientX - state.drag.startX
    const dy = clientY - state.drag.startY
    if (!state.drag.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 4) return
      state.drag.moved = true
      remember(state.selected.el)
    }
    if (state.drag.kind === 'move') {
      state.values.x = Math.round(state.drag.startValues.x + dx)
      state.values.y = Math.round(state.drag.startValues.y + dy)
    } else if (state.drag.kind === 'resize') {
      const direction = state.drag.direction
      let width = state.drag.startRect.width
      let height = state.drag.startRect.height
      let x = state.drag.startValues.x
      let y = state.drag.startValues.y
      if (direction.includes('e')) width += dx
      if (direction.includes('s')) height += dy
      if (direction.includes('w')) {
        width -= dx
        x += dx
      }
      if (direction.includes('n')) {
        height -= dy
        y += dy
      }
      state.values.width = Math.max(8, Math.round(width))
      state.values.height = Math.max(8, Math.round(height))
      state.values.x = Math.round(x)
      state.values.y = Math.round(y)
    } else if (state.drag.kind === 'rotate') {
      const rect = state.selected.el.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const angle = Math.atan2(clientY - centerY, clientX - centerX) * 180 / Math.PI
      state.values.rotation = Math.round(state.drag.startValues.rotation + (angle - state.drag.startAngle))
    }
    applyValues()
    emitChange()
  }

  function onMove(event) {
    if (state.mode === MODES.run) return
    // A lost mouseup (released over the panel or outside the frame) must not
    // leave a drag armed: any buttonless move ends the gesture.
    if (state.drag && event.buttons === 0) {
      finishDrag()
      return
    }
    // An active gesture owns the pointer. Resize handles follow the cursor, so
    // the element under the pointer is often our own overlay; filter the hover
    // target only when no gesture is running.
    if (state.drag) {
      event.preventDefault()
      applyDrag(event.clientX, event.clientY)
      return
    }
    const target = targetOf(event)
    if (!target || isOurs(target)) return
    if (state.mode === MODES.select) state.hovered = target
  }

  function onDown(event) {
    if (state.mode !== MODES.adjust) return
    if (event.button !== 0) return
    const target = targetOf(event)
    if (!target || isOurs(target)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (target !== state.selected?.el) {
      state.selections = [{ el: target, path: domPath(target) }]
      selectElement(target)
      emitSelection()
    }
    state.drag = {
      kind: 'move',
      startX: event.clientX,
      startY: event.clientY,
      startValues: { ...state.values },
    }
    post({ type: 'ps:gesture', active: true })
  }

  function onHandleDown(event) {
    if (state.mode !== MODES.adjust || !state.selected) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const direction = event.currentTarget.dataset.psHandle
    const rect = state.selected.el.getBoundingClientRect()
    state.drag = {
      kind: 'resize',
      direction,
      startX: event.clientX,
      startY: event.clientY,
      startRect: { width: rect.width, height: rect.height },
      startValues: { ...state.values },
    }
    post({ type: 'ps:gesture', active: true })
  }

  function onRotateDown(event) {
    if (state.mode !== MODES.adjust || !state.selected) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const rect = state.selected.el.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    state.drag = {
      kind: 'rotate',
      startAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI,
      startValues: { ...state.values },
    }
    post({ type: 'ps:gesture', active: true })
  }

  function onUp() {
    finishDrag()
  }

  function onClick(event) {
    if (state.mode === MODES.run) return
    const target = targetOf(event)
    if (!target || isOurs(target)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (state.mode === MODES.select) {
      const path = domPath(target)
      if (state.selections.some((entry) => entry.path === path)) {
        removeFromSelection(path)
        if (state.selections.length === 0) {
          state.hovered = undefined
        } else {
          state.hovered = target
        }
      } else {
        addToSelection(target)
        state.hovered = target
      }
    }
  }

  function onDoubleClick(event) {
    if (state.mode !== MODES.adjust || !state.selected) return
    const target = targetOf(event)
    if (!target || target !== state.selected.el) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const el = state.selected.el
    if (el.childElementCount > 0) {
      post({ type: 'ps:error', message: '该元素包含子元素，请在右侧属性面板中修改文字。' })
      return
    }
    if (state.selected.editing) return
    state.selected.editing = true
    const previous = el.textContent ?? ''
    remember(el, previous)
    el.setAttribute('contenteditable', 'plaintext-only')
    el.style.outline = `2px dashed ${BRAND}`
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const finish = (commit) => {
      el.removeEventListener('blur', onBlur)
      el.removeEventListener('keydown', onKey)
      el.removeAttribute('contenteditable')
      el.style.outline = ''
      state.selected.editing = false
      const next = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (commit && next !== previous) {
        state.values.text = next
        emit('ps:change', { final: true })
      } else {
        el.textContent = previous
      }
      el.blur()
    }
    const onBlur = () => finish(true)
    const onKey = (keyboardEvent) => {
      if (keyboardEvent.key === 'Escape') {
        keyboardEvent.preventDefault()
        finish(false)
      } else if (keyboardEvent.key === 'Enter' && !keyboardEvent.shiftKey) {
        keyboardEvent.preventDefault()
        finish(true)
      }
    }
    el.addEventListener('blur', onBlur)
    el.addEventListener('keydown', onKey)
  }

  function onKeyDown(event) {
    if (state.mode === MODES.run) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !state.selected?.editing) {
      event.preventDefault()
      undo()
      return
    }
    if (event.key === 'Escape') {
      if (state.selected?.editing) return
      clearSelection(true)
      return
    }
    if (state.mode !== MODES.adjust || !state.selected) return
    const step = event.shiftKey ? 10 : 1
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const delta = map[event.key]
    if (!delta) return
    if (event.target instanceof Element && event.target.isContentEditable) return
    event.preventDefault()
    remember(state.selected.el)
    state.values.x += delta[0]
    state.values.y += delta[1]
    applyValues()
    emit('ps:change', { final: true })
  }

  function setMode(mode) {
    if (!MODES[mode]) return
    state.mode = mode
    state.hovered = undefined
    if (state.selected) state.selected.labelEl = undefined
    const html = document.documentElement
    html.style.cursor = mode === MODES.select ? 'crosshair' : ''
    if (document.body) document.body.style.userSelect = mode === MODES.adjust ? 'none' : ''
    if (state.overlay) {
      state.overlay.badge.style.display = mode === MODES.run ? 'none' : 'block'
      state.overlay.hover.style.display = 'none'
    }
    if (mode === MODES.run) clearSelection(false)
    if (mode !== MODES.adjust) {
      for (const handle of state.overlay?.handles ?? []) handle.style.display = 'none'
      for (const zone of state.overlay?.zones ?? []) zone.style.display = 'none'
      if (state.overlay) {
        state.overlay.rotate.style.display = 'none'
        state.overlay.rotateStem.style.display = 'none'
      }
    }
    ensureOverlay()
    positionOverlay()
    if (state.overlay) state.overlay.badge.style.display = mode === MODES.run ? 'none' : 'block'
    ensureTick()
  }

  function applyFromPanel(prop, value) {
    if (!state.selected) return
    remember(state.selected.el)
    const values = state.values
    switch (prop) {
      case 'x':
      case 'y':
      case 'rotation':
        if (value === null || value === '') values[prop] = 0
        else if (Number.isFinite(Number(value))) values[prop] = Number(value)
        break
      case 'width':
      case 'height':
        if (value === null || value === '') values[prop] = undefined
        else if (Number.isFinite(Number(value))) values[prop] = Math.max(1, Number(value))
        break
      case 'fontSize':
        if (value === null || value === '') values.fontSize = undefined
        else if (Number.isFinite(Number(value))) values.fontSize = Math.max(6, Math.min(240, Number(value)))
        break
      case 'text':
        if (state.selected.el.childElementCount === 0) {
          values.text = value === null ? undefined : String(value)
        }
        break
      case 'color':
      case 'backgroundColor':
        values[prop] = value === null || value === '' ? undefined : String(value)
        break
      default:
        return
    }
    applyValues()
    emit('ps:change', { final: true })
  }

  window.addEventListener('message', (event) => {
    const data = event.data
    if (!data || data.__previewStudio !== 1) return
    if (data.type === 'ps:mode') setMode(data.mode)
    else if (data.type === 'ps:apply') applyFromPanel(data.prop, data.value)
    else if (data.type === 'ps:restore') restoreChanges(data.changes)
    else if (data.type === 'ps:drag-point') {
      if (Number.isFinite(Number(data.x)) && Number.isFinite(Number(data.y))) {
        applyDrag(Number(data.x), Number(data.y))
      }
    } else if (data.type === 'ps:gesture-end') finishDrag()
    else if (data.type === 'ps:undo') undo()
    else if (data.type === 'ps:clear') clearSelection(false)
  })

  document.addEventListener('mousemove', onMove, true)
  document.addEventListener('mousedown', onDown, true)
  document.addEventListener('mouseup', onUp, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('dblclick', onDoubleClick, true)
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('dragstart', (event) => {
    if (state.mode === MODES.adjust) event.preventDefault()
  }, true)
  window.addEventListener('mouseup', onUp, true)
  window.addEventListener('blur', onUp)

  let readySent = 0
  function announceReady() {
    if (readySent >= 3) return
    readySent++
    post({ type: 'ps:ready', url: location.href, title: document.title })
  }
  announceReady()
  window.addEventListener('load', announceReady)
  setTimeout(announceReady, 400)
  setTimeout(announceReady, 1500)

  const observer = new MutationObserver(() => {
    if (state.overlay && !state.overlay.root.isConnected) {
      document.documentElement.appendChild(state.overlay.root)
    }
  })
  observer.observe(document.documentElement, { childList: true })

  ensureTick()
})()
