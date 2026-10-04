/** 计数要带的两个环境字段：应用版本、操作系统（只到 win/mac/linux 这个粒度，不采集指纹） */
export const USAGE_APP_VERSION = "0.8.28"
export const USAGE_OS =
  typeof navigator === 'undefined'
    ? 'unknown'
    : /Win/i.test(navigator.userAgent)
      ? 'win'
      : /Mac/i.test(navigator.userAgent)
        ? 'mac'
        : /Linux|Android/i.test(navigator.userAgent)
          ? 'linux'
          : 'other'
