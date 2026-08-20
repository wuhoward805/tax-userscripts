// ==UserScript==
// @name         发票信息识别填表 Demo
// @namespace    https://dppt.hubei.chinatax.gov.cn
// @version      0.1.0
// @description  Demo：上传发票图片 → OCR识别 → 自动填入开票页面表单
// @author       AutoScript
// @match        https://dppt.hubei.chinatax.gov.cn:8443/*
// @require      https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[发票填表Demo]';
  const log = (...a) => console.log(TAG, ...a);

  // ============================================================
  //  样式
  // ============================================================
  GM_addStyle(`
    #inv-panel {
      position: fixed; top: 80px; right: 20px; width: 360px;
      background: #fff; border: 1px solid #d9d9d9; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15); z-index: 999999;
      font-family: -apple-system, "Microsoft YaHei", sans-serif;
      font-size: 13px; color: #333; max-height: 85vh; overflow-y: auto;
    }
    #inv-panel .inv-header {
      background: #4A90E2; color: #fff; padding: 10px 14px;
      font-weight: 600; border-radius: 8px 8px 0 0; cursor: move;
      display: flex; justify-content: space-between; align-items: center;
    }
    #inv-panel .inv-body { padding: 14px; }
    #inv-panel .inv-section { margin-bottom: 14px; }
    #inv-panel .inv-section-title {
      font-weight: 600; margin-bottom: 8px; color: #4A90E2;
      font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;
    }
    #inv-panel .inv-upload-zone {
      border: 2px dashed #d9d9d9; border-radius: 6px; padding: 20px;
      text-align: center; cursor: pointer; color: #999; transition: all 0.2s;
    }
    #inv-panel .inv-upload-zone:hover { border-color: #4A90E2; color: #4A90E2; }
    #inv-panel .inv-upload-zone.has-image { padding: 0; border-style: solid; }
    #inv-panel .inv-upload-zone img { max-width: 100%; border-radius: 4px; display: block; }
    #inv-panel .inv-btn {
      display: inline-block; padding: 7px 16px; border: none; border-radius: 4px;
      cursor: pointer; font-size: 13px; margin-right: 6px; transition: all 0.2s;
    }
    #inv-panel .inv-btn-primary { background: #4A90E2; color: #fff; }
    #inv-panel .inv-btn-primary:hover { background: #3a7bc8; }
    #inv-panel .inv-btn-secondary { background: #f0f0f0; color: #333; }
    #inv-panel .inv-btn-secondary:hover { background: #e0e0e0; }
    #inv-panel .inv-btn:disabled { background: #ccc; cursor: not-allowed; }
    #inv-panel .inv-field { margin-bottom: 8px; }
    #inv-panel .inv-field-label { font-size: 12px; color: #666; margin-bottom: 2px; }
    #inv-panel .inv-field-input {
      width: 100%; padding: 6px 8px; border: 1px solid #d9d9d9;
      border-radius: 4px; font-size: 13px; box-sizing: border-box;
    }
    #inv-panel .inv-field-input:focus { border-color: #4A90E2; outline: none; }
    #inv-panel .inv-status {
      padding: 8px 10px; border-radius: 4px; margin-bottom: 10px; font-size: 12px;
    }
    #inv-panel .inv-status-info { background: #e6f7ff; color: #1890ff; border: 1px solid #91d5ff; }
    #inv-panel .inv-status-success { background: #f6ffed; color: #52c41a; border: 1px solid #b7eb8f; }
    #inv-panel .inv-status-error { background: #fff2f0; color: #ff4d4f; border: 1px solid #ffccc7; }
    #inv-panel .inv-status-warning { background: #fffbe6; color: #faad14; border: 1px solid #ffe58f; }
    #inv-panel .inv-raw-text {
      background: #f9f9f9; border: 1px solid #eee; border-radius: 4px;
      padding: 8px; font-size: 11px; max-height: 120px; overflow-y: auto;
      white-space: pre-wrap; word-break: break-all; color: #666;
    }
    #inv-panel .inv-fill-log {
      font-size: 11px; color: #666; margin-top: 6px;
      max-height: 100px; overflow-y: auto;
    }
    #inv-panel .inv-fill-log .ok { color: #52c41a; }
    #inv-panel .inv-fill-log .fail { color: #ff4d4f; }
    #inv-panel .inv-close { cursor: pointer; font-size: 18px; opacity: 0.8; }
    #inv-panel .inv-close:hover { opacity: 1; }
    #inv-panel .inv-tabs {
      display: flex; margin-bottom: 10px; border-bottom: 1px solid #eee;
    }
    #inv-panel .inv-tab {
      padding: 6px 12px; cursor: pointer; font-size: 12px; color: #666;
      border-bottom: 2px solid transparent;
    }
    #inv-panel .inv-tab.active { color: #4A90E2; border-bottom-color: #4A90E2; }
    #inv-panel .inv-tab-content { display: none; }
    #inv-panel .inv-tab-content.active { display: block; }
    #inv-panel .inv-mock-btn {
      font-size: 11px; color: #4A90E2; cursor: pointer; text-decoration: underline;
      margin-left: 8px;
    }
  `);

  // ============================================================
  //  UI 构建
  // ============================================================
  function buildUI() {
    const panel = document.createElement('div');
    panel.id = 'inv-panel';
    panel.innerHTML = `
      <div class="inv-header">
        <span>发票识别填表 Demo</span>
        <span class="inv-close" id="inv-close">&times;</span>
      </div>
      <div class="inv-body">

        <div class="inv-tabs">
          <div class="inv-tab active" data-tab="ocr">📷 图片识别</div>
          <div class="inv-tab" data-tab="manual">✍️ 手动输入</div>
        </div>

        <!-- OCR Tab -->
        <div class="inv-tab-content active" data-content="ocr">
          <div class="inv-section">
            <div class="inv-section-title">上传发票图片</div>
            <div class="inv-upload-zone" id="inv-upload-zone">
              点击或拖拽图片到这里<br><span style="font-size:11px">支持 jpg / png</span>
            </div>
            <input type="file" id="inv-file-input" accept="image/*" style="display:none">
          </div>

          <div class="inv-section">
            <button class="inv-btn inv-btn-primary" id="inv-ocr-btn" disabled>开始识别</button>
            <button class="inv-btn inv-btn-secondary" id="inv-clear-btn">清空</button>
          </div>

          <div id="inv-status-area"></div>

          <div class="inv-section" id="inv-raw-section" style="display:none">
            <div class="inv-section-title">识别原始文本</div>
            <div class="inv-raw-text" id="inv-raw-text"></div>
          </div>
        </div>

        <!-- Manual Tab -->
        <div class="inv-tab-content" data-content="manual">
          <div class="inv-section">
            <div class="inv-section-title">
              发票信息
              <span class="inv-mock-btn" id="inv-mock-btn">填入示例数据</span>
            </div>
            <div class="inv-field">
              <div class="inv-field-label">购买方名称</div>
              <input class="inv-field-input" id="f-name" placeholder="如：武汉某某科技有限公司">
            </div>
            <div class="inv-field">
              <div class="inv-field-label">纳税人识别号</div>
              <input class="inv-field-input" id="f-taxid" placeholder="如：91420100MA4K...">
            </div>
            <div class="inv-field">
              <div class="inv-field-label">地址 / 电话</div>
              <input class="inv-field-input" id="f-addr" placeholder="如：武汉市洪山区... 027-8xxx">
            </div>
            <div class="inv-field">
              <div class="inv-field-label">开户行 / 账号</div>
              <input class="inv-field-input" id="f-bank" placeholder="如：中国银行武汉分行 ...">
            </div>
          </div>
        </div>

        <!-- 公共区域：填表按钮 -->
        <div class="inv-section">
          <button class="inv-btn inv-btn-primary" id="inv-fill-btn">📋 填入开票页面</button>
        </div>

        <div class="inv-fill-log" id="inv-fill-log"></div>

      </div>
    `;
    document.body.appendChild(panel);

    bindEvents();
    log('Demo 面板已加载');
  }

  // ============================================================
  //  事件绑定
  // ============================================================
  function bindEvents() {
    // 关闭
    document.getElementById('inv-close').addEventListener('click', () => {
      document.getElementById('inv-panel').remove();
    });

    // Tab 切换
    document.querySelectorAll('#inv-panel .inv-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#inv-panel .inv-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('#inv-panel .inv-tab-content').forEach((c) => c.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.getAttribute('data-tab');
        document.querySelector(`#inv-panel [data-content="${target}"]`).classList.add('active');
      });
    });

    // 上传图片
    const uploadZone = document.getElementById('inv-upload-zone');
    const fileInput = document.getElementById('inv-file-input');
    const ocrBtn = document.getElementById('inv-ocr-btn');

    uploadZone.addEventListener('click', () => fileInput.click());

    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.style.borderColor = '#4A90E2';
    });
    uploadZone.addEventListener('dragleave', () => {
      uploadZone.style.borderColor = '';
    });
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.style.borderColor = '';
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        handleImageFile(file);
      }
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleImageFile(file);
    });

    // OCR 识别
    ocrBtn.addEventListener('click', runOCR);

    // 清空
    document.getElementById('inv-clear-btn').addEventListener('click', () => {
      document.getElementById('inv-upload-zone').innerHTML = '点击或拖拽图片到这里<br><span style="font-size:11px">支持 jpg / png</span>';
      document.getElementById('inv-upload-zone').classList.remove('has-image');
      document.getElementById('inv-file-input').value = '';
      document.getElementById('inv-ocr-btn').disabled = true;
      document.getElementById('inv-status-area').innerHTML = '';
      document.getElementById('inv-raw-section').style.display = 'none';
      currentImageBase64 = null;
    });

    // 填入示例数据
    document.getElementById('inv-mock-btn').addEventListener('click', () => {
      document.getElementById('f-name').value = '武汉光谷科技有限公司';
      document.getElementById('f-taxid').value = '91420100MA4K3X9Y2Z';
      document.getElementById('f-addr').value = '武汉市洪山区光谷大道77号 027-87654321';
      document.getElementById('f-bank').value = '中国银行武汉光谷支行 8201 2345 6789 0123';
    });

    // 填入页面
    document.getElementById('inv-fill-btn').addEventListener('click', fillForm);

    // 拖拽面板
    makeDraggable();
  }

  // ============================================================
  //  图片处理
  // ============================================================
  let currentImageBase64 = null;

  function handleImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      currentImageBase64 = e.target.result;
      const zone = document.getElementById('inv-upload-zone');
      zone.innerHTML = `<img src="${currentImageBase64}">`;
      zone.classList.add('has-image');
      document.getElementById('inv-ocr-btn').disabled = false;
      showStatus('info', '图片已加载，点击"开始识别"');
    };
    reader.readAsDataURL(file);
  }

  // ============================================================
  //  OCR 识别
  // ============================================================
  async function runOCR() {
    if (!currentImageBase64) return;

    const btn = document.getElementById('inv-ocr-btn');
    btn.disabled = true;
    btn.textContent = '识别中...';
    showStatus('warning', '正在识别，请耐心等待（首次加载模型较慢）...');

    try {
      // 使用 Tesseract.js 识别中文+英文
      const { data } = await Tesseract.recognize(
        currentImageBase64,
        'chi_sim+eng',
        {
          logger: (m) => {
            if (m.status === 'recognizing text') {
              showStatus('warning', `识别中... ${Math.round(m.progress * 100)}%`);
            }
          },
        }
      );

      const rawText = data.text;
      document.getElementById('inv-raw-text').textContent = rawText;
      document.getElementById('inv-raw-section').style.display = 'block';

      // 解析发票字段
      const fields = parseInvoiceText(rawText);

      // 填入手动输入区，方便用户核对
      document.getElementById('f-name').value = fields.name || '';
      document.getElementById('f-taxid').value = fields.taxid || '';
      document.getElementById('f-addr').value = fields.addr || '';
      document.getElementById('f-bank').value = fields.bank || '';

      // 切换到手动输入 Tab 让用户核对
      document.querySelector('#inv-panel .inv-tab[data-tab="manual"]').click();

      showStatus('success', '识别完成！请核对信息后点击"填入开票页面"');
      log('识别结果:', fields);
    } catch (err) {
      showStatus('error', '识别失败：' + err.message);
      log('OCR出错:', err);
    } finally {
      btn.disabled = false;
      btn.textContent = '开始识别';
    }
  }

  // ============================================================
  //  发票文本解析 —— 用正则提取关键字段
  // ============================================================
  function parseInvoiceText(text) {
    const fields = { name: '', taxid: '', addr: '', bank: '' };
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    log('待解析文本行:', lines);

    for (const line of lines) {
      // 纳税人识别号：通常 15、17、18、20 位字母数字混合
      const taxMatch = line.match(/(?:纳税人识别号|税号|识别号)[:：\s]*([A-Z0-9]{15,20})/i)
        || line.match(/\b([A-Z0-9]{18,20})\b/);
      if (taxMatch && !fields.taxid) {
        fields.taxid = taxMatch[1];
      }

      // 名称：通常在"名称"关键字后面
      const nameMatch = line.match(/(?:名称|购买方|名称)[:：]\s*(.+?)(?:\s|$)/);
      if (nameMatch && !fields.name) {
        fields.name = nameMatch[1].trim();
      }

      // 地址电话：通常包含"地址"、"电话"关键字
      if (/地址|电话/.test(line) && !fields.addr) {
        fields.addr = line.replace(/地址[:：]?|电话[:：]?/g, '').trim();
      }

      // 开户行账号：通常包含"开户"、"账号"关键字
      if (/开户|账号|银行/.test(line) && !fields.bank) {
        fields.bank = line.replace(/开户行[:：]?|账号[:：]?|开户行及账号[:：]?/g, '').trim();
      }
    }

    return fields;
  }

  // ============================================================
  //  表单填写核心 —— 根据 label 文本找输入框并赋值
  // ============================================================

  /**
   * 收集手动输入区的数据
   */
  function collectFields() {
    return {
      name: document.getElementById('f-name').value.trim(),
      taxid: document.getElementById('f-taxid').value.trim(),
      addr: document.getElementById('f-addr').value.trim(),
      bank: document.getElementById('f-bank').value.trim(),
    };
  }

  /**
   * 字段映射表：发票字段 → 开票页面上可能的 label 文本
   * 每个字段可以有多个候选文本，按优先级匹配
   */
  const FIELD_LABELS = {
    name: ['名称', '购买方名称', '购方名称', '买方名称', '单位名称'],
    taxid: ['纳税人识别号', '税号', '识别号', '统一社会信用代码'],
    addr: ['地址', '地址电话', '联系方式'],
    bank: ['开户行', '开户行及账号', '银行', '账号'],
  };

  /**
   * 根据 label 文本查找关联的 input 元素
   * 策略：
   * 1. 找到 label 元素
   * 2. 往上找父容器
   * 3. 在容器中找 input、textarea 或可编辑 div
   */
  function findInputByLabel(labelTexts) {
    const allElements = document.querySelectorAll('label, span, div, td, th');

    for (const labelEl of allElements) {
      const elText = (labelEl.textContent || '').trim().replace(/[*\s：:]/g, '');

      for (const lt of labelTexts) {
        const target = lt.replace(/[*\s：:]/g, '');

        // label 文本精确匹配或包含目标文本
        if (elText === target || (elText.length < 15 && elText.includes(target))) {
          // 从 label 往上找，在父容器中搜索 input
          let container = labelEl;
          for (let i = 0; i < 5 && container; i++) {
            container = container.parentElement;
            if (!container) break;

            // 找 input、textarea
            const inputs = container.querySelectorAll(
              'input[type="text"], input:not([type]), textarea, [contenteditable="true"], .el-input__inner, .ant-input'
            );

            for (const input of inputs) {
              if (isVisible(input)) {
                return input;
              }
            }
          }
        }
      }
    }

    // 策略2：通过 placeholder 查找
    for (const lt of labelTexts) {
      const inputs = document.querySelectorAll('input, textarea, [contenteditable]');
      for (const input of inputs) {
        const ph = input.getAttribute('placeholder') || '';
        if (ph.includes(lt)) return input;
      }
    }

    return null;
  }

  /**
   * 给输入框赋值并触发事件（兼容 Vue / React 等框架）
   */
  function setFieldValue(input, value) {
    if (!input || !value) return false;

    // 获取原生 setter（关键！直接 .value= 在 Vue/React 中不生效）
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (input.tagName === 'TEXTAREA' && nativeTextareaValueSetter) {
      nativeTextareaValueSetter.call(input, value);
    } else if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, value);
    } else {
      input.value = value;
    }

    // 触发框架监听的事件
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));

    return true;
  }

  /**
   * 判断元素是否可见
   */
  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  /**
   * 主填表函数
   */
  function fillForm() {
    const fields = collectFields();
    const logEl = document.getElementById('inv-fill-log');
    logEl.innerHTML = '';

    const addLog = (text, type) => {
      const div = document.createElement('div');
      div.className = type || '';
      div.textContent = (type === 'ok' ? '✅ ' : type === 'fail' ? '❌ ' : '• ') + text;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    };

    addLog('开始填写...');
    let successCount = 0;
    let total = 0;

    for (const [fieldKey, labelCandidates] of Object.entries(FIELD_LABELS)) {
      const value = fields[fieldKey];
      if (!value) {
        addLog(`跳过 ${fieldKey}（无数据）`);
        continue;
      }
      total++;

      addLog(`查找字段: ${labelCandidates[0]}...`);
      const input = findInputByLabel(labelCandidates);

      if (input) {
        setFieldValue(input, value);
        addLog(`已填入 "${labelCandidates[0]}": ${value.substring(0, 20)}${value.length > 20 ? '...' : ''}`, 'ok');
        successCount++;
      } else {
        addLog(`未找到 "${labelCandidates[0]}" 对应的输入框`, 'fail');
      }
    }

    addLog(`完成！成功 ${successCount}/${total} 个字段`);
    log('填表完成', { successCount, total });
  }

  // ============================================================
  //  辅助函数
  // ============================================================
  function showStatus(type, message) {
    const area = document.getElementById('inv-status-area');
    area.innerHTML = `<div class="inv-status inv-status-${type}">${message}</div>`;
  }

  function makeDraggable() {
    const panel = document.getElementById('inv-panel');
    const header = panel.querySelector('.inv-header');
    let isDragging = false;
    let startX, startY, startLeft, startTop;

    header.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('inv-close')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.right = 'auto';
      panel.style.left = startLeft + 'px';
      panel.style.top = startTop + 'px';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      panel.style.left = startLeft + (e.clientX - startX) + 'px';
      panel.style.top = startTop + (e.clientY - startY) + 'px';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  // ============================================================
  //  启动
  // ============================================================
  function init() {
    if (document.getElementById('inv-panel')) return;
    buildUI();

    // 暴露调试接口
    window.__invoiceFiller = {
      parse: parseInvoiceText,
      fill: fillForm,
      findInput: findInputByLabel,
      setField: setFieldValue,
      log: log,
    };
    log('Demo 已加载。调试接口：window.__invoiceFiller');
  }

  // 延迟启动确保页面加载
  setTimeout(init, 1500);
})();
