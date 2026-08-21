/**
 * dsh-channel：系统层·通信（跨实例通道）。
 *
 * 实例服务提供者 + 事件总线 + 控制指令通道。v1 为**进程内实现**（单实例
 * 内的注册表/心跳/事件总线/指令回环）；跨实例物理传输（agent↔console
 * 的实例令牌通道）在 agent/传输层实现时接入——本插件的接口（register/
 * heartbeat/emit/sendControl）即其承载面。Typert 远程化（@Remote +
 * ctx.remote 消费）在 nav/console-ui 消费时接入。
 *
 * 事件总线语义（已定）：at-least-once + 消息 id 幂等去重 + TTL 过期 +
 * 三平面（control 控制指令 / task 幂等投递 / session 仅显式共享）。
 * @module dsh-channel
 */
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { randomUUID } from 'node:crypto';
/** 运行时 schema。 */
export const Config = z.object({
    tokens: z.dict(z.string()).default({}),
    heartbeatTimeoutMs: z.number().default(30000),
});
/** 事件默认 TTL（7 天，已定投递语义）。 */
export const EVENT_TTL_MS = 7 * 24 * 3600_000;
/**
 * 通信服务（实例服务提供者 + 事件总线 + 控制指令）。所有插件经 `ctx.channel`
 * 注册/发现实例、收发事件与控制指令。
 */
export class ChannelService extends Service {
    config;
    static Config = Config;
    /** 已知实例表（id → 含心跳时间的条目）。 */
    instances = new Map();
    /** 事件订阅者：plane → handler 集合。 */
    subscribers = new Map();
    /** 控制指令接收者。 */
    controlHandlers = new Set();
    /** 事件 id → 产生时间（幂等去重 + TTL 清理）。 */
    eventTimes = new Map();
    /** 已确认事件 id（幂等回执）。 */
    ackedEvents = new Set();
    constructor(ctx, config) {
        super(ctx, 'channel');
        this.config = config;
        // 心跳超时扫描：setInterval + ctx.effect（fiber 卸载时清理）。
        const timer = setInterval(() => this.sweep(), Math.min(config.heartbeatTimeoutMs, 60_000));
        timer.unref?.();
        ctx.effect(() => () => clearInterval(timer));
    }
    /**
     * 注册实例（agent 上线时调用）。校验实例令牌；重复注册刷新状态。
     * @param instance - 实例基础身份。
     * @param token - 实例令牌（bootstrap 注入；不匹配抛错）。
     */
    register(instance, token) {
        const expected = this.config.tokens[instance.id];
        if (expected && expected !== token) {
            throw new Error(`instance "${instance.id}" rejected: token mismatch`);
        }
        this.instances.set(instance.id, { ...instance, status: 'online', lastSeen: Date.now() });
    }
    /**
     * 心跳上报（agent 周期调用）。未知实例或令牌不匹配抛错。
     * @param instanceId - 实例 id。
     * @param token - 实例令牌。
     */
    heartbeat(instanceId, token) {
        const entry = this.instances.get(instanceId);
        if (!entry)
            throw new Error(`unknown instance "${instanceId}"`);
        const expected = this.config.tokens[instanceId];
        if (expected && expected !== token)
            throw new Error('token mismatch');
        entry.lastSeen = Date.now();
        entry.status = 'online';
    }
    /**
     * 发现：列出全部已知实例（含离线——离线由心跳超时标记）。
     * @returns 实例基础身份列表。
     */
    list() {
        return [...this.instances.values()].map(toIdentity);
    }
    /** 查询单个实例；未知返回 undefined。 */
    get(instanceId) {
        const entry = this.instances.get(instanceId);
        return entry ? toIdentity(entry) : undefined;
    }
    /**
     * 发布事件（at-least-once 投递语义的进程内实现）：自动生成消息 id（幂等
     * 去重键），按 TTL 清理。跨实例投递由传输层消费同一接口。
     * @param plane - 事件平面（control/task/session）。
     * @param type - 事件类型。
     * @param payload - 载荷。
     * @param ttl - 存活毫秒（默认 7 天）。
     * @returns 事件 id（订阅方可回执/去重）。
     */
    emit(plane, type, payload, ttl = EVENT_TTL_MS) {
        const event = { id: randomUUID(), plane, type, payload, ts: Date.now(), ttl };
        this.eventTimes.set(event.id, event.ts);
        for (const handler of this.subscribers.get(plane) ?? []) {
            handler(event);
        }
        return event.id;
    }
    /**
     * 订阅某平面事件（进程内）。返回解除订阅 disposer。
     * @param plane - 事件平面。
     * @param handler - 处理函数。
     * @returns disposer。
     */
    subscribe(plane, handler) {
        let set = this.subscribers.get(plane);
        if (!set) {
            set = new Set();
            this.subscribers.set(plane, set);
        }
        set.add(handler);
        return () => set.delete(handler);
    }
    /**
     * 已处理消息确认（幂等回执）：同一事件 id 首次确认返回 true，重复返回
     * false——消费方对重复投递跳过处理。
     * @param eventId - 消息 id。
     * @returns 是否首次确认。
     */
    ack(eventId) {
        if (this.ackedEvents.has(eventId))
            return false;
        this.ackedEvents.add(eventId);
        return true;
    }
    /**
     * 发送控制指令到某实例（远程管理；v1 进程内回环——跨实例经传输层）。
     * @param instanceId - 目标实例 id。
     * @param command - 指令（不含 id，自动生成幂等 id）。
     */
    sendControl(instanceId, command) {
        const full = { ...command, id: randomUUID() };
        for (const handler of this.controlHandlers) {
            handler(full, instanceId);
        }
    }
    /** 注册控制指令接收者（agent 侧消费）。返回 disposer。 */
    onControl(handler) {
        this.controlHandlers.add(handler);
        return () => this.controlHandlers.delete(handler);
    }
    /** 心跳超时检查：超时实例标记离线；清除过期事件与确认记录。 */
    sweep() {
        const now = Date.now();
        for (const entry of this.instances.values()) {
            if (now - entry.lastSeen > this.config.heartbeatTimeoutMs) {
                entry.status = 'offline';
            }
        }
        for (const [id, ts] of this.eventTimes) {
            if (now - ts > EVENT_TTL_MS) {
                this.eventTimes.delete(id);
                this.ackedEvents.delete(id);
            }
        }
    }
}
function toIdentity(entry) {
    const { lastSeen: _lastSeen, ...identity } = entry;
    return identity;
}
/** 类插件入口：cordis 实例化时自动注册 `ctx.channel`（构造即注册，勿再 provide）。 */
export default ChannelService;
