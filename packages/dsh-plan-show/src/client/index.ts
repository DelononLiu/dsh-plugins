/**
 * dsh-plan-show client 入口：把浏览器半区（消息内就地渲染）注册进客户端。
 *
 * 构建脚本固定以 `src/client/index.ts` 为入口，故此处只做转出；实现体在 `./apply`
 * （与 dsh-console 的入口同一形状）。本插件没有独立界面——不注册任何插槽。
 */

export { apply } from './apply.js'
