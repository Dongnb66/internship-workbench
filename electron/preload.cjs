/**
 * 预加载桥：渲染进程只能看到下面这几个方法。
 *
 * 刻意不暴露 ipcRenderer 本体 —— 否则页面里任何一段脚本都能往主进程发任意通道。
 * 也刻意不提供「取消录屏保护 / 抓系统音频 / 反检测」这类能力：壳不做那些事。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('iwbDesktop', {
  platform: process.platform,
  getState: () => ipcRenderer.invoke('desktop:get-state'),
  setFloat: (on) => ipcRenderer.invoke('desktop:set-float', on === true),
  toggleFloat: () => ipcRenderer.invoke('desktop:toggle-float'),
})
