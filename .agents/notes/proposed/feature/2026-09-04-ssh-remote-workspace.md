# Agent Note: 社区 SSH 远程工作区插件调研——可引入候选与实测清单

Status: proposed（2026-09-04）

## 问题

用户问："社区的 ssh 远程工作区插件，是否可用搞进来。"此前 v2"远程工作区（跨实例
会话共享）"判定官方无概念、社区无真实现；本调研复核 + 扩大检索后**修正该判断**：
社区存在真"SSH 远程工作区"插件（执行面 Model A），部分 npm MIT 可装。

## 调研结论（primary source：GitHub/npm，2026-09-04）

先分清三条轴（见 community-reference.md 新增节，逐包一手核实）：

1. **远程访问面**：@linxin666/dsh-remote-web-ui（0.3.13，Apache-2.0）= 把本机 dsh web
   经 QR 配对暴露给手机/PC（cloudflared 隧道）。**不是工作区**，但证明社区已有
   **cookie-less 配对链绕过官方 BrowserAuth 401**（/pair-accept→/pair-app，插件自
   serve 官方 shell）——"官方会话桥"的一种社区实现证据，可参考。
2. **SSH 运维**：@linxin666/dsh-ssh（0.3.13，Apache-2.0，已在发行包依赖）＝终端/
   SFTP/127.0.0.1 端口转发/集群。非工作区；其端口转发可作"SSH 转发他机 dsh 端口→
   本机开 UI"的手工轻量路径。
3. **远程工作区/执行面（本调研真正命中）**：
   - [flymysql/dsh-remote](https://github.com/flymysql/dsh-remote)（npm dsh-remote
     v0.8.12，MIT，55★，2026-09-03 活跃）：SSH 连远端→选远程工作区→`rw_*` 工具操作
     →SFTP 镜像成本地真实 DSH 工作区。Model A 最典型；`engines` 未声明、cslht fork
     曾为 rc.2 适配 → rc 兼容有门槛；依赖 dsh-better-sidebar（已 vendored）。
   - [DobyChao/dsh-workspace-enhancement](https://github.com/DobyChao/dsh-workspace-enhancement)
     （npm dsh-workspace-enhancement，MIT，0★ 新，2026-08-31）：`ctx.subprocess`+
     `ctx.fs` 透明远程 provider（单 SSH 链多跳）→ tools 零改动可操作远端；会话可挂
     多个 side workspace（`fs: ro/rw` + `exec: on/off` 权限）+ `sw_exec` 跨服务器；
     TOFU 主机钥。**架构最贴合我们"远程工作区进会话"模型**。
   - dsh-ssh/dsh-ssh（GitHub-only，MIT）：bash/file/search 工具面最小集，作参考；
     无 npm（名冲突）→ 按 vendoring policy 不入。

## 判定

- **可引入候选 = flymysql/dsh-remote 与 DobyChao/dsh-workspace-enhancement**（npm
  MIT 可装、patch 层不 fork）。二者是"实例内把远端机目录挂成 agent 工作区"的执行面
  插件，与我们 console/daemon **多实例管理面正交**：一个管"实例之间/管理"，一个管
  "单个实例里连外机干活"——共存无冲突。
- 不是"另一个入口直接装进发行包默认"就完事：需先 **rc.1 隔离实测**（bundle 200、
  host 面注入、ctx.fs/ctx.subprocess provider 是否真代理远端、与官方 BrowserAuth
  fence / our dsh-desk 组装器入口的关系、依赖冲突），再按需 cordis.patch.yml 裁剪
  （cslht fork 曾为 rc 适配打补丁 = 门槛真实存在）。
- 若用户真实诉求只是"方便打开/跳到他机 dsh web"，现有实例跳转（+可选 dsh-ssh
  127.0.0.1 隧道）已覆盖，不必引第三方工作区插件。

## 下一步（引入实测清单，供拍板后执行）

1. worktree/test profile 隔离实测 **DobyChao/dsh-workspace-enhancement**（provider
   形态最贴合）：npm 装 → web2 类 profile 重启 → bundle 200/零报错 →
   建 SSH 机（127.0.0.1 本机 mock 远端）→ 会话挂 side workspace → agent `sw_*`/读写
   远端文件 → 权限 ro/rw 生效。
2. 同法实测 **flymysql/dsh-remote**（SFTP 镜像语义：本地改动是否回写远端、冲突处理）。
3. 对比后二选一 vendored（锁版本 + patch 裁剪 + 入口按 dsh-desk 组装器摆位），或仅
   保留参考 + 记录差距。

相关：[community-reference.md](../../../../docs/community-reference.md)「SSH 远程工作区」节 ·
[multi-dsh-collaboration](../architecture/2026-09-03-multi-dsh-collaboration.md)（v2 远程工作区）·
[alpha5-auth 会话桥](../architecture/2026-09-03-alpha5-auth-official-token-vs-user-login.md)
（cookie-less 配对 = 会话桥参考）
