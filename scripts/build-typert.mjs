#!/usr/bin/env node
/**
 * dsh typert 生成：在 host tsc 编译后，调用官方 WorkspaceTypertGenerator
 * 为声明了 @Remote 的包生成 typert 产物（lib/typert.host.js + 
 * lib/typert.remote-client.js）。照抄官方 tsdown-plugin 的 emitArtifacts 逻辑。
 *
 * 用法：node scripts/build-typert.mjs <包路径> <包名>
 * 例：node scripts/build-typert.mjs packages/dsh-channel dsh-channel
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const [, , pkgPath, pkgName] = process.argv
if (!pkgPath || !pkgName) {
  console.error('用法: node scripts/build-typert.mjs <包路径> <包名>')
  process.exit(2)
}

// workspaceRoot 固定为仓库根（脚本位于 <repo>/scripts/）——与调用 cwd 无关，
// 避免 build（cwd=包目录）与手动（cwd=根）解析不一致。
const scriptDir = fileURLToPath(new URL('.', import.meta.url))
const workspaceRoot = resolve(scriptDir, '..')
const pkgRoot = resolve(workspaceRoot, pkgPath)

// generator 从仓库根 node_modules 解析（根 devDependency，TS6 环境）。
const require = createRequire(import.meta.url)
const generatorPath = require.resolve('@deepseek-ai/dsh-typert-generator', { paths: [workspaceRoot] })
const { WorkspaceTypertGenerator } = await import(pathToFileUrl(generatorPath))

/**
 * 生成指定包的 typert 产物（host 面）。
 * 注意：generator 的 WorkspaceAnalyzer 需要 tsconfig.host.json（workspace 根）。
 */
async function main() {
  const gen = new WorkspaceTypertGenerator(workspaceRoot)
  const artifacts = gen.generate([pkgName], ['host'])
  const artifact = artifacts.find(a => a.package === pkgName)
  if (artifact === undefined) {
    console.log(`[build-typert] ${pkgName}: 无 @Remote 方法，跳过`)
    return
  }
  const output = join(pkgRoot, 'lib')
  mkdirSync(output, { recursive: true })
  writeFileSync(join(output, `typert.${artifact.face}.js`), artifact.js)
  writeFileSync(join(output, `typert.${artifact.face}.d.ts`), artifact.dts)
  if (artifact.remote !== undefined) {
    writeFileSync(join(output, 'typert.remote-client.js'), artifact.remote.js)
    writeFileSync(join(output, 'typert.remote-client.d.ts'), artifact.remote.dts)
    writeFileSync(join(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
    console.log(`[build-typert] ${pkgName}: host + remote-client 已生成`)
  } else {
    console.log(`[build-typert] ${pkgName}: host 已生成（无 remote）`)
  }
}

function pathToFileUrl(p) {
  return fileURLToPath(new URL(`file://${p}`))
}

main().catch((err) => {
  console.error(`[build-typert] ${pkgName} 生成失败:`, err.message)
  process.exit(1)
})
