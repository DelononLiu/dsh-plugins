#!/usr/bin/env node
/**
 * dsh client bundle 构建：把 src/client/index.ts 打包成官方格式
 * lib/client.js（window.__ModuleLoader__.load({id, factory}) closure，
 * factory 经注入 require 解析 external，导出 apply/inject）。
 *
 * 用法：node scripts/build-client.mjs <包路径> <client-id>
 * 例：node scripts/build-client.mjs packages/dsh-my-ui dsh-my-ui
 */

import { build } from 'esbuild'
import { writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const [, , pkgPath, clientId] = process.argv
if (!pkgPath || !clientId) {
  console.error('用法: node scripts/build-client.mjs <包路径> <client-id>')
  process.exit(2)
}

const root = resolve(pkgPath)
const entry = join(root, 'src/client/index.ts')
const outFile = join(root, 'lib/client.js')

// 1. esbuild bundle → iife（external 依赖保留为 require，由 ModuleLoader 注入）
const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  globalName: '__dshClient',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  outfile: join(root, 'lib/.client.tmp.js'),
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-runtime/client', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-locale/client'],
  write: true,
  logLevel: 'silent',
})

// 2. 包装成 ModuleLoader closure
const body = await readFile(join(root, 'lib/.client.tmp.js'), 'utf8')
const closure = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(clientId)},
\tfactory: (require) => {
${indent(body, 2)}
\t\treturn __dshClient ?? module.exports;
\t}
});
`
await writeFile(outFile, closure)
await rmTmp(root)
console.log(`[build-client] ${clientId} → ${outFile}`)

function indent(text, spaces) {
  const pad = ' '.repeat(spaces)
  return text.split('\n').map((l) => (l ? pad + l : l)).join('\n')
}

async function rmTmp(root) {
  const { rm } = await import('node:fs/promises')
  await rm(join(root, 'lib/.client.tmp.js'), { force: true })
}
