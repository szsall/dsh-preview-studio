/**
 * Preview Studio — floating live preview panel.
 *
 * Renders in the frame-wide `shell.overlay` layer. The panel embeds the
 * preview origin in an iframe, switches between run / select / adjust modes,
 * forwards selections and adjustments to the Host, and shows the
 * user-confirmation gate before packaging.
 */
window.__ModuleLoader__.load({
  id: '@local/preview-studio',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'preview-studio'
    const STORE_KEY = 'preview-studio:panel:v1'

    const en = {
      'panel.aria': 'Live app preview',
      'panel.collapse': 'Collapse preview',
      'panel.expand': 'Expand preview',
      'panel.close': 'Close preview',
      'panel.refresh': 'Reload preview',
      'panel.title': 'Live preview',
      'mode.run': 'Run',
      'mode.select': 'Select',
      'mode.adjust': 'Adjust',
      'mode.run.hint': 'Run mode: use the app as a user would.',
      'mode.select.hint': 'Select mode: click to add elements, click again to remove, Esc clears.',
      'mode.adjust.hint': 'Adjust mode: drag to move, handles to resize, top dot to rotate.',
      'target.exe': 'EXE',
      'target.apk': 'APK',
      'view.desktop': 'Desktop window',
      'view.phone': 'Phone',
      'zoom.out': 'Zoom out',
      'zoom.in': 'Zoom in',
      'zoom.reset': 'Reset zoom to 100%',
      'empty.waiting': 'Waiting for the app to load…',
      'empty.noInspector': 'The preview loaded but its inspector did not answer. Run mode still works.',
      'selection.none': 'Nothing selected yet.',
      'selection.selected': 'Selected',
      'selection.multi': '{count} elements selected · primary',
      'selection.clear': 'Clear',
      'adjust.title': 'Element properties',
      'adjust.x': 'X',
      'adjust.y': 'Y',
      'adjust.w': 'W',
      'adjust.h': 'H',
      'adjust.rotate': 'Rotate',
      'adjust.fontSize': 'Font size',
      'adjust.undo': 'Undo',
      'adjust.undoHint': 'Undo the last adjustment (Ctrl+Z)',
      'adjust.text': 'Text',
      'adjust.color': 'Text color',
      'adjust.background': 'Background',
      'adjust.auto': 'auto',
      'sync.idle': 'Adjustments stay local until you move on',
      'sync.syncing': 'Sending adjustments to the model…',
      'sync.synced': 'Adjustments sent to the model',
      'sync.error': 'Could not send adjustments',
      'changes.pending': '{count} adjustment(s) waiting for the model',
      'confirm.action': 'Confirm build',
      'confirm.confirmed': 'Build confirmed',
      'confirm.confirmedOnce': 'Confirmed for one build. The next build needs confirmation again.',
      'confirm.authorized': 'Build authorized. The confirmation is consumed by the next packaging command.',
      'confirm.revoke': 'Revoke',
      'confirm.blocked': 'Apply the pending adjustments first',
      'confirm.pendingChanges': '{count} adjustment(s) are not written into the project files yet. Apply them first.',
      'confirm.sent': 'Confirmed. The model continues with packaging.',
      'confirm.note': 'Confirm each build',
      'confirm.noteLong': 'Each build needs its own confirmation; packaging is blocked until you confirm here.',
      'skip.label': 'No confirm',
      'skip.on': 'On',
      'skip.off': 'Off',
      'skip.enableHint': 'Skip per-build confirmation. Off by default.',
      'skip.disableHint': 'Turn off no-confirm mode and require confirmation for every build.',
      'skip.note': 'No-confirm mode is on: the model may package directly. Turn it off to restore per-build confirmation.',
      'skip.enabledNotice': 'No-confirm mode enabled.',
      'skip.disabledNotice': 'No-confirm mode disabled. Each build needs confirmation again.',
      'stale.reload': 'Files changed. Reload to see them.',
      'stale.button': 'Reload',
      'foreign.session': 'Preview from another session',
      'built.label': 'Artifact',
      'close.title': 'Close live preview?',
      'close.body': 'The preview server stops; the project files are untouched. To reopen it later, ask the model to open the preview again.',
      'close.cancel': 'Cancel',
      'close.confirm': 'Close',
      'error.generic': 'Preview error',
      'frame.title': 'App under preview',
      'phone.time': '9:41',
    }

    const zh = {
      'panel.aria': '应用实时预览',
      'panel.collapse': '收起实时预览',
      'panel.expand': '展开实时预览',
      'panel.close': '关闭实时预览',
      'panel.refresh': '刷新实时预览',
      'panel.title': '实时预览',
      'mode.run': '运行',
      'mode.select': '选择',
      'mode.adjust': '调整',
      'mode.run.hint': '运行模式：像用户一样试用应用。',
      'mode.select.hint': '选择模式：点击元素加入选择，再点一次取消，可连续多选。',
      'mode.adjust.hint': '调整模式：拖动移动，角点缩放，顶部圆点旋转。',
      'target.exe': 'EXE',
      'target.apk': 'APK',
      'view.desktop': '桌面窗口',
      'view.phone': '手机',
      'zoom.out': '缩小预览',
      'zoom.in': '放大预览',
      'zoom.reset': '恢复到 100%',
      'empty.waiting': '正在等待应用加载…',
      'empty.noInspector': '预览已加载，但检查器没有响应；运行模式仍可使用。',
      'selection.none': '还没有选中任何内容。',
      'selection.selected': '已选中',
      'selection.multi': '已选中 {count} 个元素 · 主选',
      'selection.clear': '清除',
      'adjust.title': '元素属性',
      'adjust.x': 'X',
      'adjust.y': 'Y',
      'adjust.w': '宽',
      'adjust.h': '高',
      'adjust.rotate': '旋转',
      'adjust.fontSize': '字号',
      'adjust.undo': '撤销',
      'adjust.undoHint': '撤回上一次调整（Ctrl+Z）',
      'adjust.text': '文字',
      'adjust.color': '文字颜色',
      'adjust.background': '背景',
      'adjust.auto': '自动',
      'sync.idle': '调整先留在本地，稍后同步给模型',
      'sync.syncing': '正在把调整发送给模型…',
      'sync.synced': '调整已发送给模型',
      'sync.error': '调整发送失败',
      'changes.pending': '{count} 项调整等待模型应用',
      'confirm.action': '确认生成',
      'confirm.confirmed': '已确认生成',
      'confirm.confirmedOnce': '已确认本次生成；下次生成需要重新确认。',
      'confirm.authorized': '本次打包已获准；执行后需重新确认。',
      'confirm.revoke': '撤销确认',
      'confirm.blocked': '请先让模型应用待处理的调整',
      'confirm.pendingChanges': '还有 {count} 项调整没写入项目文件，先应用再确认',
      'confirm.sent': '已确认本次生成，模型将继续打包。',
      'confirm.note': '每次生成单独确认',
      'confirm.noteLong': '每次生成都需要单独确认；点击确认前打包会被阻止。',
      'skip.label': '无需确认',
      'skip.on': '开',
      'skip.off': '关',
      'skip.enableHint': '跳过每次生成前的确认（默认关闭）。',
      'skip.disableHint': '关闭无需确认，恢复每次生成都要确认。',
      'skip.note': '无需确认已开启：可直接让模型打包；关闭后恢复逐次确认。',
      'skip.enabledNotice': '已开启无需确认。',
      'skip.disabledNotice': '已关闭无需确认，之后每次生成都要确认。',
      'stale.reload': '项目文件已更新，刷新即可查看。',
      'stale.button': '刷新',
      'foreign.session': '此预览来自另一个会话',
      'built.label': '产物',
      'close.title': '关闭实时预览？',
      'close.body': '预览服务器会停止，项目文件不会受影响。之后可在对话里让模型重新打开预览。',
      'close.cancel': '取消',
      'close.confirm': '关闭',
      'error.generic': '预览出错',
      'frame.title': '正在预览的应用',
      'phone.time': '9:41',
    }

    const CSS = `
.ps-root{position:fixed;display:flex;flex-direction:column;pointer-events:auto;z-index:40;
  font:13px/1.45 ui-sans-serif,system-ui,"Segoe UI","Microsoft YaHei",sans-serif;
  color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-overlay);
  border:1px solid var(--dsw-alias-border-l1);border-radius:14px;overflow:hidden;
  box-shadow:0 24px 70px rgba(2,6,23,.32),0 2px 8px rgba(2,6,23,.18)}
.ps-root *{box-sizing:border-box}
.ps-header{display:flex;align-items:center;gap:8px;padding:9px 10px 9px 12px;cursor:grab;
  border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);user-select:none}
.ps-header:active{cursor:grabbing}
.ps-mark{width:18px;height:18px;flex:none;border-radius:5px;background:var(--dsw-alias-brand-primary);
  display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700}
.ps-title{font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
.ps-badge{flex:none;font-size:10px;font-weight:700;letter-spacing:.4px;padding:1px 6px;border-radius:999px;
  color:var(--dsw-alias-brand-primary);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.ps-spacer{flex:1}
.ps-icon{width:26px;height:26px;flex:none;display:flex;align-items:center;justify-content:center;border:0;
  border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.ps-icon:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.ps-icon[disabled]{opacity:.4;cursor:default}
.ps-toolbar{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);flex-wrap:wrap}
.ps-seg{display:flex;gap:2px;padding:2px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);flex:none}
.ps-seg button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;
  padding:3px 10px;border-radius:7px;cursor:pointer;white-space:nowrap}
.ps-seg button:hover{color:var(--dsw-alias-label-primary)}
.ps-seg button.ps-on{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-brand-primary);
  font-weight:600;box-shadow:0 1px 3px rgba(2,6,23,.18)}
.ps-seg button[disabled]{opacity:.45;cursor:default}
.ps-ghost{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;
  padding:3px 8px;border-radius:8px;cursor:pointer;white-space:nowrap}
.ps-ghost:hover{color:var(--dsw-alias-label-primary)}
.ps-zoom{display:flex;align-items:center;gap:1px;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;
  background:var(--dsw-alias-bg-layer-2);flex:none}
.ps-zoom-button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1;
  width:20px;height:20px;border-radius:5px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.ps-zoom-button:hover{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}
.ps-zoom-value{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:10px;
  min-width:34px;cursor:pointer;padding:0;white-space:nowrap}
.ps-zoom-value:hover{color:var(--dsw-alias-label-primary)}
.ps-confirmbar{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);
  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);
  font-size:11px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}
.ps-confirmbar-text{min-width:0;flex:1 1 140px;line-height:1.4}
.ps-confirmbar .ps-primary{padding:6px 14px;font-size:12px;flex:none}
.ps-confirmbar.is-ok{background:color-mix(in srgb,#16a34a 16%,transparent);border-bottom-color:#166534}
.ps-confirmbar.is-skip{background:color-mix(in srgb,#16a34a 10%,transparent);border-bottom-color:#166534}
.ps-confirmbar.is-authorized{background:color-mix(in srgb,#16a34a 16%,transparent);border-bottom-color:#166534}
.ps-skip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;
  padding:4px 9px;border-radius:999px;cursor:pointer;flex:none;white-space:nowrap}
.ps-skip:hover{color:var(--dsw-alias-label-primary)}
.ps-skip.is-on{color:#16a34a;border-color:#16a34a;background:color-mix(in srgb,#16a34a 12%,transparent)}
.ps-switch{width:22px;height:12px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l2);position:relative;flex:none;transition:background .15s}
.ps-switch::after{content:'';position:absolute;top:1px;left:1px;width:8px;height:8px;border-radius:50%;
  background:var(--dsw-alias-label-secondary);transition:transform .15s,background .15s}
.ps-skip.is-on .ps-switch{background:#16a34a;border-color:#16a34a}
.ps-skip.is-on .ps-switch::after{transform:translateX(10px);background:#fff}
.ps-primary{display:inline-flex;align-items:center;gap:5px;border:1px solid #1d4ed8;border-radius:8px;padding:5px 11px;
  background:#2563eb;color:#fff;font:inherit;font-size:12px;font-weight:600;cursor:pointer;
  white-space:nowrap}
.ps-primary:hover:not([disabled]){background:#1d4ed8}
.ps-primary[disabled]{opacity:.45;cursor:default}
.ps-primary.is-ok{background:#15803d;border-color:#166534}
.ps-link{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;
  text-decoration:underline;cursor:pointer;padding:0}
.ps-props{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px 8px;padding:8px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.ps-field{display:flex;flex-direction:column;gap:2px;min-width:0}
.ps-field>span{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ps-field input{width:100%;min-width:0;font:inherit;font-size:12px;padding:2px 6px;border-radius:6px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}
.ps-field input[type=color]{padding:0 2px;height:24px}
.ps-field input:disabled{opacity:.45}
.ps-field.ps-wide{grid-column:span 2}
.ps-body{position:relative;flex:1;min-height:0;display:flex;overflow:auto;padding:8px;
  background:var(--dsw-alias-bg-base)}
.ps-canvas{position:relative;margin:auto;flex:none}
.ps-desktop{position:relative;display:flex;flex-direction:column;flex:none;transform-origin:top left;
  border-radius:9px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);box-shadow:0 8px 26px rgba(2,6,23,.22)}
.ps-desktop-bar{display:flex;align-items:center;gap:6px;height:30px;flex:none;padding:0 10px;background:#0f172a;color:#cbd5e1}
.ps-dots{display:flex;gap:5px;margin-right:4px}
.ps-dots i{width:8px;height:8px;border-radius:50%;display:block;background:#ef4444}
.ps-dots i:nth-child(2){background:#f59e0b}
.ps-dots i:nth-child(3){background:#22c55e}
.ps-desktop-title{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.85}
.ps-frame{flex:1;width:100%;height:100%;border:0;display:block;background:#fff}
.ps-phone-wrap{display:none}
.ps-phone-scale{display:none}
.ps-phone{position:absolute;left:0;top:0;transform-origin:top left;width:414px;height:892px;border-radius:38px;
  background:#0b1220;padding:10px;box-shadow:0 18px 40px rgba(2,6,23,.42),0 0 0 1px rgba(148,163,184,.25)}
.ps-phone-screen{width:390px;height:844px;border-radius:30px;overflow:hidden;background:#fff;display:flex;flex-direction:column}
.ps-phone-status{flex:none;height:26px;display:flex;align-items:center;justify-content:space-between;
  padding:0 14px;font-size:11px;font-weight:600;color:#0f172a;background:#fff}
.ps-phone-status span:last-child{letter-spacing:1px}
.ps-phone .ps-frame{flex:1;min-height:0}
.ps-phone-nav{flex:none;height:24px;display:flex;align-items:center;justify-content:center;gap:44px;background:#fff}
.ps-phone-nav i{display:block;background:#94a3b8;border-radius:2px}
.ps-phone-nav i:first-child{width:26px;height:2px}
.ps-phone-nav i:last-child{width:10px;height:10px;border-radius:50%;background:#cbd5e1}
.ps-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;
  padding:20px;color:var(--dsw-alias-label-secondary);font-size:12px;pointer-events:none}
.ps-status{display:flex;align-items:center;gap:8px;padding:6px 10px;border-top:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);font-size:11px;color:var(--dsw-alias-label-secondary);min-height:30px}
.ps-status .ps-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:999px;
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);max-width:65%;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ps-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}
.ps-dot.syncing{background:var(--dsw-alias-brand-primary)}
.ps-dot.synced{background:var(--dsw-alias-state-success-primary)}
.ps-dot.error{background:var(--dsw-alias-state-error-primary)}
.ps-pill{position:fixed;right:auto;bottom:auto;display:flex;align-items:center;gap:9px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border-radius:999px;padding:7px 12px 7px 8px;
  cursor:grab;pointer-events:auto;font:12px/1.4 ui-sans-serif,system-ui,"Microsoft YaHei",sans-serif;
  box-shadow:0 10px 30px rgba(2,6,23,.28);z-index:40;min-height:40px;user-select:none;touch-action:none}
.ps-pill:active{cursor:grabbing}
.ps-pill-text{display:flex;flex-direction:column;line-height:1.15;max-width:170px;text-align:left}
.ps-pill-text strong{font-size:12px;font-weight:600;white-space:nowrap}
.ps-pill-text span{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px}
.ps-pill .ps-count{font-size:10px;font-weight:700;color:#fff;background:var(--dsw-alias-brand-primary);
  border-radius:999px;min-width:16px;height:16px;padding:0 4px;display:inline-flex;align-items:center;justify-content:center}
.ps-grip{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;pointer-events:auto;
  background:linear-gradient(135deg,transparent 50%,var(--dsw-alias-border-l2) 50%,var(--dsw-alias-border-l2) 62%,transparent 62%);
  border-bottom-right-radius:12px}
.ps-modal{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(2,6,23,.42);
  z-index:5;padding:16px}
.ps-card{background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;
  padding:14px 16px;max-width:320px;box-shadow:0 16px 40px rgba(2,6,23,.3)}
.ps-card h4{margin:0 0 6px;font-size:13px}
.ps-card p{margin:0 0 12px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.ps-card-actions{display:flex;justify-content:flex-end;gap:8px}
.ps-banner{display:flex;align-items:center;gap:8px;padding:5px 10px;font-size:11px;
  background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);
  color:var(--dsw-alias-label-primary);border-bottom:1px solid var(--dsw-alias-border-l1)}
.ps-toast{position:absolute;left:50%;bottom:44px;transform:translateX(-50%);background:#0f172a;color:#f8fafc;
  font-size:11px;padding:5px 10px;border-radius:8px;box-shadow:0 8px 24px rgba(2,6,23,.35);z-index:6;max-width:85%;
  text-align:center;pointer-events:none}
`

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value))
    }

    function readStore() {
      try {
        const parsed = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    function writeStore(patch) {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ ...readStore(), ...patch }))
      } catch {
        // Storage can be unavailable; bounds simply stay per-mount.
      }
    }

    function hexOf(color) {
      if (typeof color !== 'string') return '#000000'
      const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
      if (!match) {
        if (/^#[0-9a-f]{6}$/i.test(color)) return color
        if (/^#[0-9a-f]{3}$/i.test(color)) return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
        return '#000000'
      }
      const part = (value) => Number(value).toString(16).padStart(2, '0')
      return `#${part(match[1])}${part(match[2])}${part(match[3])}`
    }

    function elementSummary(selection) {
      if (!selection) return ''
      const tag = selection.tag ?? 'element'
      const id = selection.id ? `#${selection.id}` : ''
      const text = selection.text ? ` “${String(selection.text).slice(0, 24)}”` : ''
      return `${tag}${id}${text}`
    }

    function valuesAreEmpty(values) {
      if (!values || typeof values !== 'object') return true
      return !(
        (Number.isFinite(values.x) && values.x !== 0) ||
        (Number.isFinite(values.y) && values.y !== 0) ||
        Number.isFinite(values.width) ||
        Number.isFinite(values.height) ||
        (Number.isFinite(values.rotation) && values.rotation !== 0) ||
        Number.isFinite(values.fontSize) ||
        typeof values.text === 'string' ||
        typeof values.color === 'string' ||
        typeof values.backgroundColor === 'string'
      )
    }

    function Icon({ name, size = 14 }) {
      const props = { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true }
      if (name === 'close') {
        return h('svg', props, h('path', { d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }))
      }
      if (name === 'collapse') {
        return h('svg', props, h('path', { d: 'M3 10l5-5 5 5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      }
      if (name === 'expand') {
        return h('svg', props, h('path', { d: 'M3 6l5 5 5-5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      }
      if (name === 'refresh') {
        return h('svg', props, h('path', { d: 'M13 8a5 5 0 1 1-1.5-3.6M13 3v3.4h-3.4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      }
      if (name === 'external') {
        return h('svg', props, h('path', { d: 'M6 3h7v7M13 3L7 9M4 5v8h8v-4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      }
      return h('svg', props)
    }

    function PreviewPanel(props) {
      const { t, useSessions } = props
      const tr = useCallback((key, vars) => {
        let text = typeof t === 'function' ? t(key) : undefined
        if (typeof text !== 'string' || text.length === 0 || text === key) {
          text = (zh[key] ?? en[key] ?? key)
        }
        if (vars !== undefined && typeof text === 'string') {
          for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value))
        }
        return text
      }, [t])

      const [preview, setPreview] = useState(null)
      const [mode, setMode] = useState('run')
      const [selection, setSelection] = useState(null)
      const [selections, setSelections] = useState([])
      const [metrics, setMetrics] = useState(null)
      const [adjustments, setAdjustments] = useState({})
      const [syncState, setSyncState] = useState('idle')
      const [frameSrc, setFrameSrc] = useState('')
      const [frameReady, setFrameReady] = useState(false)
      const [viewTarget, setViewTarget] = useState('exe')
      const [collapsed, setCollapsed] = useState(() => readStore().collapsed === true)
      const [bounds, setBounds] = useState(() => {
        const saved = readStore().bounds
        const width = clamp(Number(saved?.w) || 600, 380, Math.max(380, window.innerWidth - 32))
        const height = clamp(Number(saved?.h) || 780, 360, Math.max(360, window.innerHeight - 32))
        const x = Number.isFinite(saved?.x) ? clamp(saved.x, 8, Math.max(8, window.innerWidth - width - 8)) : Math.max(8, window.innerWidth - width - 24)
        const y = Number.isFinite(saved?.y) ? clamp(saved.y, 8, Math.max(8, window.innerHeight - height - 8)) : 64
        return { x, y, w: width, h: height }
      })
      const [stale, setStale] = useState(false)
      const [notice, setNotice] = useState('')
      const [closeOpen, setCloseOpen] = useState(false)
      const [zoom, setZoom] = useState(1)
      const [viewport, setViewport] = useState({ w: 0, h: 0 })
      const [pill, setPill] = useState(() => {
        const saved = readStore().pill
        if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
          return {
            x: clamp(saved.x, 4, Math.max(4, window.innerWidth - 80)),
            y: clamp(saved.y, 4, Math.max(4, window.innerHeight - 48)),
          }
        }
        return {
          x: Math.max(12, window.innerWidth - 250),
          y: Math.max(12, window.innerHeight - 150),
        }
      })
      const [confirmBusy, setConfirmBusy] = useState(false)

      const frameRef = useRef(null)
      const bodyRef = useRef(null)
      const modeRef = useRef(mode)
      const adjustRef = useRef(adjustments)
      const previewRef = useRef(preview)
      const frameStateRef = useRef(null)
      const changeTimer = useRef(0)
      const boundsRef = useRef(bounds)
      const pillRef = useRef(pill)
      const pillDragRef = useRef(false)
      const gestureRef = useRef(false)
      const hostPathsRef = useRef(new Set())
      const noticeTimer = useRef(0)

      modeRef.current = mode
      adjustRef.current = adjustments
      previewRef.current = preview
      boundsRef.current = bounds
      pillRef.current = pill

      const currentSessionId = useSessions((state) => {
        if (!state || !state.byId) return undefined
        for (const item of Object.values(state.byId)) {
          if ((item?.retainedBy?.mainView ?? 0) > 0) return item.id
        }
        return undefined
      })

      const showNotice = useCallback((message) => {
        setNotice(message)
        clearTimeout(noticeTimer.current)
        noticeTimer.current = setTimeout(() => setNotice(''), 3200)
      }, [])

      const postJson = useCallback(async (payload) => {
        try {
          const response = await fetch('/preview-studio/api', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            cache: 'no-store',
          })
          const data = await response.json().catch(() => undefined)
          if (!response.ok) return data ?? { ok: false }
          return data
        } catch {
          return undefined
        }
      }, [])

      const loadState = useCallback(async () => {
        try {
          const response = await fetch('/preview-studio/state', { cache: 'no-store' })
          if (!response.ok) {
            setPreview(null)
            return
          }
          const data = await response.json()
          setPreview(data?.preview ?? null)
          const hostChanges = Array.isArray(data?.preview?.changes) ? data.preview.changes : []
          const hostMap = {}
          for (const change of hostChanges) {
            const path = change?.selection?.path
            if (typeof path === 'string' && path.length > 0) {
              hostMap[path] = { selection: change.selection, values: change.values ?? {} }
            }
          }
          setAdjustments((previous) => {
            const known = hostPathsRef.current
            const next = {}
            for (const [key, entry] of Object.entries(previous)) {
              if (known.has(key)) {
                if (hostMap[key]) next[key] = entry
              } else {
                next[key] = entry
              }
            }
            // Host entries fill only gaps, so a poll never rolls back a value
            // the user just changed locally.
            for (const [key, entry] of Object.entries(hostMap)) {
              if (!next[key]) next[key] = entry
            }
            return next
          })
          hostPathsRef.current = new Set(Object.keys(hostMap))
          if (!gestureRef.current) {
            const local = adjustmentsRef.current ?? {}
            const missing = Object.values(hostMap).filter((entry) => !local[entry.selection?.path])
            if (missing.length > 0) {
              try {
                frameRef.current?.contentWindow?.postMessage({
                  __previewStudio: 1,
                  type: 'ps:restore',
                  changes: missing,
                }, '*')
              } catch {
                // Frame not ready yet; ps:ready will restore from local state.
              }
            }
          }
        } catch {
          // Keep the last known preview while the Host restarts.
        }
      }, [])

      useEffect(() => {
        let cancelled = false
        const run = () => { if (!cancelled) void loadState() }
        run()
        const timer = setInterval(run, 2000)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [loadState])

      useEffect(() => {
        if (!preview) {
          frameStateRef.current = null
          setFrameSrc('')
          return
        }
        const previous = frameStateRef.current
        if (!previous || previous.id !== preview.id) {
          frameStateRef.current = { id: preview.id, revision: preview.revision }
          setViewTarget(preview.target === 'apk' ? 'apk' : 'exe')
          setFrameSrc(`${preview.url}${preview.url.includes('?') ? '&' : '?'}__ps_rev=${preview.revision}`)
          setSelection(null)
          setSelections([])
          setMetrics(null)
          setAdjustments({})
          hostPathsRef.current = new Set()
          setSyncState('idle')
          setStale(false)
          setMode('run')
          setFrameReady(false)
          return
        }
        if (previous.revision !== preview.revision) {
          previous.revision = preview.revision
          if (modeRef.current === 'adjust' && Object.keys(adjustRef.current).length > 0) {
            setStale(true)
            return
          }
          setFrameSrc(`${preview.url}${preview.url.includes('?') ? '&' : '?'}__ps_rev=${preview.revision}`)
          setSelection(null)
          setSelections([])
          setMetrics(null)
          setStale(false)
          setMode('run')
          setFrameReady(false)
        }
      }, [preview])

      useEffect(() => {
        if (!preview) return
        const stored = readStore()
        if (stored.lastPreviewId !== preview.id) {
          writeStore({ lastPreviewId: preview.id, collapsed: false })
          setCollapsed(false)
        }
      }, [preview?.id])

      useEffect(() => {
        const onMessage = (event) => {
          const data = event.data
          if (!data || data.__previewStudio !== 1) return
          const frameWindow = frameRef.current?.contentWindow
          if (!frameWindow || event.source !== frameWindow) return
          if (data.type === 'ps:ready') {
            setFrameReady(true)
            try {
              frameWindow.postMessage({ __previewStudio: 1, type: 'ps:mode', mode: modeRef.current }, '*')
              const pending = Object.values(adjustmentsRef.current ?? {})
              if (pending.length > 0) {
                frameWindow.postMessage({ __previewStudio: 1, type: 'ps:restore', changes: pending }, '*')
              }
            } catch {
              // Frame navigated away.
            }
            return
          }
          if (data.type === 'ps:gesture') {
            gestureRef.current = data.active === true
            return
          }
          if (data.type === 'ps:select') {
            const list = Array.isArray(data.selections)
              ? data.selections
              : data.selection
                ? [data.selection]
                : []
            const primary = list.find((entry) => entry.path === data.primaryPath) ?? list[list.length - 1] ?? null
            setSelections(list)
            setSelection(primary)
            setMetrics(data.metrics ?? null)
            const current = previewRef.current
            if (current) {
              void postJson({
                action: 'select',
                previewId: current.id,
                selections: list,
                primaryPath: primary?.path,
              })
            }
            return
          }
          if (data.type === 'ps:change') {
            setSelection(data.selection ?? null)
            setMetrics(data.metrics ?? null)
            // A fresh visual change makes the previous approval stale.
            setPreview((previous) => (previous && previous.confirmed
              ? { ...previous, confirmed: false }
              : previous))
            if (data.selection) {
              setSelections((previous) => {
                const index = previous.findIndex((entry) => entry.path === data.selection.path)
                if (index < 0) return [...previous, data.selection]
                const next = [...previous]
                next[index] = data.selection
                return next
              })
              setAdjustments((previous) => {
                const key = data.selection.path ?? String(Date.now())
                const next = { ...previous }
                if (valuesAreEmpty(data.values)) delete next[key]
                else next[key] = { selection: data.selection, values: data.values ?? {} }
                return next
              })
              clearTimeout(changeTimer.current)
              changeTimer.current = setTimeout(() => {
                const current = previewRef.current
                if (!current) return
                setSyncState('syncing')
                const changes = Object.values(adjustRef.current)
                void postJson({ action: 'changes', previewId: current.id, changes }).then((result) => {
                  setSyncState(result?.ok ? 'synced' : 'error')
                })
              }, 700)
            }
            return
          }
          if (data.type === 'ps:clear') {
            setSelection(null)
            setSelections([])
            setMetrics(null)
            return
          }
          if (data.type === 'ps:error') {
            showNotice(String(data.message ?? tr('error.generic')))
          }
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [postJson, showNotice, tr])

      // While the inspector drags an element, the pointer may leave the iframe
      // (the phone screen is small). Forward panel-side pointer positions in
      // the iframe's CSS coordinates so the gesture keeps going beyond the
      // preview edge instead of stopping there.
      useEffect(() => {
        const forward = (event) => {
          if (!gestureRef.current) return
          const frame = frameRef.current
          if (!frame) return
          const rect = frame.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) return
          const layoutWidth = frame.offsetWidth || rect.width
          const layoutHeight = frame.offsetHeight || rect.height
          const x = (event.clientX - rect.left) * (layoutWidth / rect.width)
          const y = (event.clientY - rect.top) * (layoutHeight / rect.height)
          try {
            frame.contentWindow?.postMessage({ __previewStudio: 1, type: 'ps:drag-point', x, y }, '*')
          } catch {
            // Frame navigated away.
          }
        }
        const end = () => {
          if (!gestureRef.current) return
          gestureRef.current = false
          try {
            frameRef.current?.contentWindow?.postMessage({ __previewStudio: 1, type: 'ps:gesture-end' }, '*')
          } catch {
            // Frame navigated away.
          }
        }
        window.addEventListener('mousemove', forward)
        window.addEventListener('mouseup', end)
        window.addEventListener('blur', end)
        return () => {
          window.removeEventListener('mousemove', forward)
          window.removeEventListener('mouseup', end)
          window.removeEventListener('blur', end)
        }
      }, [])

      useEffect(() => {
        const element = bodyRef.current
        if (!element || typeof ResizeObserver === 'undefined') return
        const update = () => {
          setViewport({
            w: Math.max(0, element.clientWidth - 16),
            h: Math.max(0, element.clientHeight - 16),
          })
        }
        update()
        const observer = new ResizeObserver(update)
        observer.observe(element)
        return () => observer.disconnect()
      }, [preview?.id])

      useEffect(() => {
        const onResize = () => {
          setPill((previous) => ({
            x: clamp(previous.x, 4, Math.max(4, window.innerWidth - 80)),
            y: clamp(previous.y, 4, Math.max(4, window.innerHeight - 48)),
          }))
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])

      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape' || !previewRef.current) return
          if (modeRef.current === 'run') return
          setMode('run')
          setSelection(null)
          setSelections([])
          setMetrics(null)
          const frameWindow = frameRef.current?.contentWindow
          try {
            frameWindow?.postMessage({ __previewStudio: 1, type: 'ps:mode', mode: 'run' }, '*')
          } catch {
            // Ignore.
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])

      const sendToFrame = useCallback((message) => {
        const frameWindow = frameRef.current?.contentWindow
        if (!frameWindow) return
        try {
          frameWindow.postMessage({ __previewStudio: 1, ...message }, '*')
        } catch {
          // Ignore.
        }
      }, [])

      const changeMode = useCallback((next) => {
        setMode(next)
        setStale(false)
        sendToFrame({ type: 'ps:mode', mode: next })
        if (next === 'run') {
          setSelection(null)
          setSelections([])
          setMetrics(null)
        }
      }, [sendToFrame])

      const reloadFrame = useCallback(async () => {
        const current = previewRef.current
        if (!current) return
        setStale(false)
        setSelection(null)
        setSelections([])
        setMetrics(null)
        setFrameReady(false)
        setMode('run')
        const response = await postJson({ action: 'reload', previewId: current.id })
        const revision = response?.revision ?? (current.revision + 1)
        frameStateRef.current = { id: current.id, revision }
        setFrameSrc(`${current.url}${current.url.includes('?') ? '&' : '?'}__ps_rev=${revision}`)
      }, [postJson])

      const changeZoom = useCallback((delta) => {
        setZoom((previous) => clamp(Math.round((previous + delta) * 100) / 100, 0.5, 2))
      }, [])

      const undoLast = useCallback(() => {
        sendToFrame({ type: 'ps:undo' })
      }, [sendToFrame])

      const startPillDrag = useCallback((event) => {
        if (event.button !== 0) return
        event.preventDefault()
        const startX = event.clientX
        const startY = event.clientY
        const origin = { ...pillRef.current }
        let moved = false
        let last = origin
        const move = (moveEvent) => {
          const dx = moveEvent.clientX - startX
          const dy = moveEvent.clientY - startY
          if (!moved && Math.abs(dx) + Math.abs(dy) > 4) moved = true
          if (!moved) return
          last = {
            x: clamp(origin.x + dx, 4, Math.max(4, window.innerWidth - 80)),
            y: clamp(origin.y + dy, 4, Math.max(4, window.innerHeight - 48)),
          }
          setPill(last)
        }
        const up = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          if (moved) {
            pillDragRef.current = true
            writeStore({ pill: last })
            window.setTimeout(() => { pillDragRef.current = false }, 0)
          }
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }, [])

      const startDrag = useCallback((event) => {
        if (event.button !== 0) return
        event.preventDefault()
        const startX = event.clientX
        const startY = event.clientY
        const origin = { ...boundsRef.current }
        const move = (moveEvent) => {
          setBounds((previous) => ({
            ...previous,
            x: clamp(origin.x + moveEvent.clientX - startX, 4, Math.max(4, window.innerWidth - previous.w - 4)),
            y: clamp(origin.y + moveEvent.clientY - startY, 4, Math.max(4, window.innerHeight - 48)),
          }))
        }
        const up = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          writeStore({ bounds: boundsRef.current })
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }, [])

      const startResize = useCallback((event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        const startX = event.clientX
        const startY = event.clientY
        const origin = { ...boundsRef.current }
        const move = (moveEvent) => {
          setBounds((previous) => ({
            ...previous,
            w: clamp(origin.w + moveEvent.clientX - startX, 360, Math.max(360, window.innerWidth - previous.x - 4)),
            h: clamp(origin.h + moveEvent.clientY - startY, 320, Math.max(320, window.innerHeight - previous.y - 4)),
          }))
        }
        const up = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          writeStore({ bounds: boundsRef.current })
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }, [])

      const applyProp = useCallback((prop, value) => {
        sendToFrame({ type: 'ps:apply', prop, value })
      }, [sendToFrame])

      const confirmBuild = useCallback(async () => {
        const current = previewRef.current
        if (!current) return
        setConfirmBusy(true)
        const response = await postJson({ action: 'confirm', previewId: current.id })
        setConfirmBusy(false)
        if (response?.ok) {
          showNotice(tr('confirm.sent'))
          setPreview((previous) => (previous ? { ...previous, confirmed: true } : previous))
        } else if (response?.reason === 'changes-pending') {
          showNotice(tr('confirm.pendingChanges', { count: response.changeCount ?? 0 }))
          void loadState()
        }
      }, [loadState, postJson, showNotice, tr])

      const revokeConfirm = useCallback(async () => {
        const current = previewRef.current
        if (!current) return
        await postJson({ action: 'revoke', previewId: current.id })
        setPreview((previous) => (previous ? { ...previous, confirmed: false, buildAuthorized: false } : previous))
      }, [postJson])

      const toggleSkipConfirmation = useCallback(async () => {
        const current = previewRef.current
        if (!current) return
        const enabled = current.skipConfirmation !== true
        const response = await postJson({ action: 'skip', previewId: current.id, enabled })
        if (response?.ok) {
          setPreview((previous) => (previous
            ? { ...previous, skipConfirmation: enabled, confirmed: false, buildAuthorized: false }
            : previous))
          showNotice(tr(enabled ? 'skip.enabledNotice' : 'skip.disabledNotice'))
        }
      }, [postJson, showNotice, tr])

      const closePreview = useCallback(async () => {
        const current = previewRef.current
        if (!current) return
        await postJson({ action: 'close', previewId: current.id })
        setPreview(null)
        setCloseOpen(false)
      }, [postJson])

      const localValues = useMemo(() => {
        if (!selection) return {}
        return adjustments[selection.path ?? 'element']?.values ?? metrics?.values ?? {}
      }, [selection, adjustments, metrics])

      const pendingChanges = Object.keys(adjustments).length
      const unsavedChanges = Math.max(pendingChanges, Number(preview?.changeCount) || 0)
      const confirmed = preview?.confirmed === true
      const skipConfirmation = preview?.skipConfirmation === true
      const buildAuthorized = preview?.buildAuthorized === true
      const view = viewTarget === 'apk' ? 'apk' : 'exe'
      const effectiveTarget = preview?.target === 'apk' ? 'apk' : 'exe'
      const foreign = preview !== null && currentSessionId !== undefined && preview.sessionId !== currentSessionId

      if (!preview) return null

      const collapsedPill = h('button', {
        type: 'button',
        className: 'ps-pill',
        style: { left: pill.x, top: pill.y },
        title: tr('panel.expand'),
        'aria-label': tr('panel.expand'),
        onMouseDown: startPillDrag,
        onClick: () => {
          if (pillDragRef.current) return
          setCollapsed(false)
          writeStore({ collapsed: false })
        },
      },
      h('span', { className: 'ps-mark' }, 'P'),
      h('span', { className: 'ps-pill-text' },
        h('strong', null, tr('panel.title')),
        h('span', null, preview.title),
      ),
      h('span', { className: 'ps-badge' }, tr(`target.${effectiveTarget}`)),
      preview.changeCount > 0 ? h('span', { className: 'ps-count' }, preview.changeCount) : null,
      h(Icon, { name: 'expand', size: 14 }),
      )

      const header = h('div', { className: 'ps-header', onMouseDown: startDrag },
        h('span', { className: 'ps-mark' }, 'P'),
        h('span', { className: 'ps-title', title: preview.title }, preview.title),
        h('span', { className: 'ps-badge' }, tr(`target.${effectiveTarget}`)),
        skipConfirmation
          ? h('span', { className: 'ps-badge', style: { color: '#16a34a' } }, tr('skip.label'))
          : !confirmed && !buildAuthorized
            ? h('span', { className: 'ps-badge', style: { color: 'var(--dsw-alias-state-warn-primary)' } }, tr('confirm.note'))
            : null,
        h('span', { className: 'ps-spacer' }),
        h('button', { type: 'button', className: 'ps-icon', title: tr('panel.refresh'), onClick: reloadFrame }, h(Icon, { name: 'refresh' })),
        h('button', { type: 'button', className: 'ps-icon', title: tr('panel.collapse'), onClick: () => { setCollapsed(true); writeStore({ collapsed: true }) } }, h(Icon, { name: 'collapse' })),
        h('button', { type: 'button', className: 'ps-icon', title: tr('panel.close'), onClick: () => setCloseOpen(true) }, h(Icon, { name: 'close' })),
      )

      const toolbar = h('div', { className: 'ps-toolbar' },
        h('div', { className: 'ps-seg', role: 'tablist', 'aria-label': tr('panel.title') },
          ['run', 'select', 'adjust'].map((item) => h('button', {
            key: item,
            type: 'button',
            className: mode === item ? 'ps-on' : '',
            'aria-pressed': mode === item,
            title: tr(`mode.${item}.hint`),
            disabled: item !== 'run' && !frameReady,
            onClick: () => changeMode(item),
          }, tr(`mode.${item}`))),
        ),
        h('button', {
          type: 'button',
          className: 'ps-ghost',
          title: tr('view.desktop'),
          onClick: () => setViewTarget(view === 'apk' ? 'exe' : 'apk'),
        }, view === 'apk' ? tr('view.phone') : tr('view.desktop')),
        h('div', { className: 'ps-zoom' },
          h('button', { type: 'button', className: 'ps-zoom-button', title: tr('zoom.out'), 'aria-label': tr('zoom.out'), onClick: () => changeZoom(-0.1) }, '−'),
          h('button', { type: 'button', className: 'ps-zoom-value', title: tr('zoom.reset'), onClick: () => setZoom(1) }, `${Math.round(zoom * 100)}%`),
          h('button', { type: 'button', className: 'ps-zoom-button', title: tr('zoom.in'), 'aria-label': tr('zoom.in'), onClick: () => changeZoom(0.1) }, '＋'),
        ),
        mode === 'adjust'
          ? h('button', { type: 'button', className: 'ps-ghost', title: tr('adjust.undoHint'), onClick: undoLast }, tr('adjust.undo'))
          : null,
        h('span', { className: 'ps-spacer' }),
      )

      const skipToggle = h('button', {
        type: 'button',
        className: `ps-skip${skipConfirmation ? ' is-on' : ''}`,
        title: skipConfirmation ? tr('skip.disableHint') : tr('skip.enableHint'),
        'aria-pressed': skipConfirmation,
        onClick: toggleSkipConfirmation,
      },
      h('span', { className: 'ps-switch' }),
      h('span', null, `${tr('skip.label')} · ${skipConfirmation ? tr('skip.on') : tr('skip.off')}`),
      )

      const confirmButton = h('button', {
        type: 'button',
        className: 'ps-primary',
        disabled: confirmBusy || unsavedChanges > 0,
        title: unsavedChanges > 0 ? tr('confirm.blocked') : tr('confirm.action'),
        onClick: confirmBuild,
      }, `${tr('confirm.action')} ${tr(`target.${effectiveTarget}`)}`)

      const confirmBanner = h('div', {
        className: `ps-confirmbar${skipConfirmation ? ' is-skip' : buildAuthorized ? ' is-authorized' : confirmed ? ' is-ok' : ''}`,
      },
      skipToggle,
      h('span', { className: 'ps-confirmbar-text' },
        skipConfirmation
          ? tr('skip.note')
          : buildAuthorized
            ? tr('confirm.authorized')
            : confirmed
              ? tr('confirm.confirmedOnce')
              : unsavedChanges > 0
                ? tr('confirm.pendingChanges', { count: unsavedChanges })
                : tr('confirm.noteLong')),
      h('span', { className: 'ps-spacer' }),
      confirmed || buildAuthorized
        ? h('button', { type: 'button', className: 'ps-ghost', onClick: revokeConfirm }, tr('confirm.revoke'))
        : null,
      confirmButton,
      )

      const propertiesPanel = mode === 'adjust' && selection
        ? h('div', { className: 'ps-props' },
            h('label', { className: 'ps-field' },
              h('span', null, tr('adjust.x')),
              h('input', {
                type: 'number', value: Number.isFinite(localValues.x) ? localValues.x : 0, step: 1,
                onChange: (event) => applyProp('x', Number(event.target.value || 0)),
              })),
            h('label', { className: 'ps-field' },
              h('span', null, tr('adjust.y')),
              h('input', {
                type: 'number', value: Number.isFinite(localValues.y) ? localValues.y : 0, step: 1,
                onChange: (event) => applyProp('y', Number(event.target.value || 0)),
              })),
            h('label', { className: 'ps-field' },
              h('span', null, tr('adjust.w')),
              h('input', {
                type: 'number', value: Number.isFinite(localValues.width) ? localValues.width : '',
                placeholder: tr('adjust.auto'), min: 1,
                onChange: (event) => applyProp('width', event.target.value === '' ? null : Number(event.target.value)),
              })),
            h('label', { className: 'ps-field' },
              h('span', null, tr('adjust.h')),
              h('input', {
                type: 'number', value: Number.isFinite(localValues.height) ? localValues.height : '',
                placeholder: tr('adjust.auto'), min: 1,
                onChange: (event) => applyProp('height', event.target.value === '' ? null : Number(event.target.value)),
              })),
            h('label', { className: 'ps-field' },
              h('span', null, tr('adjust.rotate')),
              h('input', {
                type: 'number', value: Number.isFinite(localValues.rotation) ? localValues.rotation : 0, step: 1,
                onChange: (event) => applyProp('rotation', Number(event.target.value || 0)),
              })),
            h('label', { className: 'ps-field' },
              h('span', null, tr('adjust.fontSize')),
              h('input', {
                type: 'number',
                value: Number.isFinite(localValues.fontSize) ? localValues.fontSize : (metrics?.fontSize ?? ''),
                min: 6, max: 240, step: 1,
                onChange: (event) => applyProp('fontSize', event.target.value === '' ? null : Number(event.target.value)),
              })),
            h('label', { className: 'ps-field ps-wide' },
              h('span', null, tr('adjust.text')),
              h('input', {
                type: 'text',
                defaultValue: metrics?.text ?? '',
                key: `${selection.path ?? ''}:${metrics?.text ?? ''}`,
                disabled: metrics?.editableText === false,
                onBlur: (event) => applyProp('text', event.target.value),
                onKeyDown: (event) => { if (event.key === 'Enter') applyProp('text', event.currentTarget.value) },
              })),
            h('label', { className: 'ps-field' },
              h('span', null, tr('adjust.color')),
              h('input', {
                type: 'color',
                value: hexOf(localValues.color ?? metrics?.color),
                onChange: (event) => applyProp('color', event.target.value),
              })),
            h('label', { className: 'ps-field' },
              h('span', null, tr('adjust.background')),
              h('input', {
                type: 'color',
                value: hexOf(localValues.backgroundColor ?? metrics?.backgroundColor),
                onChange: (event) => applyProp('backgroundColor', event.target.value),
              })),
          )
        : null

      const viewportWidth = Math.max(220, viewport.w || Math.max(220, bounds.w - 48))
      const viewportHeight = Math.max(260, viewport.h || 560)
      const isPhone = view === 'apk'
      // Render the phone at its native 390px layout width whenever the panel is
      // wide enough, and only transform-scale when it has to shrink or zoom.
      // Native size keeps the iframe text crisp instead of resampling it.
      const screenHeight = isPhone ? clamp(viewportHeight - 70, 460, 844) : viewportHeight
      const phoneScale = isPhone ? Math.min(1, viewportWidth / 414) * zoom : zoom
      const phoneHeight = screenHeight + 20
      const canvasWidth = isPhone ? 414 * phoneScale : viewportWidth * phoneScale
      const canvasHeight = isPhone ? phoneHeight * phoneScale : viewportHeight * phoneScale

      const frame = h('iframe', {
        key: frameSrc,
        ref: frameRef,
        className: 'ps-frame',
        src: frameSrc || undefined,
        title: tr('frame.title'),
      })

      const body = h('div', { className: 'ps-body', ref: bodyRef },
        h('div', { className: 'ps-canvas', style: { width: canvasWidth, height: canvasHeight } },
          isPhone
            ? h('div', {
                className: 'ps-phone',
                style: {
                  width: 414,
                  height: phoneHeight,
                  transform: phoneScale === 1 ? 'none' : `scale(${phoneScale})`,
                },
              },
                h('div', { className: 'ps-phone-screen', style: { width: 390, height: screenHeight } },
                  h('div', { className: 'ps-phone-status' }, h('span', null, tr('phone.time')), h('span', null, '▮▮▮ 100%')),
                  frame,
                  h('div', { className: 'ps-phone-nav' }, h('i'), h('i')),
                ),
              )
            : h('div', {
                className: 'ps-desktop',
                style: {
                  width: viewportWidth,
                  height: viewportHeight,
                  transform: phoneScale === 1 ? 'none' : `scale(${phoneScale})`,
                },
              },
                h('div', { className: 'ps-desktop-bar' },
                  h('span', { className: 'ps-dots' }, h('i'), h('i'), h('i')),
                  h('span', { className: 'ps-desktop-title' }, preview.title),
                ),
                frame,
              ),
        ),
        !frameReady ? h('div', { className: 'ps-empty' }, tr('empty.waiting')) : null,
      )

      const selectionCount = selections.length
      const statusText = selectionCount > 0
        ? selectionCount > 1
          ? `${tr('selection.multi', { count: selectionCount })}: ${elementSummary(selection)}`
          : `${tr('selection.selected')}: ${elementSummary(selection)}`
        : mode === 'run'
          ? tr('mode.run.hint')
          : mode === 'select'
            ? tr('mode.select.hint')
            : tr('mode.adjust.hint')

      const status = h('div', { className: 'ps-status' },
        h('span', { className: 'ps-chip', title: statusText }, statusText),
        h('span', { className: 'ps-spacer' }),
        unsavedChanges > 0 ? h('span', null, tr('changes.pending', { count: unsavedChanges })) : null,
        h('span', { className: `ps-dot ${syncState}` }),
        h('span', null, syncState === 'syncing' ? tr('sync.syncing') : syncState === 'synced' ? tr('sync.synced') : syncState === 'error' ? tr('sync.error') : tr('sync.idle')),
      )

      const foreignBanner = foreign ? h('div', { className: 'ps-banner' }, tr('foreign.session')) : null
      const staleBanner = stale
        ? h('div', { className: 'ps-banner' },
            h('span', null, tr('stale.reload')),
            h('span', { className: 'ps-spacer' }),
            h('button', { type: 'button', className: 'ps-ghost', onClick: reloadFrame }, tr('stale.button')),
          )
        : null
      const builtBanner = preview.built?.path
        ? h('div', { className: 'ps-banner' }, `${tr('built.label')}: ${preview.built.path}`)
        : null

      const panel = h('div', {
        className: 'ps-root',
        style: { left: bounds.x, top: bounds.y, width: bounds.w, height: bounds.h },
        role: 'dialog',
        'aria-label': tr('panel.aria'),
      },
      h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
      header,
      foreignBanner,
      builtBanner,
      toolbar,
      confirmBanner,
      propertiesPanel,
      staleBanner,
      body,
      status,
      notice ? h('div', { className: 'ps-toast' }, notice) : null,
      closeOpen ? h('div', { className: 'ps-modal' },
        h('div', { className: 'ps-card' },
          h('h4', null, tr('close.title')),
          h('p', null, tr('close.body')),
          h('div', { className: 'ps-card-actions' },
            h('button', { type: 'button', className: 'ps-ghost', onClick: () => setCloseOpen(false) }, tr('close.cancel')),
            h('button', { type: 'button', className: 'ps-primary', onClick: closePreview }, tr('close.confirm')),
          ),
        ),
      ) : null,
      h('div', { className: 'ps-grip', onMouseDown: startResize }),
      )

      const stage = h('div', {
        style: collapsed ? { visibility: 'hidden' } : undefined,
        'aria-hidden': collapsed || undefined,
      }, panel)

      // Keep the same element structure in both states: collapsing only hides
      // the stage, so the preview iframe (and its in-page adjustments) stays
      // mounted instead of reloading.
      return h(React.Fragment, null,
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        stage,
        collapsed ? collapsedPill : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'preview-studio: dictionaries')
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'preview-studio.panel',
          order: 40,
          locale: NS,
        }, PreviewPanel))
      },
    }
  },
})
