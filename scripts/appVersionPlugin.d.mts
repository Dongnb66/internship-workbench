export declare function appVersionPlugin(version: string): {
  name: string
  apply: 'build'
  transformIndexHtml(html: string): string
}
