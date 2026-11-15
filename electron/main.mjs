/**
 * 桌面壳（Electron）主进程。
 *
 * 壳的职责只有两条：
 * 1. 把同一个网页应用装进一个桌面窗口（登录态、RLS、云 SDK 全部沿用网页端）；
 * 2. 提供浏览器拿不到的两件事：窗口置顶浮窗 + 全局快捷键切换。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'

import {
  TOGGLE_ACCELERATOR,
  clampBounds,
  defaultFloatBounds,
  resolveStartUrl,
} from './windowConfig.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const devMode = process.argv.includes('--dev')
const startUrl = resolveStartUrl({ env: process.env, dev: devMode })

let win = null
let floating = false
/** 进浮窗前的普通窗口矩形，退出浮窗时恢复 */
let restoreBounds = null

function desktopState() {
  return {
    float: floating,
    pinned: win && !win.isDestroyed() ? win.isAlwaysOnTop() : false,
    platform: process.platform,
    version: app.getVersion(),
  }
}

function workAreaFor(bounds) {
  try {
    return screen.getDisplayMatching(bounds).workArea
  } catch {
    return screen.getPrimaryDisplay().workArea
  }
}

/**
 * 切换浮窗。浮窗 = 小窗 + 置顶，两者是同一件事，不拆成两个开关：
 * 「置顶但仍是全屏大小」在会议软件里反而更碍事。
 */
function applyFloat(on) {
  if (!win || win.isDestroyed()) return desktopState()
  if (on === floating) return desktopState()
  const current = win.getBounds()
  const area = workAreaFor(current)
  if (on) {
    restoreBounds = clampBounds(current, area)
    win.setAlwaysOnTop(true, 'floating')
    win.setBounds(defaultFloatBounds(area))
  } else {
    win.setAlwaysOnTop(false)
    if (restoreBounds) win.setBounds(clampBounds(restoreBounds, area))
    restoreBounds = null
  }
  floating = on
  return desktopState()
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    title: '实习工作台',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // 先隐藏再 show：避免构建产物加载前的白屏闪一下
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
  })

  void win.loadURL(startUrl)
}

// 单实例：第二次启动只聚焦已有窗口。多开会让同一个账号在两个窗口里争同一份额度计数。
// 某些受限终端/安全软件会拒绝 Chromium 创建 SingletonLock（日志报 Error code: 5），
// 此时锁恒为 false，可用 IWB_ALLOW_MULTI=1 跳过单实例保护直接启动。
const skipSingleInstance = process.env.IWB_ALLOW_MULTI === '1'
if (!skipSingleInstance && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(() => {
    ipcMain.handle('desktop:get-state', () => desktopState())
    ipcMain.handle('desktop:set-float', (_event, on) => applyFloat(on === true))
    ipcMain.handle('desktop:toggle-float', () => applyFloat(!floating))

    createWindow()

    // 快捷键注册失败（被别的软件占用）不致命：界面上的按钮仍可用
    globalShortcut.register(TOGGLE_ACCELERATOR, () => applyFloat(!floating))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('will-quit', () => globalShortcut.unregisterAll())

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
