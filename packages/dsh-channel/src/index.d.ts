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
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** 实例基础身份（实例服务提供者——实例首先是通信层发现的实体）。 */
export interface InstanceIdentity {
    /** 稳定实例 id。 */
    id: string;
    /** 展示名。 */
    name: string;
    /** 可达地址（跳转/连接用）。 */
    addr: string;
    /** 在线状态（由心跳维护）。 */
    status: 'online' | 'offline';
    /** 健康状态（可选）。 */
    health?: string;
    /** 发行包版本。 */
    version?: string;
}
/** 事件三平面（已定）：control 控制指令 / task 幂等投递 / session 仅显式共享。 */
export type EventPlane = 'control' | 'task' | 'session';
/** 一条通道事件。 */
export interface ChannelEvent<P = unknown> {
    /** 消息 id（幂等去重键）。 */
    id: string;
    /** 所在平面。 */
    plane: EventPlane;
    /** 事件类型（平面内区分）。 */
    type: string;
    /** 载荷。 */
    payload: P;
    /** 产生时间（epoch ms）。 */
    ts: number;
    /** 存活毫秒（过期清理）。 */
    ttl: number;
}
/** 控制指令。 */
export interface ControlCommand<P = unknown> {
    /** 指令类型（deploy/create-instance/stop/start/upgrade…）。 */
    type: string;
    /** 载荷。 */
    payload: P;
    /** 指令 id（幂等回执）。 */
    id: string;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        channel: ChannelService;
    }
}
/** 插件配置：实例令牌 + 心跳超时。 */
export interface Config {
    /** 实例令牌映射：{instanceId: token}——bootstrap 时注入 agent，注册/心跳校验。 */
    tokens: Record<string, string>;
    /** 心跳超时（ms），超时判定离线。默认 30000。 */
    heartbeatTimeoutMs: number;
}
/** 运行时 schema。 */
export declare const Config: z<Config>;
/** 事件默认 TTL（7 天，已定投递语义）。 */
export declare const EVENT_TTL_MS: number;
/**
 * 通信服务（实例服务提供者 + 事件总线 + 控制指令）。所有插件经 `ctx.channel`
 * 注册/发现实例、收发事件与控制指令。
 */
export declare class ChannelService extends Service {
    private readonly config;
    static Config: z<Config>;
    /** 已知实例表（id → 含心跳时间的条目）。 */
    private readonly instances;
    /** 事件订阅者：plane → handler 集合。 */
    private readonly subscribers;
    /** 控制指令接收者。 */
    private readonly controlHandlers;
    /** 事件 id → 产生时间（幂等去重 + TTL 清理）。 */
    private readonly eventTimes;
    /** 已确认事件 id（幂等回执）。 */
    private readonly ackedEvents;
    constructor(ctx: Context, config: Config);
    /**
     * 注册实例（agent 上线时调用）。校验实例令牌；重复注册刷新状态。
     * @param instance - 实例基础身份。
     * @param token - 实例令牌（bootstrap 注入；不匹配抛错）。
     */
    register(instance: InstanceIdentity, token: string): void;
    /**
     * 心跳上报（agent 周期调用）。未知实例或令牌不匹配抛错。
     * @param instanceId - 实例 id。
     * @param token - 实例令牌。
     */
    heartbeat(instanceId: string, token: string): void;
    /**
     * 发现：列出全部已知实例（含离线——离线由心跳超时标记）。
     * @returns 实例基础身份列表。
     */
    list(): InstanceIdentity[];
    /** 查询单个实例；未知返回 undefined。 */
    get(instanceId: string): InstanceIdentity | undefined;
    /**
     * 发布事件（at-least-once 投递语义的进程内实现）：自动生成消息 id（幂等
     * 去重键），按 TTL 清理。跨实例投递由传输层消费同一接口。
     * @param plane - 事件平面（control/task/session）。
     * @param type - 事件类型。
     * @param payload - 载荷。
     * @param ttl - 存活毫秒（默认 7 天）。
     * @returns 事件 id（订阅方可回执/去重）。
     */
    emit<P = unknown>(plane: EventPlane, type: string, payload: P, ttl?: number): string;
    /**
     * 订阅某平面事件（进程内）。返回解除订阅 disposer。
     * @param plane - 事件平面。
     * @param handler - 处理函数。
     * @returns disposer。
     */
    subscribe(plane: EventPlane, handler: (event: ChannelEvent) => void): () => void;
    /**
     * 已处理消息确认（幂等回执）：同一事件 id 首次确认返回 true，重复返回
     * false——消费方对重复投递跳过处理。
     * @param eventId - 消息 id。
     * @returns 是否首次确认。
     */
    ack(eventId: string): boolean;
    /**
     * 发送控制指令到某实例（远程管理；v1 进程内回环——跨实例经传输层）。
     * @param instanceId - 目标实例 id。
     * @param command - 指令（不含 id，自动生成幂等 id）。
     */
    sendControl<P = unknown>(instanceId: string, command: Omit<ControlCommand<P>, 'id'>): void;
    /** 注册控制指令接收者（agent 侧消费）。返回 disposer。 */
    onControl(handler: (command: ControlCommand, instanceId: string) => void): () => void;
    /** 心跳超时检查：超时实例标记离线；清除过期事件与确认记录。 */
    private sweep;
}
/** 类插件入口：cordis 实例化时自动注册 `ctx.channel`（构造即注册，勿再 provide）。 */
export default ChannelService;
