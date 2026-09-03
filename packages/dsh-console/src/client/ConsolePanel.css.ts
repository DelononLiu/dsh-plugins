/**
 * dsh-console 控制台面板样式：照抄官方 settings 面板契约
 * （ui-settings-general SettingsRoot.module.css），模块顶层注入 style 标签
 * （bundle 加载即执行，与 ConsoleBadge 同机制）。token 用官方
 * --dsw-alias-* 变量（深色/浅色主题自动适配套）。
 */
const css = `
.dsh-console-panel-overlay{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center}
.dsh-console-panel-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur)}
.dsh-console-panel{position:relative;z-index:1;display:flex;width:min(880px,calc(100vw - 48px));height:min(720px,calc(100vh - 48px));border-radius:24px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-shadow-lv3);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dsh-console-nav{flex:none;display:flex;flex-direction:column;gap:18px;width:190px;padding:22px 12px 0;box-sizing:border-box;border-right:1px solid var(--dsw-alias-border-l1)}
.dsh-console-nav-brand{display:flex;align-items:center;gap:8px;padding:4px 14px 14px;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-console-nav-title{padding:0 14px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);font-weight:500}
.dsh-console-nav-list{display:flex;flex-direction:column;gap:4px}
.dsh-console-nav-cell{display:flex;align-items:center;gap:10px;height:40px;padding:0 16px 0 12px;box-sizing:border-box;border:none;border-radius:12px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:14px;line-height:22px;cursor:pointer;text-align:left}
.dsh-console-nav-cell:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-console-nav-cell.active{background:var(--dsw-specific-sidebar-nav-item-active);color:var(--dsw-alias-label-primary);font-weight:500}
.dsh-console-nav-icon{flex:none}
.dsh-console-nav-foot{margin-top:auto;padding:14px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.7}
.dsh-console-content{flex:1;display:flex;flex-direction:column;min-width:0}
.dsh-console-header{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;height:54px;padding:18px 20px 8px 22px;box-sizing:border-box}
.dsh-console-title{font-size:17px;line-height:24px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-console-close{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:28px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-primary)}
.dsh-console-close:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-console-options{flex:1;min-height:0;padding:14px 24px 24px;overflow-y:auto}
.dsh-console-sect{display:flex;align-items:center;justify-content:space-between;margin:4px 0 12px}
.dsh-console-sect h3{font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dsh-console-more{font-size:12px;color:var(--dsw-alias-brand-primary);background:none;border:none;cursor:pointer;padding:0}
.dsh-console-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.dsh-console-stat{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:14px 16px;box-sizing:border-box}
.dsh-console-stat-n{font-size:28px;font-weight:650;line-height:1.1;letter-spacing:-.5px;color:var(--dsw-alias-label-primary)}
.dsh-console-stat-l{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:2px}
.dsh-console-stat-d{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:6px}
.dsh-console-row{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:12px;margin-bottom:8px;box-sizing:border-box}
.dsh-console-row:hover{border-color:var(--dsw-alias-border-l2)}
.dsh-console-row.sel{border-color:var(--dsw-alias-brand-primary)}
.dsh-console-row .dot{width:8px;height:8px;border-radius:50%;flex:none}
.dsh-console-row .dot.on{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 4px rgba(74,222,128,.12)}
.dsh-console-row .dot.off{background:var(--dsw-alias-label-tertiary)}
.dsh-console-row .grow{flex:1;min-width:0}
.dsh-console-row .name{font-size:14px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dsh-console-row .meta{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-console-ver{font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 9px;white-space:nowrap}
.dsh-console-btn{border:none;border-radius:8px;font-size:12px;padding:6px 12px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;font-family:inherit;background:transparent;color:var(--dsw-alias-label-secondary)}
.dsh-console-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-console-btn.primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);font-weight:600}
.dsh-console-btn.primary:hover{background:var(--dsw-alias-button-primary-hover)}
.dsh-console-btn.danger:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-console-toolbar{display:flex;align-items:center;gap:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:10px 12px;margin-bottom:14px;box-sizing:border-box}
.dsh-console-toolbar .grow{flex:1}
.dsh-console-toolbar .hint{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-console-field{margin-bottom:16px}
.dsh-console-field label{display:block;font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:6px;font-weight:500}
.dsh-console-input{width:100%;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;padding:10px 12px;outline:none;box-sizing:border-box}
.dsh-console-input:focus{border-color:var(--dsw-alias-brand-primary)}
.dsh-console-formrow{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.dsh-console-steps{display:flex;gap:6px;margin-top:22px}
.dsh-console-step{flex:1;position:relative;padding-top:30px;box-sizing:border-box}
.dsh-console-step:before{content:"";position:absolute;top:6px;left:0;right:0;height:3px;background:var(--dsw-alias-border-l2)}
.dsh-console-step:first-child:before{left:20%;right:0}
.dsh-console-step:last-child:before{left:0;right:20%}
.dsh-console-step .b{position:absolute;left:20%;top:0;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);border:2px solid var(--dsw-alias-border-l2);z-index:1}
.dsh-console-step.done .b{background:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.dsh-console-step.doing .b{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 4px rgba(96,165,250,.25)}
.dsh-console-step .c{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.dsh-console-step.done .c{color:var(--dsw-alias-label-primary)}
.dsh-console-code{margin-top:24px;padding:14px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;font-size:12px;color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code);white-space:pre-wrap;word-break:break-all}
.dsh-console-chk{width:18px;height:18px;border-radius:5px;border:1.5px solid var(--dsw-alias-border-l2);flex:none;display:flex;align-items:center;justify-content:center;font-size:12px;color:transparent}
.dsh-console-row.sel .dsh-console-chk{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted)}
.dsh-console-badge{font-size:11px;padding:2px 8px;border-radius:999px}
.dsh-console-badge.idle{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1)}
.dsh-console-badge.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 15%,transparent);color:var(--dsw-alias-state-success-primary)}
.dsh-console-badge.run{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 15%,transparent);color:var(--dsw-alias-brand-primary)}
.dsh-console-badge.fail{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 15%,transparent);color:var(--dsw-alias-state-error-primary)}
.dsh-console-select{width:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;padding:7px 10px;outline:none}
`

/** 幂等注入样式（bundle 加载即执行）。 */
export function injectConsolePanelCss(): () => void {
  if (typeof document === 'undefined' || document.querySelector('style[data-plugin-css="@dsh-console/panel"]')) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-console'
  tag.dataset.pluginCss = '@dsh-console/panel'
  tag.textContent = css
  document.head.appendChild(tag)
  return () => tag.remove()
}

// 模块顶层注入（bundle 加载即执行；不通过组件——样式全局一次性）。
injectConsolePanelCss()
