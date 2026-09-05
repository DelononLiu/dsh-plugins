# Agent Note: 实例行/总览显示机器名（补完主机概念去 agent 化）

Status: implemented

## Problem

上一提交（主机页 name/ip）只改了主机页行，但**实例列表行与总览页**的实例归属
仍显示 agent 名（item.host = host1）——"三个页面没更新"（用户反馈），agent
概念残留。

## Decision

- ConsolePanel 加 `machineNameOf(hostId)` helper：hostRecords 按 hr.id 匹配取
  name，未知回退 hostId。
- InstanceRow 增加 `machineName?` prop：meta 行显示机器名（不再 item.host）。
- 总览手写行改用 machineNameOf(i.host)。
- 实例列表/升级列表（同一份 instances.map + InstanceRow）透传 machineName。

## Consequences

- 实例行 meta：host1 → 本机开发机；总览实例行同样映射。
- 纯 client UI；host 侧数据已由前一提交提供（listInstances.hosts name/ip）。
- 测试 66 不变（client UI 无单测，浏览器实测通过）。
