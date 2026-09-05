# Agent Note: 主机页呈现"机器"而非 agent——name/ip + 主机/管理主机标识

Status: implemented

## Problem

主机页把 agent 名（host1）当主机名显示（"host1 · 守护 daemon"），用户指出：
"主机节点和 agent 没有半毛钱关系"——agent 是通信实现细节（channel relay 注册
名），UI/概念层不该暴露。且缺机器友好名与 IP。

## Decision

- **概念**：主机 = 机器（name + ip）；agent 名 = 内部寻址 ID，UI 不出现。
- HostRecord 加 `name?`（机器友好名）/ `ip?`（机器 IP）；listInstances 的 hosts
  构造从 `launch[h.id]` 读 name/ip（host 条目在 launch 配置独立成机器描述）。
- UI 主机页遍历 hostRecords：行 = [机器名] + 右上角「管理主机|主机」标识 + meta
  （ip · N 实例 · 在线）；管理端宿主（self 实例的 host）标「管理主机」，其它「主机」。
- launch 配置 host 条目补 name/ip（web2: host1 → 本机开发机/127.0.0.1）。

## Consequences

- 主机行不再出现 agent 名（host1 沉到内部）；机器名/IP 为展示主体。
- host 侧需实例重启加载新 listInstances（@Remote 启动时读 config）；UI 侧刷新即
  新 client，host 未重启时 name/ip 缺失回退显示 id。
- 测试 66（+1 listInstances hosts 返回 name/ip）。
