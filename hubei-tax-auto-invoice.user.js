// ==UserScript==
// @name         湖北税务自动开票助手
// @namespace    https://dppt.hubei.chinatax.gov.cn
// @version      0.2.0
// @description  自动点击"立即开票"，选择"电子发票"，票类选"普通发票"，点击确定
// @author       AutoScript
// @match        https://dppt.hubei.chinatax.gov.cn:8443/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  //  配置区 —— 如果按钮文本和实际不一致，改这里即可
  // ============================================================
  const CONFIG = {
    // "立即开票"按钮的可能文本（支持多种写法）
    openButton_texts: ['立即开票', '立即发票', '立即开具', '我要开具'],
    // "电子发票"选项文本
    electronic_text: '电子发票',
    // 票类下拉框相关的可能文本
    ticketType_label: '选择票类',
    ticketType_value: '普通发票',
    // 确定按钮的可能文本
    confirm_texts: ['确定', '确认', '下一步'],
    // 每步操作之间的等待时间（毫秒）
    stepDelay: 800,
    // 等待元素出现的最大时间（毫秒）
    waitTimeout: 10000,
  };

  // ============================================================
  //  工具函数
  // ============================================================

  // 控制台日志前缀
  const TAG = '[开票助手]';
  function log(...args) {
    console.log(TAG, ...args);
  }

  /**
   * 等待指定毫秒
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 在整个文档中查找包含指定文本的可点击元素
   * @param {string[]} texts - 可能的文本列表
   * @param {Element} [root] - 搜索根节点，默认 document.body
   * @returns {Element|null}
   */
  function findClickableByText(texts, root) {
    root = root || document.body;
    if (!root) return null;
    const textArr = Array.isArray(texts) ? texts : [texts];

    // 优先查找 button、a、input、[role=button] 等可点击标签
    const clickableSelectors = [
      'button',
      'a',
      '[role="button"]',
      '.el-button',       // Element UI
      '.ant-btn',         // Ant Design
      '.btn',
      'span.clickable',
      'li',
      'div[tabindex]',
    ];

    for (const selector of clickableSelectors) {
      const elements = root.querySelectorAll(selector);
      for (const el of elements) {
        const elText = (el.textContent || '').trim();
        for (const text of textArr) {
          if (elText === text || elText === text.replace(/\s+/g, '')) {
            // 排除不可见或不可点击的元素
            if (el.offsetParent !== null || el.getClientRects().length > 0) {
              return el;
            }
          }
        }
      }
    }

    // 退而求其次：查找所有元素
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
      const elText = (el.textContent || '').trim();
      for (const text of textArr) {
        // 精确匹配或去除空格后匹配
        if (elText === text || elText === text.replace(/\s+/g, '')) {
          // 确保元素可见
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            // 确保没有子元素也包含同样的完整文本（取最内层匹配）
            let hasChildWithSameText = false;
            for (const child of el.children) {
              if ((child.textContent || '').trim() === elText) {
                hasChildWithSameText = true;
                break;
              }
            }
            if (!hasChildWithSameText) {
              return el;
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * 模拟真实点击：先 mouseover -> mousedown -> mouseup -> click
   * @param {Element} el
   */
  function simulateClick(el) {
    const events = ['mouseover', 'mousedown', 'mouseup', 'click'];
    for (const eventType of events) {
      const event = new MouseEvent(eventType, {
        view: window,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(event);
    }
    // 兼容某些框架需要原生 click
    try {
      el.click();
    } catch (e) {
      // 忽略
    }
  }

  /**
   * 等待某个条件成立，超时则返回 null
   * @param {Function} conditionFn - 返回 Element 或 null
   * @param {number} timeout
   * @param {number} interval
   * @returns {Promise<Element|null>}
   */
  async function waitForElement(conditionFn, timeout, interval) {
    timeout = timeout || CONFIG.waitTimeout;
    interval = interval || 300;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const el = conditionFn();
      if (el) return el;
      await sleep(interval);
    }
    return null;
  }

  /**
   * 查找并选择下拉框选项
   * 针对 <select> 原生下拉框
   * @param {string} labelText - 下拉框旁的标签文本
   * @param {string} valueText - 要选择的选项文本
   */
  function selectNativeDropdown(labelText, valueText) {
    // 找到 select 元素
    const selects = document.querySelectorAll('select');
    for (const select of selects) {
      // 检查关联的 label
      const labels = document.querySelectorAll('label');
      for (const label of labels) {
        if (label.textContent.includes(labelText)) {
          const forId = label.getAttribute('for');
          if (forId && select.id === forId) {
            for (const option of select.options) {
              if (option.textContent.includes(valueText)) {
                select.value = option.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
            }
          }
        }
      }
      // 或者通过 aria-label / title 属性
      if (
        select.getAttribute('aria-label')?.includes(labelText) ||
        select.getAttribute('title')?.includes(labelText)
      ) {
        for (const option of select.options) {
          if (option.textContent.includes(valueText)) {
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * 查找最内层匹配指定文本的元素
   */
  function findInnermostElement(text, root) {
    root = root || document.body;
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
      const elText = (el.textContent || '').trim();
      if (elText === text || elText === text.replace(/\s+/g, '')) {
        let hasChild = false;
        for (const child of el.children) {
          if ((child.textContent || '').trim() === elText) {
            hasChild = true;
            break;
          }
        }
        if (!hasChild) return el;
      }
    }
    return null;
  }

  /**
   * 找到包含指定文本的标签元素（支持带红色星号 * 的情况）
   * 比如 "选择票类" 可能渲染为 "* 选择票类" 或 "<span>*</span> 选择票类"
   */
  function findLabelElement(labelText, root) {
    root = root || document.body;
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
      // 去除星号和空白后比较
      const elText = (el.textContent || '').trim().replace(/[*\s]/g, '');
      const target = labelText.replace(/[*\s]/g, '');
      if (elText === target) {
        let hasChild = false;
        for (const child of el.children) {
          if ((child.textContent || '').trim().replace(/[*\s]/g, '') === target) {
            hasChild = true;
            break;
          }
        }
        if (!hasChild) return el;
      }
    }
    return null;
  }

  /**
   * 从标签元素出发，找到关联的下拉框触发器（那个显示"请选择"的方框）
   */
  function findDropdownTrigger(labelEl) {
    if (!labelEl) return null;

    // 从 label 往上找，找到表单项容器
    let container = labelEl;
    for (let i = 0; i < 6 && container; i++) {
      container = container.parentElement;
      if (!container) break;

      // 策略1：查找常见 UI 库的下拉框 class
      const libSelectors = [
        '.el-select', '.el-select__wrapper', '.el-select .el-input__inner',
        '.ant-select', '.ant-select-selector', '.ant-select-selection-item',
        '[role="combobox"]', '[role="listbox"]',
        '.ivu-select', '.ivu-select-selection',
        '.n-select', '.n-base-selection',
        '.van-field', '.van-dropdown-menu',
      ];
      for (const sel of libSelectors) {
        const found = container.querySelector(sel);
        if (found && isVisible(found)) return found;
      }

      // 策略2：查找包含"请选择"文字的可点击元素（占位符）
      const allDescendants = container.querySelectorAll('*');
      for (const el of allDescendants) {
        const text = (el.textContent || '').trim();
        if ((text === '请选择' || text === '请选择 ') && isVisible(el)) {
          // 确保是最内层包含"请选择"的元素
          let hasChild = false;
          for (const child of el.children) {
            if ((child.textContent || '').trim().includes('请选择')) {
              hasChild = true;
              break;
            }
          }
          if (!hasChild) {
            // 往上找到真正可点击的容器（通常是 input 或 div）
            let clickTarget = el;
            for (let j = 0; j < 3; j++) {
              if (clickTarget.parentElement && clickTarget.parentElement !== container) {
                clickTarget = clickTarget.parentElement;
              }
            }
            return clickTarget;
          }
        }
      }

      // 策略3：查找 input 元素（可能是隐藏的或只读的）
      const inputs = container.querySelectorAll('input[type="text"], input:not([type]), [readonly], .fake-input');
      for (const input of inputs) {
        if (isVisible(input)) return input;
      }
    }

    return null;
  }

  /**
   * 判断元素是否可见
   */
  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    return true;
  }

  /**
   * 针对自定义下拉框 —— 点击触发器 → 等待选项弹出 → 点击目标选项
   * @param {string} labelText - 下拉框标签文本（如"选择票类"）
   * @param {string} valueText - 要选择的选项文本（如"普通发票"）
   */
  async function selectCustomDropdown(labelText, valueText) {
    log('查找下拉框标签:', labelText);

    // 1. 找到标签元素
    const labelEl = findLabelElement(labelText);
    if (!labelEl) {
      log('❌ 未找到标签:', labelText);
      log('页面中所有包含"选择"的元素：');
      document.querySelectorAll('*').forEach((el) => {
        const t = (el.textContent || '').trim();
        if (t.includes('选择') && t.length < 20) {
          let hasChild = false;
          for (const child of el.children) {
            if ((child.textContent || '').trim() === t) { hasChild = true; break; }
          }
          if (!hasChild) log('  -', t, '|', el.tagName, el.className);
        }
      });
      return false;
    }
    log('✅ 找到标签元素:', labelText, '|', labelEl.tagName, labelEl.className);

    // 2. 找到下拉框触发器
    let trigger = findDropdownTrigger(labelEl);
    if (!trigger) {
      log('❌ 未找到下拉框触发器（显示"请选择"的方框）');
      // 打印标签附近的 HTML 结构帮助调试
      let parent = labelEl.parentElement;
      for (let i = 0; i < 3 && parent; i++) {
        log('父级层', i, ':', parent.tagName, parent.className, '子元素数:', parent.children.length);
        for (const child of parent.children) {
          const text = (child.textContent || '').trim().substring(0, 30);
          log('  └─', child.tagName, child.className, '|', text);
        }
        parent = parent.parentElement;
      }
      return false;
    }
    log('✅ 找到下拉框触发器:', trigger.tagName, trigger.className);

    // 3. 点击触发器展开下拉选项
    log('点击下拉框触发器...');
    simulateClick(trigger);
    await sleep(CONFIG.stepDelay + 400); // 给下拉动画多一点时间

    // 4. 等待并查找下拉选项面板中的目标选项
    //    选项面板可能是动态创建的浮层，出现在 body 末尾或组件附近
    const optionSelectors = [
      '.el-select-dropdown__item',
      '.ant-select-item-option',
      '.ant-select-item',
      '[role="option"]',
      '[role="listbox"] li',
      '.ivu-select-item',
      '.n-select-menu .n-base-select-option',
      '.dropdown-item',
      '.select-option',
      'li[role="option"]',
      '.v-select-item',
      '.el-autocomplete-suggestion li',
    ];

    // 用 waitForElement 轮询等待选项出现
    const optionEl = await waitForElement(() => {
      // 策略1：按已知 class 查找
      for (const sel of optionSelectors) {
        const opts = document.querySelectorAll(sel);
        for (const opt of opts) {
          if (!isVisible(opt)) continue;
          if (opt.textContent.trim().includes(valueText)) {
            // 确保是最内层
            let hasChild = false;
            for (const child of opt.children) {
              if ((child.textContent || '').trim().includes(valueText)) { hasChild = true; break; }
            }
            if (!hasChild) return opt;
          }
        }
      }

      // 策略2：查找所有可见的浮层元素中的选项
      const popups = document.querySelectorAll(
        '.el-select-dropdown, .ant-select-dropdown, .el-popper, .ant-select-dropdown-placement-bottomLeft, ' +
        '[role="listbox"], .ivu-select-dropdown, .n-select-menu, .v-dropdown-menu, .popover, .float-panel'
      );
      for (const pop of popups) {
        if (!isVisible(pop)) continue;
        const items = pop.querySelectorAll('*');
        for (const item of items) {
          const text = (item.textContent || '').trim();
          if (text === valueText || text === valueText.replace(/\s+/g, '')) {
            let hasChild = false;
            for (const child of item.children) {
              if ((child.textContent || '').trim() === text) { hasChild = true; break; }
            }
            if (!hasChild) return item;
          }
        }
      }

      // 策略3：暴力搜索 —— 点击下拉后页面上新出现的包含目标文本的可点击元素
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const text = (el.textContent || '').trim();
        if (text === valueText || text === valueText.replace(/\s+/g, '')) {
          if (!isVisible(el)) continue;
          let hasChild = false;
          for (const child of el.children) {
            if ((child.textContent || '').trim() === text) { hasChild = true; break; }
          }
          if (!hasChild) {
            // 排除表单中已选中的值显示（通常在 input 里）
            if (el.tagName === 'INPUT') continue;
            return el;
          }
        }
      }

      return null;
    }, CONFIG.waitTimeout, 300);

    if (!optionEl) {
      log('❌ 下拉框已展开，但未找到选项:', valueText);
      log('页面上所有可见浮层的选项文本：');
      const popups = document.querySelectorAll('[role="listbox"], .el-select-dropdown, .ant-select-dropdown, .el-popper');
      popups.forEach((pop) => {
        if (!isVisible(pop)) return;
        log('  浮层:', pop.tagName, pop.className);
        pop.querySelectorAll('*').forEach((item) => {
          const t = (item.textContent || '').trim();
          if (t && t.length < 20) {
            let hasChild = false;
            for (const child of item.children) {
              if ((child.textContent || '').trim() === t) { hasChild = true; break; }
            }
            if (!hasChild) log('    └─', t);
          }
        });
      });
      return false;
    }

    log('✅ 找到选项:', valueText, '|', optionEl.tagName, optionEl.className);
    simulateClick(optionEl);
    await sleep(CONFIG.stepDelay);
    return true;
  }

  // ============================================================
  //  主流程
  // ============================================================

  async function main() {
    log('脚本启动，开始执行自动化开票流程...');

    // 确保页面已加载
    await sleep(1500);

    // ---------- 第一步：点击"立即开票" ----------
    log('【步骤1/4】查找并点击"立即开票"按钮...');
    const openBtn = await waitForElement(() =>
      findClickableByText(CONFIG.openButton_texts)
    );

    if (!openBtn) {
      log('❌ 未找到"立即开票"按钮，可能页面还未加载完成或文本不匹配。');
      log('当前页面上所有可点击元素文本：');
      document.querySelectorAll('button, a, [role="button"], .el-button, .ant-btn').forEach((el) => {
        const t = (el.textContent || '').trim();
        if (t) log('  -', t);
      });
      return;
    }

    log('✅ 找到按钮:', openBtn.textContent.trim());
    simulateClick(openBtn);
    await sleep(CONFIG.stepDelay);

    // ---------- 第二步：选择"电子发票" ----------
    log('【步骤2/4】查找并选择"电子发票"...');
    const elecOption = await waitForElement(() =>
      findClickableByText([CONFIG.electronic_text])
    );

    if (!elecOption) {
      log('❌ 未找到"电子发票"选项。');
      return;
    }

    log('✅ 找到选项:', elecOption.textContent.trim());
    simulateClick(elecOption);
    await sleep(CONFIG.stepDelay);

    // ---------- 第三步：选择票类为"普通发票" ----------
    log('【步骤3/4】选择票类为"普通发票"...');

    // 先尝试原生 select
    let selected = selectNativeDropdown(CONFIG.ticketType_label, CONFIG.ticketType_value);

    // 如果原生 select 不行，尝试自定义下拉框
    if (!selected) {
      selected = await selectCustomDropdown(CONFIG.ticketType_label, CONFIG.ticketType_value);
    }

    if (!selected) {
      log('❌ 未能选择票类。请检查下拉框标签文本是否为"选择票类"，以及选项中是否包含"普通发票"。');
      return;
    }

    log('✅ 票类已选择:', CONFIG.ticketType_value);
    await sleep(CONFIG.stepDelay);

    // ---------- 第四步：点击"确定" ----------
    log('【步骤4/4】查找并点击"确定"按钮...');
    const confirmBtn = await waitForElement(() =>
      findClickableByText(CONFIG.confirm_texts)
    );

    if (!confirmBtn) {
      log('❌ 未找到"确定"按钮。');
      return;
    }

    log('✅ 找到确定按钮:', confirmBtn.textContent.trim());
    simulateClick(confirmBtn);

    log('🎉 全部步骤执行完毕！');
  }

  // ============================================================
  //  入口：监听页面 URL 变化（SPA 路由切换时也能触发）
  // ============================================================

  let lastUrl = location.href;
  let hasRun = false;

  // URL 变化时重新检测
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      log('检测到页面跳转:', lastUrl);
      hasRun = false;
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });

  // 自动执行 + 提供手动触发入口
  function tryRun() {
    if (hasRun) return;
    // 只在目标页面执行
    if (location.href.includes('blue-invoice-makeout')) {
      hasRun = true;
      main().catch((err) => log('执行出错:', err));
    }
  }

  // 页面加载后延迟执行
  setTimeout(tryRun, 2000);

  // 暴露到 window 方便手动调用调试
  window.__invoiceHelper = {
    run: main,
    config: CONFIG,
    findClickable: findClickableByText,
    findLabel: findLabelElement,
    findTrigger: findDropdownTrigger,
    selectDropdown: selectCustomDropdown,
    log: log,
  };
  log('脚本已加载 v0.2.0。如需手动执行，在控制台输入 __invoiceHelper.run()');
  log('调试：__invoiceHelper.findLabel("选择票类") 可测试标签查找');
  log('调试：__invoiceHelper.selectDropdown("选择票类","普通发票") 可单独测试下拉框');
})();
