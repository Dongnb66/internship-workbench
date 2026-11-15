import { describe, expect, it } from 'vitest'

import {
  DEV_URL,
  FLOAT_SIZE,
  ONLINE_URL,
  clampBounds,
  defaultFloatBounds,
  isAllowedStartUrl,
  resolveStartUrl,
} from '../windowConfig.mjs'

describe('启动地址', () => {
  it('只放行 http / https / file', () => {
    expect(isAllowedStartUrl('https://example.com/app')).toBe(true)
    expect(isAllowedStartUrl('http://localhost:5173')).toBe(true)
    expect(isAllowedStartUrl('file:///C:/app/index.html')).toBe(true)
    expect(isAllowedStartUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedStartUrl('data:text/html,x')).toBe(false)
    expect(isAllowedStartUrl('')).toBe(false)
  })

  it('显式覆盖优先于开发模式与线上地址', () => {
    expect(resolveStartUrl({ env: { IWB_DESKTOP_URL: 'https://example.com' }, dev: true })).toBe('https://example.com')
  })

  it('覆盖项不合法时回退到线上地址，而不是抛错', () => {
    expect(resolveStartUrl({ env: { IWB_DESKTOP_URL: 'javascript:alert(1)' }, dev: false })).toBe(ONLINE_URL)
  })

  it('开发模式指向 vite 端口', () => {
    expect(resolveStartUrl({ dev: true })).toBe(DEV_URL)
  })

  it('默认加载线上应用：换成本地地址会让云 SDK 的 Origin 校验失效', () => {
    expect(resolveStartUrl({})).toBe(ONLINE_URL)
  })
})

describe('窗口矩形夹取', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 }

  it('屏幕外坐标被拉回工作区', () => {
    expect(clampBounds({ x: 5000, y: -900, width: 400, height: 300 }, area)).toEqual({
      x: 1520,
      y: 0,
      width: 400,
      height: 300,
    })
  })

  it('窗口大于工作区时按工作区截断', () => {
    expect(clampBounds({ x: 0, y: 0, width: 3000, height: 2000 }, area)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    })
  })

  it('副屏工作区有偏移时夹取跟着偏移', () => {
    const second = { x: 1920, y: -200, width: 1280, height: 720 }
    expect(clampBounds({ x: 100, y: 0, width: 400, height: 300 }, second)).toEqual({
      x: 1920,
      y: 0,
      width: 400,
      height: 300,
    })
  })

  it('浮窗默认落在右上角且不越界', () => {
    const b = defaultFloatBounds(area)
    expect(b.width).toBe(FLOAT_SIZE.width)
    expect(b.height).toBe(FLOAT_SIZE.height)
    expect(b.x).toBe(area.width - FLOAT_SIZE.width - 16)
    expect(b.y).toBe(16)
  })

  it('小屏上浮窗被压到工作区大小', () => {
    const small = { x: 0, y: 0, width: 360, height: 320 }
    const b = defaultFloatBounds(small)
    expect(b).toMatchObject({ x: 0, y: 0, width: 360, height: 320 })
  })

  it('工作区缺失时给出可用的保底矩形', () => {
    expect(clampBounds({}, undefined)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })
})
