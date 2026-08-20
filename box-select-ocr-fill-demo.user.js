// ==UserScript==
// @name         凭证单据框选识别填表
// @namespace    https://dppt.hubei.chinatax.gov.cn
// @version      0.9.17
// @description  上传单据图片 → 框选信息 → 豆包/百度/OCR.space识别 → 自动验证修正 → 自动填入开票页面（多图片、面板缩放、图片旋转缩放、拖拽上传、备注模板自定义、方框调整大小、滚动填表、OCR字符修正）
// @author       AutoScript
// @match        *://*.hubei.chinatax.gov.cn/*
// @match        *://*.hubei.chinatax.gov.cn:8443/*
// @match        *://dppt.hubei.chinatax.gov.cn/*
// @match        *://dpt.hubei.chinatax.gov.cn/*
// @match        *://*.chinatax.gov.cn/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      cdn.jsdelivr.net
// @connect      unpkg.com
// @connect      aip.baidubce.com
// @connect      ark.cn-beijing.volces.com
// @connect      api.ocr.space
// @connect      open.bigmodel.cn
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[框选填表]';
  const log = (...a) => console.log(TAG, ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ============================================================
  //  百度 OCR 配置
  // ============================================================
  const BAIDU_OCR = {
    apiKey: GM_getValue('baidu_api_key', ''),
    secretKey: GM_getValue('baidu_secret_key', ''),
    accessToken: GM_getValue('baidu_access_token', ''),
    tokenExpire: GM_getValue('baidu_token_expire', 0),
    // OCR 接口地址
    generalUrl: 'https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic',
    accurateUrl: 'https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic',
    tokenUrl: 'https://aip.baidubce.com/oauth/2.0/token',
  };

  function isBaiduConfigured() {
    return BAIDU_OCR.apiKey && BAIDU_OCR.secretKey;
  }

  function saveBaiduConfig(apiKey, secretKey) {
    BAIDU_OCR.apiKey = apiKey;
    BAIDU_OCR.secretKey = secretKey;
    GM_setValue('baidu_api_key', apiKey);
    GM_setValue('baidu_secret_key', secretKey);
    // 清除旧 token
    BAIDU_OCR.accessToken = '';
    BAIDU_OCR.tokenExpire = 0;
    GM_setValue('baidu_access_token', '');
    GM_setValue('baidu_token_expire', 0);
  }

  /**
   * 获取百度 access_token（带缓存）
   */
  function getBaiduToken() {
    const now = Date.now();
    if (BAIDU_OCR.accessToken && now < BAIDU_OCR.tokenExpire) {
      log('使用缓存的百度 access_token');
      return Promise.resolve(BAIDU_OCR.accessToken);
    }

    log('请求新的百度 access_token...');
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: BAIDU_OCR.tokenUrl,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: `grant_type=client_credentials&client_id=${encodeURIComponent(BAIDU_OCR.apiKey)}&client_secret=${encodeURIComponent(BAIDU_OCR.secretKey)}`,
        onload: (resp) => {
          try {
            const data = JSON.parse(resp.responseText);
            if (data.access_token) {
              BAIDU_OCR.accessToken = data.access_token;
              // expires_in 是秒数，提前 5 分钟过期
              BAIDU_OCR.tokenExpire = now + (data.expires_in - 300) * 1000;
              GM_setValue('baidu_access_token', data.access_token);
              GM_setValue('baidu_token_expire', BAIDU_OCR.tokenExpire);
              log('✅ 百度 token 获取成功，有效期:', data.expires_in, '秒');
              resolve(data.access_token);
            } else {
              reject(new Error(data.error_description || data.error || '获取 token 失败'));
            }
          } catch (e) {
            reject(new Error('解析 token 响应失败: ' + e.message));
          }
        },
        onerror: () => reject(new Error('网络请求失败，请检查网络连接')),
        ontimeout: () => reject(new Error('请求超时')),
        timeout: 15000,
      });
    });
  }

  /**
   * 调用百度 OCR 识别图片
   * @param {string} base64Image - 图片的 base64（不含 data:image/... 前缀）
   * @param {boolean} highPrecision - 是否使用高精度接口
   * @returns {Promise<string>} 识别出的文本
   */
  function baiduOCR(base64Image, highPrecision) {
    const apiUrl = highPrecision ? BAIDU_OCR.accurateUrl : BAIDU_OCR.generalUrl;

    return getBaiduToken().then((token) => {
      log('调用百度 OCR 接口...', highPrecision ? '(高精度)' : '(标准)');
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'POST',
          url: `${apiUrl}?access_token=${token}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          data: `image=${encodeURIComponent(base64Image)}${highPrecision ? '&language_type=CHN_ENG' : ''}`,
          onload: (resp) => {
            try {
              const data = JSON.parse(resp.responseText);
              if (data.error_code) {
                reject(new Error(`百度OCR错误[${data.error_code}]: ${data.error_msg}`));
                return;
              }
              if (data.words_result && data.words_result.length > 0) {
                const text = data.words_result.map((r) => r.words).join('\n');
                log('✅ 百度 OCR 识别结果:', text.substring(0, 80));
                resolve(text);
              } else {
                log('百度 OCR 返回空结果');
                resolve('');
              }
            } catch (e) {
              reject(new Error('解析 OCR 响应失败: ' + e.message));
            }
          },
          onerror: () => reject(new Error('OCR 请求失败，请检查网络')),
          ontimeout: () => reject(new Error('OCR 请求超时')),
          timeout: 30000,
        });
      });
    });
  }

  // ============================================================
  //  豆包（火山引擎方舟）视觉识别 —— 用大模型理解图片内容
  // ============================================================
  // 已退役的模型 ID 列表，需自动迁移到新模型
  const RETIRED_MODELS = ['doubao-1.5-vision-pro-32k', 'doubao-1-5-vision-pro-32k'];
  const DEFAULT_DOUBAO_MODEL = 'doubao-seed-2-0-mini-260215';

  // 读取存储的模型 ID，如果是已退役模型则自动替换
  let _storedModelId = GM_getValue('doubao_model_id', DEFAULT_DOUBAO_MODEL);
  if (RETIRED_MODELS.includes(_storedModelId)) {
    log(`⚠️ 检测到已退役模型 ${_storedModelId}，自动替换为 ${DEFAULT_DOUBAO_MODEL}`);
    _storedModelId = DEFAULT_DOUBAO_MODEL;
    GM_setValue('doubao_model_id', DEFAULT_DOUBAO_MODEL);
  }

  const DOUBAO = {
    apiKey: GM_getValue('doubao_api_key', ''),
    // 视觉理解模型 ID
    modelId: _storedModelId,
    apiUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  };

  function isDoubaoConfigured() {
    return !!DOUBAO.apiKey;
  }

  function saveDoubaoConfig(apiKey, modelId) {
    DOUBAO.apiKey = apiKey;
    DOUBAO.modelId = modelId || DEFAULT_DOUBAO_MODEL;
    GM_setValue('doubao_api_key', apiKey);
    GM_setValue('doubao_model_id', DOUBAO.modelId);
  }

  /**
   * 调用豆包视觉模型识别图片文字
   * @param {string} base64Image - 图片 base64（不含 data:image 前缀）
   * @param {string} fieldLabel - 字段标签（告诉模型要识别什么）
   * @returns {Promise<string>} 识别出的文本
   */
  function doubaoOCR(base64Image, fieldLabel) {
    log('调用豆包视觉模型...', DOUBAO.modelId);

    const prompt = `请识别图片中的文字内容。这是"${fieldLabel}"字段。请只返回识别到的文字内容，不要加任何解释、标注或引号。如果有多个词，用空格连接。`;

    const requestBody = {
      model: DOUBAO.modelId,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${base64Image}` },
            },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0.1, // 低温度保证输出稳定
    };

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: DOUBAO.apiUrl,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DOUBAO.apiKey}`,
        },
        data: JSON.stringify(requestBody),
        onload: (resp) => {
          try {
            const data = JSON.parse(resp.responseText);
            if (data.error) {
              reject(new Error(`豆包错误: ${data.error.message || JSON.stringify(data.error)}`));
              return;
            }
            if (data.choices && data.choices.length > 0) {
              const text = data.choices[0].message.content.trim();
              log('✅ 豆包识别结果:', text.substring(0, 80));
              resolve(text);
            } else {
              log('豆包返回空结果');
              resolve('');
            }
          } catch (e) {
            reject(new Error('解析豆包响应失败: ' + e.message));
          }
        },
        onerror: () => reject(new Error('豆包请求失败，请检查网络')),
        ontimeout: () => reject(new Error('豆包请求超时')),
        timeout: 60000,
      });
    });
  }

  // ============================================================
  //  OCR.space —— 免费在线 OCR API，支持中文，每月 25000 次
  // ============================================================
  const OCR_SPACE = {
    apiKey: GM_getValue('ocrspace_api_key', ''),
    apiUrl: 'https://api.ocr.space/parse/image',
  };

  function isOcrSpaceConfigured() {
    return !!OCR_SPACE.apiKey;
  }

  function saveOcrSpaceConfig(apiKey) {
    OCR_SPACE.apiKey = apiKey;
    GM_setValue('ocrspace_api_key', apiKey);
    log('OCR.space 配置已保存');
  }

  function ocrSpaceRecognize(base64Image) {
    log('调用 OCR.space 识别...');
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: OCR_SPACE.apiUrl,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        data: `apikey=${encodeURIComponent(OCR_SPACE.apiKey)}&base64Image=${encodeURIComponent(base64Image)}&language=chs&isOverlayRequired=false&scale=true&OCREngine=2`,
        onload: (resp) => {
          try {
            const data = JSON.parse(resp.responseText);
            if (data.IsErroredOnProcessing) {
              reject(new Error('OCR.space 错误: ' + (data.ErrorMessage || '未知错误')));
              return;
            }
            if (data.ParsedResults && data.ParsedResults.length > 0) {
              const text = data.ParsedResults.map((r) => r.ParsedText).join('\n');
              log('✅ OCR.space 识别结果:', text.substring(0, 80));
              resolve(text);
            } else {
              log('OCR.space 返回空结果');
              resolve('');
            }
          } catch (e) {
            reject(new Error('解析 OCR.space 响应失败: ' + e.message));
          }
        },
        onerror: () => reject(new Error('OCR.space 请求失败，请检查网络')),
        ontimeout: () => reject(new Error('OCR.space 请求超时')),
        timeout: 30000,
      });
    });
  }

  // ============================================================
  //  智谱 GLM-4.6V-Flash —— 永久免费视觉大模型，替代豆包
  // ============================================================
  const GLM = {
    apiKey: GM_getValue('glm_api_key', ''),
    modelId: 'glm-4.6v-flash',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  };

  function isGlmConfigured() {
    return !!GLM.apiKey;
  }

  function saveGlmConfig(apiKey) {
    GLM.apiKey = apiKey;
    GM_setValue('glm_api_key', apiKey);
    log('智谱 GLM 配置已保存');
  }

  function glmOCR(base64Image, fieldLabel) {
    log('调用智谱 GLM-4.6V-Flash 视觉模型...');
    const dataUrl = `data:image/png;base64,${base64Image}`;

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: GLM.apiUrl,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GLM.apiKey}`,
        },
        data: JSON.stringify({
          model: GLM.modelId,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: dataUrl },
                },
                {
                  type: 'text',
                  text: `请识别图片中的"${fieldLabel}"信息，只返回识别到的文字内容，不要加任何解释、前缀或标点符号。如果图片中有多个匹配项，返回最清晰的那一个。`,
                },
              ],
            },
          ],
          thinking: { type: 'disabled' },
        }),
        onload: (resp) => {
          try {
            const data = JSON.parse(resp.responseText);
            if (data.error) {
              reject(new Error('GLM错误: ' + (data.error.message || JSON.stringify(data.error))));
              return;
            }
            if (data.choices && data.choices.length > 0) {
              const text = data.choices[0].message.content.trim();
              log('✅ GLM 识别结果:', text.substring(0, 80));
              resolve(text);
            } else {
              reject(new Error('GLM 返回空结果'));
            }
          } catch (e) {
            reject(new Error('解析 GLM 响应失败: ' + e.message + ' (HTTP ' + resp.status + ')'));
          }
        },
        onerror: () => reject(new Error('GLM 请求失败，请检查网络')),
        ontimeout: () => reject(new Error('GLM 请求超时')),
        timeout: 60000,
      });
    });
  }

  // ============================================================
  //  Tesseract.js 动态加载（备用 OCR 引擎）
  // ============================================================
  let tesseractLoaded = false;
  let tesseractLoading = null;

  function loadTesseract() {
    if (tesseractLoaded && typeof Tesseract !== 'undefined') {
      return Promise.resolve();
    }
    if (tesseractLoading) return tesseractLoading;

    const CDN_URLS = [
      'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
      'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js',
    ];

    tesseractLoading = new Promise((resolve, reject) => {
      log('开始动态加载 Tesseract.js...');

      const tryLoad = (urlIdx) => {
        if (urlIdx >= CDN_URLS.length) {
          reject(new Error('所有 CDN 均加载失败，请检查网络连接'));
          return;
        }

        const url = CDN_URLS[urlIdx];
        log(`尝试加载 CDN[${urlIdx}]: ${url}`);

        const script = document.createElement('script');
        script.src = url;
        script.charset = 'utf-8';
        script.onload = () => {
          if (typeof Tesseract !== 'undefined') {
            tesseractLoaded = true;
            log('✅ Tesseract.js 加载成功');
            resolve();
          } else {
            log(`CDN[${urlIdx}] 加载完成但 Tesseract 未定义，尝试下一个`);
            tryLoad(urlIdx + 1);
          }
        };
        script.onerror = () => {
          log(`CDN[${urlIdx}] 加载失败，尝试下一个`);
          tryLoad(urlIdx + 1);
        };
        document.head.appendChild(script);
      };

      tryLoad(0);
    });

    return tesseractLoading;
  }

  // ============================================================
  //  目标字段定义 —— 可根据实际需求增删
  // ============================================================
  const TARGET_FIELDS = [
    { key: 'name', label: '名称', placeholder: '如：宜昌丁秋电器有限责任公司' },
    { key: 'taxid', label: '纳税人识别号', placeholder: '如：91420100MA4K...' },
    { key: 'spec', label: '规格型号', placeholder: '如：KFR-35GW' },
    { key: 'price', label: '单价', placeholder: '如：3400' },
    { key: 'order_no', label: '订单号', placeholder: '如：2026071717...', isVirtual: true },
    { key: 'personal_pay', label: '个人支付金额', placeholder: '如：2549.15', isVirtual: true },
    { key: 'subsidy', label: '政府补贴金额', placeholder: '如：449.85', isVirtual: true },
    { key: 'product_code', label: '商品编码', placeholder: '如：6938187313313', isVirtual: true },
    { key: 'remark', label: '备注(自动组合)', placeholder: '自动组合上方虚拟字段' },
  ];

  // 默认字段顺序：第N个框自动选择对应字段
  const DEFAULT_FIELD_ORDER = [
    'name',          // 框1 → 名称
    'taxid',         // 框2 → 纳税人识别号
    'spec',          // 框3 → 规格型号
    'product_code',  // 框4 → 商品编码
    'order_no',      // 框5 → 订单号
    'personal_pay',  // 框6 → 个人支付金额
    'subsidy',       // 框7 → 政府补贴金额
  ];

  // 虚拟字段列表（不直接填入表单，用于组合备注）
  const VIRTUAL_FIELDS = ['order_no', 'personal_pay', 'subsidy', 'product_code'];

  // ============================================================
  //  字段验证规则
  // ============================================================
  // type: 'regex' = 正则匹配, 'numeric' = 纯数字, 'decimal' = 金额, 'length' = 固定长度
  const VALIDATION_RULES = {
    order_no: {
      type: 'regex',
      pattern: /^\d{26}$/,
      exactLength: 26,
      charset: 'digits',
      label: '订单号',
      message: '订单号必须为26位纯数字',
    },
    taxid: {
      type: 'regex',
      // 统一社会信用代码：2位登记管理部门+6位行政区划+10位主体标识（排除I/O/Z/S/V）
      pattern: /^[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}$/,
      exactLength: 18,
      charset: 'alnum_upper',
      label: '纳税人识别号',
      message: '纳税人识别号应为18位统一社会信用代码',
    },
    product_code: {
      type: 'regex',
      pattern: /^\d{13}$/,
      exactLength: 13,
      charset: 'digits',
      label: '商品编码',
      message: '商品编码通常为13位数字（EAN-13条码）',
    },
    personal_pay: {
      type: 'decimal',
      label: '个人支付金额',
      message: '应为金额格式（如 2549.15）',
    },
    subsidy: {
      type: 'decimal',
      label: '政府补贴金额',
      message: '应为金额格式（如 449.85）',
    },
    price: {
      type: 'decimal',
      label: '单价',
      message: '应为金额格式（如 3400 或 3400.00）',
    },
    spec: {
      type: 'regex',
      pattern: /^[A-Za-z0-9\-\/\(\)×\*\. ]+$/,
      minLength: 2,
      label: '规格型号',
      message: '规格型号应仅含字母、数字、连字符等',
    },
    name: {
      type: 'minLength',
      minLength: 4,
      label: '名称',
      message: '名称识别结果过短，可能识别有误',
    },
  };

  // OCR 常见误识别字符 → 正确字符（纯数字字段使用）
  const OCR_DIGIT_FIX_MAP = {
    'O': '0', 'o': '0', 'Q': '0', 'D': '0', 'C': '0',
    'I': '1', 'l': '1', 'L': '1', '|': '1', 'i': '1',
    'Z': '2', 'z': '2',
    'E': '3', 'e': '3',
    'A': '4', 'a': '4',
    'S': '5', 's': '5',
    'b': '6', 'G': '6',
    'T': '7', 't': '7',
    'B': '8',
    'g': '9', 'q': '9',
    ' ': '',  '-': '', '—': '', '_': '', ':': '', '.': '', ',': '',
  };

  /**
   * 自动修正纯数字字段的 OCR 误识别
   * 只在 charset === 'digits' 的字段上使用
   */
  function autoCorrectDigits(text) {
    let corrected = '';
    for (const ch of text) {
      if (/[0-9]/.test(ch)) {
        corrected += ch;
      } else if (OCR_DIGIT_FIX_MAP[ch] !== undefined) {
        corrected += OCR_DIGIT_FIX_MAP[ch];
      }
      // 其他字符直接跳过
    }
    return corrected;
  }

  /**
   * 自动修正金额字段的 OCR 误识别
   * 保留小数点，其余字母转数字
   */
  function autoCorrectDecimal(text) {
    let corrected = '';
    let dotCount = 0;
    for (const ch of text) {
      if (/[0-9]/.test(ch)) {
        corrected += ch;
      } else if (ch === '.' && dotCount === 0) {
        corrected += ch;
        dotCount++;
      } else if (ch === ',' || ch === '，') {
        // 逗号可能是千分位，跳过
        continue;
      } else if (OCR_DIGIT_FIX_MAP[ch] !== undefined && OCR_DIGIT_FIX_MAP[ch] !== '') {
        corrected += OCR_DIGIT_FIX_MAP[ch];
      }
      // 其他字符跳过
    }
    // 如果末尾是单独的小数点，去掉
    corrected = corrected.replace(/\.$/, '');
    return corrected;
  }

  /**
   * 统一社会信用代码 OCR 修正：转大写，去除 I/O/Z/S/V（非合法字符→最接近的数字）
   */
  function autoCorrectTaxId(text) {
    let corrected = text.toUpperCase().replace(/[\s\-—_]/g, '');
    // 统一社会信用代码不包含 I O Z S V，OCR 可能把数字误识为这些字母
    corrected = corrected
      .replace(/I/g, '1').replace(/O/g, '0').replace(/Z/g, '2')
      .replace(/S/g, '5').replace(/V/g, '5');
    // 截取前18位
    if (corrected.length > 18) corrected = corrected.substring(0, 18);
    return corrected;
  }

  /**
   * 验证字段值
   * @returns {{ valid: boolean, message: string, corrected: string|null }}
   */
  function validateField(fieldKey, value) {
    const rule = VALIDATION_RULES[fieldKey];
    if (!rule) return { valid: true, message: '', corrected: null };

    const val = (value || '').trim();
    if (!val) return { valid: false, message: `${rule.label}：识别结果为空`, corrected: null };

    // 尝试自动修正
    let corrected = null;
    let checkVal = val;

    if (rule.charset === 'digits') {
      const fixed = autoCorrectDigits(val);
      if (fixed !== val) corrected = fixed;
      checkVal = fixed;
    } else if (rule.type === 'decimal') {
      const fixed = autoCorrectDecimal(val);
      if (fixed !== val) corrected = fixed;
      checkVal = fixed;
    } else if (fieldKey === 'taxid') {
      const fixed = autoCorrectTaxId(val);
      if (fixed !== val) corrected = fixed;
      checkVal = fixed;
    }

    // 正则验证
    if (rule.type === 'regex' && rule.pattern) {
      if (rule.pattern.test(checkVal)) {
        return { valid: true, message: '', corrected: corrected };
      }
      // 如果修正后通过但原始值不通过
      if (corrected && rule.pattern.test(corrected)) {
        return { valid: true, message: `已自动修正: ${val} → ${corrected}`, corrected: corrected };
      }
      return { valid: false, message: rule.message, corrected: corrected };
    }

    // 金额验证
    if (rule.type === 'decimal') {
      if (/^\d+(\.\d{1,2})?$/.test(checkVal)) {
        return { valid: true, message: '', corrected: corrected };
      }
      if (corrected && /^\d+(\.\d{1,2})?$/.test(corrected)) {
        return { valid: true, message: `已自动修正: ${val} → ${corrected}`, corrected: corrected };
      }
      return { valid: false, message: rule.message, corrected: corrected };
    }

    // 最小长度验证
    if (rule.type === 'minLength' && rule.minLength) {
      if (checkVal.length >= rule.minLength) {
        return { valid: true, message: '', corrected: corrected };
      }
      return { valid: false, message: rule.message, corrected: corrected };
    }

    return { valid: true, message: '', corrected: corrected };
  }

  /**
   * 跨字段校验：个人支付 + 政府补贴 ≈ 单价
   */
  function crossFieldValidate(virtualValues, filledValues) {
    const warnings = [];
    const pay = parseFloat(virtualValues.personal_pay || filledValues.personal_pay || '');
    const sub = parseFloat(virtualValues.subsidy || filledValues.subsidy || '');
    const price = parseFloat(virtualValues.price || filledValues.price || '');
    if (!isNaN(pay) && !isNaN(sub)) {
      const sum = pay + sub;
      if (!isNaN(price)) {
        if (Math.abs(sum - price) > 1) {
          warnings.push(`金额校验: 个人支付(${pay}) + 补贴(${sub}) = ${sum.toFixed(2)} ≠ 单价(${price})，差值 ${Math.abs(sum - price).toFixed(2)} 元`);
        }
      }
    }
    return warnings;
  }

  // 备注模板默认值：{key} 会被对应虚拟字段的识别结果替换，能效等级固定为"一级"
  const DEFAULT_REMARK_TEMPLATE = '2026年以旧换新, 订单号: {order_no}个人支付金额: {personal_pay}元, 政府补贴金额: {subsidy}元. 商品编码: {product_code}; 能效等级: 一级';
  // 从存储加载用户自定义模板
  let REMARK_TEMPLATE = GM_getValue('remark_template', DEFAULT_REMARK_TEMPLATE);

  // 可用的占位符列表（供模板编辑器展示）
  const TEMPLATE_PLACEHOLDERS = [
    { key: 'order_no',     label: '订单号' },
    { key: 'personal_pay', label: '个人支付金额' },
    { key: 'subsidy',      label: '政府补贴金额' },
    { key: 'product_code', label: '商品编码' },
  ];

  // ============================================================
  //  样式
  // ============================================================
  GM_addStyle(`
    #box-panel {
      position: fixed; top: 60px; right: 20px; width: 420px;
      background: #fff; border: 1px solid #d9d9d9; border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.18); z-index: 999999;
      font-family: -apple-system, "Microsoft YaHei", sans-serif;
      font-size: 13px; color: #333; max-height: 90vh; display: flex; flex-direction: column;
    }
    #box-panel .bp-header {
      background: #4A90E2; color: #fff; padding: 10px 14px;
      font-weight: 600; border-radius: 8px 8px 0 0; cursor: move;
      display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;
    }
    #box-panel .bp-body { padding: 14px; overflow-y: auto; flex: 1; }
    #box-panel .bp-close { cursor: pointer; font-size: 18px; opacity: 0.8; }
    #box-panel .bp-close:hover { opacity: 1; }
    #box-panel .bp-section { margin-bottom: 14px; }
    #box-panel .bp-section-title {
      font-weight: 600; margin-bottom: 8px; color: #4A90E2;
      font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;
    }
    #box-panel .bp-upload-zone {
      border: 2px dashed #d9d9d9; border-radius: 6px; padding: 24px;
      text-align: center; cursor: pointer; color: #999; transition: all 0.2s;
    }
    #box-panel .bp-upload-zone:hover { border-color: #4A90E2; color: #4A90E2; }
    #box-panel .bp-btn {
      display: inline-block; padding: 7px 16px; border: none; border-radius: 4px;
      cursor: pointer; font-size: 13px; margin-right: 6px; transition: all 0.2s;
    }
    #box-panel .bp-btn-primary { background: #4A90E2; color: #fff; }
    #box-panel .bp-btn-primary:hover { background: #3a7bc8; }
    #box-panel .bp-btn-danger { background: #ff4d4f; color: #fff; }
    #box-panel .bp-btn-secondary { background: #f0f0f0; color: #333; }
    #box-panel .bp-btn-secondary:hover { background: #e0e0e0; }
    #box-panel .bp-btn:disabled { background: #ccc; cursor: not-allowed; }
    #box-panel .bp-status {
      padding: 8px 10px; border-radius: 4px; margin-bottom: 10px; font-size: 12px;
    }
    #box-panel .bp-status-info { background: #e6f7ff; color: #1890ff; border: 1px solid #91d5ff; }
    #box-panel .bp-status-success { background: #f6ffed; color: #52c41a; border: 1px solid #b7eb8f; }
    #box-panel .bp-status-error { background: #fff2f0; color: #ff4d4f; border: 1px solid #ffccc7; }
    #box-panel .bp-status-warning { background: #fffbe6; color: #faad14; border: 1px solid #ffe58f; }
    #box-panel .bp-canvas-wrap {
      position: relative; margin: 8px 0; border: 1px solid #eee;
      border-radius: 4px; overflow: auto; background: #fafafa;
      max-height: 400px; min-height: 150px; flex: 1;
    }
    #box-panel .bp-canvas-wrap canvas { display: block; cursor: crosshair; }
    #box-panel .bp-box-list { margin-top: 8px; }
    #box-panel .bp-box-item {
      display: flex; align-items: center; gap: 8px; padding: 6px 8px;
      border: 1px solid #eee; border-radius: 4px; margin-bottom: 4px;
      background: #fafafa; font-size: 12px;
    }
    #box-panel .bp-box-item .bp-box-color {
      width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0;
    }
    #box-panel .bp-box-item select {
      flex: 1; padding: 3px 6px; border: 1px solid #d9d9d9;
      border-radius: 3px; font-size: 12px;
    }
    #box-panel .bp-box-item .bp-box-del {
      color: #ff4d4f; cursor: pointer; font-size: 14px; flex-shrink: 0;
    }
    #box-panel .bp-box-item .bp-box-result {
      font-size: 11px; color: #52c41a; max-width: 120px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    #box-panel .bp-box-item .bp-box-result-invalid {
      color: #ff4d4f;
    }
    #box-panel .bp-box-item .bp-box-result-valid {
      color: #52c41a;
    }
    #box-panel .bp-box-item .bp-box-result-editable {
      cursor: text; border: 1px dashed transparent; padding: 1px 3px; border-radius: 3px;
    }
    #box-panel .bp-box-item .bp-box-result-editable:hover {
      border-color: #d9d9d9; background: #fff;
    }
    #box-panel .bp-box-item .bp-box-result-editable:focus {
      border-color: #4A90E2; background: #fff; outline: none;
    }
    #box-panel .bp-fill-log {
      font-size: 11px; color: #666; margin-top: 6px;
      max-height: 120px; overflow-y: auto;
    }
    #box-panel .bp-fill-log .ok { color: #52c41a; }
    #box-panel .bp-fill-log .fail { color: #ff4d4f; }
    #box-panel .bp-fill-log .info { color: #999; }
    #box-panel .bp-fill-log .warn { color: #faad14; }
    #box-panel .bp-hint {
      font-size: 11px; color: #999; margin-top: 4px; line-height: 1.5;
    }
    #box-panel .bp-step {
      display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 12px;
    }
    #box-panel .bp-step-num {
      width: 18px; height: 18px; border-radius: 50%; background: #4A90E2;
      color: #fff; display: flex; align-items: center; justify-content: center;
      font-size: 11px; flex-shrink: 0;
    }
    #box-panel .bp-step.done .bp-step-num { background: #52c41a; }
    #bp-settings-overlay {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.4); z-index: 1000000;
      display: flex; align-items: center; justify-content: center;
    }
    #bp-settings-overlay .bp-settings-box {
      background: #fff; border-radius: 8px; padding: 24px;
      width: 420px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    }
    #bp-settings-overlay .bp-settings-title {
      font-weight: 600; font-size: 15px; margin-bottom: 16px; color: #333;
    }
    #bp-settings-overlay .bp-settings-field { margin-bottom: 14px; }
    #bp-settings-overlay .bp-settings-label {
      font-size: 12px; color: #666; margin-bottom: 4px; font-weight: 500;
    }
    #bp-settings-overlay .bp-settings-input {
      width: 100%; padding: 8px 10px; border: 1px solid #d9d9d9;
      border-radius: 4px; font-size: 13px; box-sizing: border-box; font-family: monospace;
    }
    #bp-settings-overlay .bp-settings-input:focus { border-color: #4A90E2; outline: none; }
    #bp-settings-overlay .bp-settings-hint {
      font-size: 11px; color: #999; margin-top: 4px; line-height: 1.5;
    }
    #bp-settings-overlay .bp-settings-hint a { color: #4A90E2; }
    #bp-settings-overlay .bp-settings-actions {
      display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px;
    }
    #bp-settings-overlay .bp-engine-radio {
      display: flex; gap: 16px; margin-bottom: 14px; font-size: 13px;
    }
    #bp-settings-overlay .bp-engine-radio label {
      display: flex; align-items: center; gap: 4px; cursor: pointer;
    }
    /* 面板缩放手柄 */
    #box-panel .bp-resize-handle {
      position: absolute; bottom: 0; right: 0; width: 16px; height: 16px;
      cursor: nwse-resize; z-index: 10;
      background: linear-gradient(135deg, transparent 50%, #bbb 50%, #bbb 60%, transparent 60%, transparent 70%, #bbb 70%, #bbb 80%, transparent 80%);
      border-radius: 0 0 8px 0;
    }
    #box-panel .bp-resize-handle:hover { background: linear-gradient(135deg, transparent 50%, #4A90E2 50%, #4A90E2 60%, transparent 60%, transparent 70%, #4A90E2 70%, #4A90E2 80%, transparent 80%); }
    /* 图片查看工具栏 */
    #box-panel .bp-img-toolbar {
      display: flex; gap: 4px; align-items: center; margin-bottom: 4px; flex-wrap: wrap;
    }
    #box-panel .bp-img-toolbar button {
      padding: 3px 8px; font-size: 12px; border: 1px solid #d9d9d9; border-radius: 3px;
      background: #fff; cursor: pointer; color: #666;
    }
    #box-panel .bp-img-toolbar button:hover { border-color: #4A90E2; color: #4A90E2; }
    #box-panel .bp-img-toolbar .bp-zoom-label { font-size: 11px; color: #999; margin: 0 2px; }
    /* 拖拽高亮提示 */
    #box-panel.bp-dragover { box-shadow: 0 0 0 3px #4A90E2, 0 4px 20px rgba(0,0,0,0.18); }
    #box-panel .bp-canvas-wrap.bp-drop-hover { border-color: #4A90E2; background: #e6f7ff; }
    /* 模板编辑器 */
    #bp-settings-overlay .bp-template-textarea {
      width: 100%; min-height: 80px; padding: 8px 10px; border: 1px solid #d9d9d9;
      border-radius: 4px; font-size: 12px; box-sizing: border-box; font-family: monospace;
      resize: vertical; line-height: 1.6;
    }
    #bp-settings-overlay .bp-template-textarea:focus { border-color: #4A90E2; outline: none; }
    #bp-settings-overlay .bp-placeholder-chips {
      display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px;
    }
    #bp-settings-overlay .bp-placeholder-chip {
      display: inline-block; padding: 2px 8px; font-size: 11px; font-family: monospace;
      background: #e6f7ff; border: 1px solid #91d5ff; border-radius: 3px;
      color: #1890ff; cursor: pointer; user-select: none;
    }
    #bp-settings-overlay .bp-placeholder-chip:hover { background: #bae7ff; }
  `);

  // ============================================================
  //  状态
  // ============================================================
  let images = [];                 // 多图片: [{ img: Image, base64: string, rotation: 0/90/180/270 }]
  let currentImageIndex = 0;       // 当前显示的图片索引
  let canvas, ctx;                // 主 canvas
  let canvasZoom = 1.0;           // 图片缩放倍率（影响 canvas 显示尺寸）
  const CANVAS_BASE_W = 360;      // 基准宽度（与 initCanvas 中 maxW 对应）
  let boxes = [];                 // 已画好的框 { id, x, y, w, h, fieldKey, color, result, imageIndex }
  let isDrawing = false;          // 正在画框
  let drawStart = { x: 0, y: 0 }; // 画框起点
  let drawCurrent = { x: 0, y: 0 };
  // 方框调整大小状态
  let isResizing = false;         // 正在调整方框大小
  let resizeBoxId = null;         // 正在调整的方框 ID
  let resizeHandle = null;        // 调整的手柄方向: nw/n/ne/e/se/s/sw/w
  let resizeStart = { x: 0, y: 0, bx: 0, by: 0, bw: 0, bh: 0 }; // 起始状态
  let selectedBoxId = null;       // 当前选中的方框（显示手柄）
  const HANDLE_SIZE = 8;          // 手柄检测范围（像素）

  // 方框颜色循环
  const BOX_COLORS = ['#4A90E2', '#52c41a', '#faad14', '#ff4d4f', '#722ed1', '#13c2c2', '#eb2f96'];

  // ============================================================
  //  UI 构建
  // ============================================================
  function buildUI() {
    const panel = document.createElement('div');
    panel.id = 'box-panel';
    panel.innerHTML = `
      <div class="bp-header">
        <span>凭证单据框选识别填表</span>
        <span class="bp-close" id="bp-close">&times;</span>
      </div>
      <div class="bp-body">

        <div class="bp-section">
          <div class="bp-step"><span class="bp-step-num">⚙</span> OCR 引擎设置</div>
          <div id="bp-ocr-engine-info" style="font-size:12px;color:#666;margin-bottom:8px;"></div>
          <button class="bp-btn bp-btn-secondary" id="bp-settings-btn" style="font-size:12px;padding:4px 10px;">配置百度 OCR</button>
        </div>

        <div class="bp-section">
          <div class="bp-step"><span class="bp-step-num">1</span> 上传单据图片</div>
          <div class="bp-upload-zone" id="bp-upload-zone">
            点击或拖拽图片到这里<br><span style="font-size:11px">支持 jpg / png，可上传多张图片（如订单号和商品编码在不同图片中）</span>
          </div>
          <input type="file" id="bp-file-input" accept="image/*" multiple style="display:none">
        </div>

        <div class="bp-section" id="bp-canvas-section" style="display:none">
          <div class="bp-step"><span class="bp-step-num">2</span> 在图片上拖拽画方框，框选要提取的信息（画完可拖拽手柄调整大小）</div>
          <div id="bp-image-tabs" style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;align-items:center;"></div>
          <div class="bp-img-toolbar">
            <button id="bp-zoom-out" title="缩小">－</button>
            <span class="bp-zoom-label" id="bp-zoom-label">100%</span>
            <button id="bp-zoom-in" title="放大">＋</button>
            <button id="bp-rotate-left" title="左旋转90°">↺</button>
            <button id="bp-rotate-right" title="右旋转90°">↻</button>
            <button id="bp-img-reset" title="重置图片视图">⤾ 重置</button>
          </div>
          <div class="bp-canvas-wrap" id="bp-canvas-wrap">
            <canvas id="bp-canvas"></canvas>
          </div>
          <div class="bp-hint">按住鼠标拖拽画框。画完后<b>点击方框</b>可选中并显示调整手柄，拖拽手柄可调整方框大小。点击上方"图1/图2"标签可切换图片，在不同图片上分别画框。Ctrl+滚轮缩放图片。拖拽新图片到面板任意位置可添加。在下方为每个框选择对应的目标字段。</div>
        </div>

        <div class="bp-section" id="bp-box-list-section" style="display:none">
          <div class="bp-step"><span class="bp-step-num">3</span> 为每个方框绑定目标字段</div>
          <div class="bp-box-list" id="bp-box-list"></div>
          <div class="bp-hint" style="margin-top:8px;padding:6px 8px;background:#fffbe6;border:1px solid #ffe58f;border-radius:4px;font-size:11px;color:#8c6e2a;">
            <b>备注自动组合：</b>识别"订单号、个人支付金额、政府补贴金额、商品编码"后，<br>
            自动按模板生成备注填入（能效等级固定为"一级"）：<br>
            <span id="bp-remark-template-preview" style="color:#d48806;display:inline-block;margin-top:2px;"></span>
            <button class="bp-btn bp-btn-secondary" id="bp-edit-template-btn" style="font-size:11px;padding:2px 8px;margin-top:4px;">✏️ 编辑模板</button>
          </div>
        </div>

        <div class="bp-section" id="bp-action-section" style="display:none">
          <button class="bp-btn bp-btn-primary" id="bp-ocr-only-btn">🔍 仅识别</button>
          <button class="bp-btn bp-btn-primary" id="bp-fill-btn" style="background:#52c41a;border-color:#52c41a;display:none;">✅ 填入已识别结果</button>
          <button class="bp-btn bp-btn-secondary" id="bp-ocr-btn">🔍 识别并填入</button>
          <button class="bp-btn bp-btn-secondary" id="bp-clear-boxes-btn">清除所有框</button>
          <button class="bp-btn bp-btn-secondary" id="bp-add-image-btn">＋ 添加图片</button>
          <button class="bp-btn bp-btn-secondary" id="bp-del-image-btn">删除当前图</button>
          <button class="bp-btn bp-btn-secondary" id="bp-reupload-btn">全部重置</button>
        </div>

        <div id="bp-status-area"></div>
        <div class="bp-fill-log" id="bp-fill-log"></div>

        <div class="bp-section" style="border-top:1px solid #eee;padding-top:10px;">
          <button class="bp-btn bp-btn-secondary" id="bp-debug-write-btn" style="background:#fff3cd;border-color:#ffc107;color:#856404;width:100%;">🔧 调试写入"规格型号"（测试值）</button>
        </div>

      </div>
      <div class="bp-resize-handle" id="bp-resize-handle" title="拖拽调整面板大小"></div>
    `;
    document.body.appendChild(panel);
    bindEvents();
    makeDraggable();
    updateEngineInfo();
    updateTemplatePreview();
    updateZoomLabel();
    log('面板已加载');
  }

  // ============================================================
  //  OCR 引擎信息显示 + 设置弹窗
  // ============================================================
  function updateEngineInfo() {
    const infoEl = document.getElementById('bp-ocr-engine-info');
    if (!infoEl) return;
    const engine = GM_getValue('ocr_engine', 'tesseract');
    if (engine === 'doubao' && isDoubaoConfigured()) {
      infoEl.innerHTML = '<span style="color:#52c41a;">🫘 豆包视觉模型已配置</span>（识别最准确，推荐）';
    } else if (engine === 'glm' && isGlmConfigured()) {
      infoEl.innerHTML = '<span style="color:#52c41a;">🧠 智谱 GLM-4.6V 已配置</span>（永久免费，推荐）';
    } else if (engine === 'baidu' && isBaiduConfigured()) {
      infoEl.innerHTML = '<span style="color:#52c41a;">🔍 百度 OCR 已配置</span>';
    } else if (engine === 'ocrspace' && isOcrSpaceConfigured()) {
      infoEl.innerHTML = '<span style="color:#52c41a;">🌐 OCR.space 已配置</span>（免费，每月25000次）';
    } else {
      infoEl.innerHTML = '<span style="color:#faad14;">⚠️ 未配置 OCR 引擎</span>，将使用本地引擎（效果差）。点击"配置"按钮设置。';
    }
  }

  function showSettingsDialog() {
    // 移除已有的弹窗
    const existing = document.getElementById('bp-settings-overlay');
    if (existing) existing.remove();

    const currentEngine = GM_getValue('ocr_engine', isDoubaoConfigured() ? 'doubao' : (isGlmConfigured() ? 'glm' : (isOcrSpaceConfigured() ? 'ocrspace' : (isBaiduConfigured() ? 'baidu' : 'tesseract'))));

    const overlay = document.createElement('div');
    overlay.id = 'bp-settings-overlay';
    overlay.innerHTML = `
      <div class="bp-settings-box" style="width:460px;max-height:85vh;overflow-y:auto;">
        <div class="bp-settings-title">⚙️ OCR 引擎配置</div>

        <div class="bp-settings-field">
          <div class="bp-settings-label">选择识别引擎</div>
          <div class="bp-engine-radio" style="flex-direction:column;gap:8px;">
            <label><input type="radio" name="bp-engine" value="doubao" ${currentEngine === 'doubao' ? 'checked' : ''}> 🫘 豆包视觉模型（推荐，识别最准确）</label>
            <label><input type="radio" name="bp-engine" value="glm" ${currentEngine === 'glm' ? 'checked' : ''}> 🧠 智谱 GLM-4.6V-Flash（永久免费，推荐替代豆包）</label>
            <label><input type="radio" name="bp-engine" value="ocrspace" ${currentEngine === 'ocrspace' ? 'checked' : ''}> 🌐 OCR.space（免费，每月25000次）</label>
            <label><input type="radio" name="bp-engine" value="baidu" ${currentEngine === 'baidu' ? 'checked' : ''}> 🔍 百度 OCR（速度快）</label>
            <label><input type="radio" name="bp-engine" value="tesseract" ${currentEngine === 'tesseract' ? 'checked' : ''}> 📦 本地 Tesseract（无需配置，效果差）</label>
          </div>
        </div>

        <hr style="border:none;border-top:1px solid #eee;margin:16px 0;">

        <!-- 豆包配置 -->
        <div id="bp-doubao-config" style="${currentEngine === 'doubao' ? '' : 'display:none;'}">
          <div class="bp-settings-title" style="font-size:13px;">🫘 豆包（火山引擎方舟）配置</div>
          <div class="bp-settings-field">
            <div class="bp-settings-label">API Key</div>
            <input class="bp-settings-input" id="bp-doubao-key" type="password" value="${DOUBAO.apiKey || ''}" placeholder="粘贴火山引擎方舟的 API Key">
          </div>
          <div class="bp-settings-field">
            <div class="bp-settings-label">模型 ID（支持 Model ID 或 Endpoint ID）</div>
            <input class="bp-settings-input" id="bp-doubao-model" type="text" value="${DOUBAO.modelId}" placeholder="doubao-seed-2-0-mini-260215">
            <div style="font-size:11px; color:#999; margin-top:4px;">
              可选模型：doubao-seed-2-0-mini-260215（推荐）<br>
              doubao-seed-2-0-pro-260215 / doubao-seed-1-6-vision-250815<br>
              也可填入推理接入点 ID（ep-开头）
            </div>
          </div>
          <div class="bp-settings-hint">
            获取方式：登录 <a href="https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey" target="_blank">火山引擎方舟控制台</a>
            → API Key 管理 → 创建 API Key<br>
            需先在"开通管理"中开通对应模型服务<br>
            注意：旧模型 doubao-1.5-vision-pro-32k 已退役，请使用上述新模型
          </div>
        </div>

        <!-- 百度配置 -->
        <div id="bp-baidu-config" style="${currentEngine === 'baidu' ? '' : 'display:none;'}">
          <div class="bp-settings-title" style="font-size:13px;">🔍 百度 OCR 配置</div>
          <div class="bp-settings-field">
            <div class="bp-settings-label">API Key</div>
            <input class="bp-settings-input" id="bp-api-key" type="text" value="${BAIDU_OCR.apiKey || ''}" placeholder="粘贴百度智能云的 API Key">
          </div>
          <div class="bp-settings-field">
            <div class="bp-settings-label">Secret Key</div>
            <input class="bp-settings-input" id="bp-secret-key" type="password" value="${BAIDU_OCR.secretKey || ''}" placeholder="粘贴百度智能云的 Secret Key">
          </div>
          <div class="bp-settings-field">
            <div class="bp-settings-label">识别模式</div>
            <div class="bp-engine-radio">
              <label><input type="radio" name="bp-precision" value="standard" ${GM_getValue('baidu_high_precision', false) ? '' : 'checked'}> 标准识别（快）</label>
              <label><input type="radio" name="bp-precision" value="high" ${GM_getValue('baidu_high_precision', false) ? 'checked' : ''}> 高精度识别（准）</label>
            </div>
          </div>
          <div class="bp-settings-hint">
            获取方式：登录 <a href="https://console.bce.baidu.com/ai/#/ai/ocr/app/list" target="_blank">百度智能云控制台</a>
            → 文字识别 → 创建应用 → 复制 API Key 和 Secret Key<br>
            免费额度：通用文字识别（标准）每月 1000 次，高精度每月 500 次
          </div>
        </div>

        <!-- 智谱 GLM 配置 -->
        <div id="bp-glm-config" style="${currentEngine === 'glm' ? '' : 'display:none;'}">
          <div class="bp-settings-title" style="font-size:13px;">🧠 智谱 GLM-4.6V-Flash 配置</div>
          <div class="bp-settings-field">
            <div class="bp-settings-label">API Key</div>
            <input class="bp-settings-input" id="bp-glm-key" type="password" value="${GLM.apiKey || ''}" placeholder="粘贴智谱AI开放平台的 API Key">
          </div>
          <div class="bp-settings-hint">
            获取方式：登录 <a href="https://open.bigmodel.cn/usercenter/apikeys" target="_blank">智谱AI开放平台</a>
            → 控制台 → API Keys → 创建 API Key<br>
            <span style="color:#52c41a;font-weight:600;">GLM-4.6V-Flash 永久免费</span>，无额度限制，适合替代豆包<br>
            新用户还有 2500 万 Tokens 体验额度（其他付费模型可用）
          </div>
        </div>

        <!-- OCR.space 配置 -->
        <div id="bp-ocrspace-config" style="${currentEngine === 'ocrspace' ? '' : 'display:none;'}">
          <div class="bp-settings-title" style="font-size:13px;">🌐 OCR.space 配置</div>
          <div class="bp-settings-field">
            <div class="bp-settings-label">API Key</div>
            <input class="bp-settings-input" id="bp-ocrspace-key" type="password" value="${OCR_SPACE.apiKey || ''}" placeholder="粘贴 OCR.space 的免费 API Key">
          </div>
          <div class="bp-settings-hint">
            获取方式：打开 <a href="https://ocr.space/ocrapi/freekey" target="_blank">OCR.space 注册页</a>
            → 输入邮箱 → 收到 API Key<br>
            免费 25000 次/月，支持中文，但识别效果不如大模型
          </div>
        </div>

        <div class="bp-settings-actions">
          <button class="bp-btn bp-btn-secondary" id="bp-settings-cancel">取消</button>
          <button class="bp-btn bp-btn-primary" id="bp-settings-save">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // 引擎切换时显示/隐藏对应配置
    overlay.querySelectorAll('input[name="bp-engine"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        document.getElementById('bp-doubao-config').style.display = e.target.value === 'doubao' ? '' : 'none';
        document.getElementById('bp-glm-config').style.display = e.target.value === 'glm' ? '' : 'none';
        document.getElementById('bp-ocrspace-config').style.display = e.target.value === 'ocrspace' ? '' : 'none';
        document.getElementById('bp-baidu-config').style.display = e.target.value === 'baidu' ? '' : 'none';
      });
    });

    // 关闭
    document.getElementById('bp-settings-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // 保存
    document.getElementById('bp-settings-save').addEventListener('click', () => {
      const engine = document.querySelector('input[name="bp-engine"]:checked').value;
      GM_setValue('ocr_engine', engine);

      // 保存豆包配置
      if (engine === 'doubao') {
        const apiKey = document.getElementById('bp-doubao-key').value.trim();
        const modelId = document.getElementById('bp-doubao-model').value.trim();
        if (!apiKey) {
          alert('请填写豆包 API Key');
          return;
        }
        saveDoubaoConfig(apiKey, modelId);
      }

      // 保存百度配置
      if (engine === 'baidu') {
        const apiKey = document.getElementById('bp-api-key').value.trim();
        const secretKey = document.getElementById('bp-secret-key').value.trim();
        const highPrecision = document.querySelector('input[name="bp-precision"]:checked').value === 'high';
        if (!apiKey || !secretKey) {
          alert('请填写百度 API Key 和 Secret Key');
          return;
        }
        saveBaiduConfig(apiKey, secretKey);
        GM_setValue('baidu_high_precision', highPrecision);
      }

      // 保存智谱 GLM 配置
      if (engine === 'glm') {
        const apiKey = document.getElementById('bp-glm-key').value.trim();
        if (!apiKey) {
          alert('请填写智谱 AI API Key');
          return;
        }
        saveGlmConfig(apiKey);
      }

      // 保存 OCR.space 配置
      if (engine === 'ocrspace') {
        const apiKey = document.getElementById('bp-ocrspace-key').value.trim();
        if (!apiKey) {
          alert('请填写 OCR.space API Key');
          return;
        }
        saveOcrSpaceConfig(apiKey);
      }

      updateEngineInfo();
      overlay.remove();
      const engineNames = { doubao: '豆包视觉模型', glm: '智谱 GLM-4.6V', ocrspace: 'OCR.space', baidu: '百度 OCR', tesseract: '本地 Tesseract' };
      showStatus('success', `${engineNames[engine]} 配置已保存！`);
      log('OCR 引擎配置已保存:', engine);
    });
  }

  // ============================================================
  //  事件绑定
  // ============================================================
  function bindEvents() {
    document.getElementById('bp-close').addEventListener('click', () => {
      document.getElementById('box-panel').remove();
    });

    // 设置按钮
    document.getElementById('bp-settings-btn').addEventListener('click', showSettingsDialog);

    const uploadZone = document.getElementById('bp-upload-zone');
    const fileInput = document.getElementById('bp-file-input');

    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.style.borderColor = '#4A90E2';
    });
    uploadZone.addEventListener('dragleave', () => uploadZone.style.borderColor = '');
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation(); // 阻止冒泡到面板级 drop，避免重复处理
      uploadZone.style.borderColor = '';
      const files = e.dataTransfer.files;
      for (const file of files) {
        if (file.type.startsWith('image/')) handleImageFile(file);
      }
    });
    fileInput.addEventListener('change', (e) => {
      const files = e.target.files;
      for (const file of files) {
        if (file.type.startsWith('image/')) handleImageFile(file);
      }
      e.target.value = ''; // 清空，允许重复选择同一文件
    });

    // 图片缩放/旋转按钮
    document.getElementById('bp-zoom-in').addEventListener('click', () => setCanvasZoom(canvasZoom * 1.25));
    document.getElementById('bp-zoom-out').addEventListener('click', () => setCanvasZoom(canvasZoom / 1.25));
    document.getElementById('bp-rotate-left').addEventListener('click', () => rotateCurrentImage(-90));
    document.getElementById('bp-rotate-right').addEventListener('click', () => rotateCurrentImage(90));
    document.getElementById('bp-img-reset').addEventListener('click', resetImageView);

    // 滚轮缩放（按住 Ctrl/Meta 时缩放，否则正常滚动图片）
    const canvasWrap = document.getElementById('bp-canvas-wrap');
    canvasWrap.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setCanvasZoom(canvasZoom * (e.deltaY < 0 ? 1.1 : 0.9));
      }
      // 不按 Ctrl 时，让浏览器正常滚动
    }, { passive: false });

    // 模板编辑按钮
    document.getElementById('bp-edit-template-btn').addEventListener('click', showTemplateEditor);

    // 面板缩放手柄
    makeResizable();

    document.getElementById('bp-ocr-btn').addEventListener('click', () => recognizeAndFill(true));
    document.getElementById('bp-ocr-only-btn').addEventListener('click', () => recognizeAndFill(false));
    document.getElementById('bp-fill-btn').addEventListener('click', fillRecognizedValues);
    document.getElementById('bp-debug-write-btn').addEventListener('click', debugWriteSpec);
    document.getElementById('bp-clear-boxes-btn').addEventListener('click', () => {
      boxes = [];
      drawCanvas();
      renderBoxList();
    });
    document.getElementById('bp-add-image-btn').addEventListener('click', () => {
      document.getElementById('bp-file-input').click();
    });
    document.getElementById('bp-del-image-btn').addEventListener('click', () => {
      if (images.length <= 1) {
        showStatus('warning', '至少保留一张图片');
        return;
      }
      // 删除当前图片的框
      boxes = boxes.filter(b => b.imageIndex !== currentImageIndex);
      // 删除图片
      images.splice(currentImageIndex, 1);
      // 调整其他框的 imageIndex
      boxes.forEach(b => {
        if (b.imageIndex > currentImageIndex) b.imageIndex--;
      });
      currentImageIndex = Math.max(0, currentImageIndex - 1);
      initCanvas();
      drawCanvas();
      renderImageTabs();
      renderBoxList();
      showStatus('info', `已删除图片，当前剩余 ${images.length} 张`);
    });
    document.getElementById('bp-reupload-btn').addEventListener('click', () => {
      images = [];
      currentImageIndex = 0;
      boxes = [];
      document.getElementById('bp-canvas-section').style.display = 'none';
      document.getElementById('bp-box-list-section').style.display = 'none';
      document.getElementById('bp-action-section').style.display = 'none';
      document.getElementById('bp-upload-zone').style.display = 'block';
      document.getElementById('bp-file-input').value = '';
      showStatus('');
    });

    // 全面板拖拽接收图片（已有图片后也支持拖拽添加新图片）
    const panel = document.getElementById('box-panel');
    panel.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        panel.classList.add('bp-dragover');
      }
    });
    panel.addEventListener('dragleave', (e) => {
      if (e.target === panel) panel.classList.remove('bp-dragover');
    });
    panel.addEventListener('drop', (e) => {
      e.preventDefault();
      panel.classList.remove('bp-dragover');
      const files = e.dataTransfer.files;
      let imgCount = 0;
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          handleImageFile(file);
          imgCount++;
        }
      }
      if (imgCount === 0) {
        // 非图片文件，给个提示
        showStatus('warning', '请拖入图片文件（jpg/png）');
      }
    });
  }

  // ============================================================
  //  图片处理 + Canvas 初始化
  // ============================================================
  function handleImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result;
      const img = new Image();
      img.onload = () => {
        images.push({ img, base64, rotation: 0 });
        currentImageIndex = images.length - 1;
        canvasZoom = 1.0;
        initCanvas();
        renderImageTabs();
        updateZoomLabel();
        document.getElementById('bp-upload-zone').style.display = 'none';
        document.getElementById('bp-canvas-section').style.display = 'block';
        document.getElementById('bp-box-list-section').style.display = 'block';
        document.getElementById('bp-action-section').style.display = 'block';
        showStatus('info', `已加载第 ${images.length} 张图片。请在图片上拖拽画方框，框选要提取的信息。`);
      };
      img.src = base64;
    };
    reader.readAsDataURL(file);
  }

  function renderImageTabs() {
    const tabsEl = document.getElementById('bp-image-tabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    images.forEach((imgObj, idx) => {
      const tab = document.createElement('div');
      tab.style.cssText = `padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;border:1px solid ${idx === currentImageIndex ? '#4A90E2' : '#d9d9d9'};background:${idx === currentImageIndex ? '#4A90E2' : '#fff'};color:${idx === currentImageIndex ? '#fff' : '#666'};`;
      tab.textContent = `图${idx + 1}`;
      tab.addEventListener('click', () => {
        currentImageIndex = idx;
        initCanvas();
        drawCanvas();
        renderImageTabs();
      });
      tabsEl.appendChild(tab);
    });
    // 添加"+"按钮
    const addTab = document.createElement('div');
    addTab.style.cssText = 'padding:4px 10px;border-radius:4px;cursor:pointer;font-size:14px;border:1px dashed #d9d9d9;color:#999;background:#fafafa;';
    addTab.textContent = '＋';
    addTab.title = '添加图片';
    addTab.addEventListener('click', () => {
      document.getElementById('bp-file-input').click();
    });
    tabsEl.appendChild(addTab);
  }

  // ============================================================
  //  图片缩放 / 旋转控制
  // ============================================================
  function updateZoomLabel() {
    const el = document.getElementById('bp-zoom-label');
    if (el) el.textContent = Math.round(canvasZoom * 100) + '%';
  }

  function setCanvasZoom(newZoom) {
    canvasZoom = Math.max(0.25, Math.min(5, newZoom));
    initCanvas();
    updateZoomLabel();
  }

  function rotateCurrentImage(delta) {
    const imgObj = images[currentImageIndex];
    if (!imgObj) return;
    // 更新旋转角度（0 → 90 → 180 → 270 → 0）
    imgObj.rotation = ((imgObj.rotation || 0) + delta + 360) % 360;
    // 旋转后框坐标失效，清除当前图片的框
    const hadBoxes = boxes.some(b => b.imageIndex === currentImageIndex);
    boxes = boxes.filter(b => b.imageIndex !== currentImageIndex);
    initCanvas();
    renderBoxList();
    if (hadBoxes) {
      showStatus('warning', `图片已旋转 ${imgObj.rotation}°，之前的框已清除，请重新画框。`);
    } else {
      showStatus('info', `图片已旋转 ${imgObj.rotation}°。`);
    }
  }

  function resetImageView() {
    canvasZoom = 1.0;
    const imgObj = images[currentImageIndex];
    if (imgObj) imgObj.rotation = 0;
    initCanvas();
    updateZoomLabel();
    showStatus('info', '图片视图已重置。');
  }

  function initCanvas() {
    canvas = document.getElementById('bp-canvas');
    ctx = canvas.getContext('2d');

    const curImgObj = images[currentImageIndex];
    if (!curImgObj) return;
    const curImg = curImgObj.img;
    const rotation = curImgObj.rotation || 0;

    // 根据旋转角度计算有效宽高
    const isSideways = rotation === 90 || rotation === 270;
    const effW = isSideways ? curImg.height : curImg.width;
    const effH = isSideways ? curImg.width : curImg.height;

    // 缩放图片到合适大小（根据面板实际宽度动态计算 × 缩放倍率）
    const panel = document.getElementById('box-panel');
    const panelW = panel ? panel.getBoundingClientRect().width : 420;
    const baseW = Math.max(280, panelW - 40); // 面板宽度减去 padding
    const maxW = baseW * canvasZoom;
    const scale = effW > maxW ? maxW / effW : 1;
    canvas.width = effW * scale;
    canvas.height = effH * scale;

    // 关闭抗锯齿平滑，保留像素清晰度
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    drawCanvas();
    bindCanvasEvents();
  }

  function drawCanvas() {
    const curImgObj = images[currentImageIndex];
    if (!ctx || !curImgObj) return;
    const curImg = curImgObj.img;
    const rotation = curImgObj.rotation || 0;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    // 应用旋转变换
    if (rotation === 0) {
      ctx.drawImage(curImg, 0, 0, canvas.width, canvas.height);
    } else {
      // 以 canvas 中心为旋转中心
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rotation * Math.PI / 180);
      // 旋转后绘制：对于 90/270 度，宽高互换
      if (rotation === 90 || rotation === 270) {
        ctx.drawImage(curImg, -canvas.height / 2, -canvas.width / 2, canvas.height, canvas.width);
      } else {
        ctx.drawImage(curImg, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
      }
    }
    ctx.restore();

    // 画已有的框（只画当前图片的框）
    for (const box of boxes) {
      if (box.imageIndex !== currentImageIndex) continue;
      const isSelected = box.id === selectedBoxId;
      ctx.strokeStyle = box.color;
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      // 半透明填充
      ctx.fillStyle = box.color + '20';
      ctx.fillRect(box.x, box.y, box.w, box.h);
      // 标签
      const label = TARGET_FIELDS.find((f) => f.key === box.fieldKey)?.label || '未绑定';
      ctx.fillStyle = box.color;
      ctx.font = 'bold 11px sans-serif';
      const labelW = ctx.measureText(label).width + 8;
      ctx.fillRect(box.x, box.y - 16, labelW, 16);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, box.x + 4, box.y - 4);

      // 选中状态：画8个调整手柄
      if (isSelected) {
        const handles = getHandlePositions(box);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = box.color;
        ctx.lineWidth = 2;
        for (const [name, hx, hy] of handles) {
          ctx.beginPath();
          ctx.arc(hx, hy, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // 正在画的框
    if (isDrawing) {
      const x = Math.min(drawStart.x, drawCurrent.x);
      const y = Math.min(drawStart.y, drawCurrent.y);
      const w = Math.abs(drawCurrent.x - drawStart.x);
      const h = Math.abs(drawCurrent.y - drawStart.y);
      ctx.strokeStyle = '#4A90E2';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
  }

  // 获取方框8个手柄的位置 [name, x, y]
  function getHandlePositions(box) {
    return [
      ['nw', box.x, box.y],
      ['n',  box.x + box.w / 2, box.y],
      ['ne', box.x + box.w, box.y],
      ['e',  box.x + box.w, box.y + box.h / 2],
      ['se', box.x + box.w, box.y + box.h],
      ['s',  box.x + box.w / 2, box.y + box.h],
      ['sw', box.x, box.y + box.h],
      ['w',  box.x, box.y + box.h / 2],
    ];
  }

  // 检测鼠标是否在某个手柄上
  function getResizeHandleAt(mx, my) {
    for (const box of boxes) {
      if (box.id !== selectedBoxId) continue;
      const handles = getHandlePositions(box);
      for (const [name, hx, hy] of handles) {
        if (Math.abs(mx - hx) <= HANDLE_SIZE && Math.abs(my - hy) <= HANDLE_SIZE) {
          return { boxId: box.id, handle: name };
        }
      }
    }
    return null;
  }

  // 检测鼠标是否在某个方框内部
  function getBoxAt(mx, my) {
    for (let i = boxes.length - 1; i >= 0; i--) {
      const box = boxes[i];
      if (mx >= box.x && mx <= box.x + box.w && my >= box.y && my <= box.y + box.h) {
        return box;
      }
    }
    return null;
  }

  // 根据手柄方向获取鼠标样式
  function getCursorForHandle(handle) {
    const cursors = {
      'nw': 'nwse-resize', 'se': 'nwse-resize',
      'ne': 'nesw-resize', 'sw': 'nesw-resize',
      'n': 'ns-resize', 's': 'ns-resize',
      'e': 'ew-resize', 'w': 'ew-resize',
    };
    return cursors[handle] || 'crosshair';
  }

  // 执行调整大小逻辑
  function applyResize(dx, dy) {
    const box = boxes.find((b) => b.id === resizeBoxId);
    if (!box) return;
    let { bx, by, bw, bh } = resizeStart;
    const minSize = 10;

    switch (resizeHandle) {
      case 'nw': bx += dx; by += dy; bw -= dx; bh -= dy; break;
      case 'n':  by += dy; bh -= dy; break;
      case 'ne': by += dy; bw += dx; bh -= dy; break;
      case 'e':  bw += dx; break;
      case 'se': bw += dx; bh += dy; break;
      case 's':  bh += dy; break;
      case 'sw': bx += dx; bw -= dx; bh += dy; break;
      case 'w':  bx += dx; bw -= dx; break;
    }

    // 最小尺寸约束
    if (bw < minSize) { if (resizeHandle.includes('w')) bx -= (minSize - bw); bw = minSize; }
    if (bh < minSize) { if (resizeHandle.includes('n')) by -= (minSize - bh); bh = minSize; }

    box.x = bx; box.y = by; box.w = bw; box.h = bh;
  }

  // ============================================================
  //  Canvas 鼠标事件 —— 画框
  // ============================================================
  function bindCanvasEvents() {
    const getMousePos = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * canvas.width,
        y: ((e.clientY - rect.top) / rect.height) * canvas.height,
      };
    };

    canvas.addEventListener('mousedown', (e) => {
      const pos = getMousePos(e);

      // 1. 先检查是否点中了选中方框的手柄 → 开始调整大小
      const handle = getResizeHandleAt(pos.x, pos.y);
      if (handle) {
        isResizing = true;
        resizeBoxId = handle.boxId;
        resizeHandle = handle.handle;
        const box = boxes.find((b) => b.id === resizeBoxId);
        resizeStart = {
          x: pos.x, y: pos.y,
          bx: box.x, by: box.y, bw: box.w, bh: box.h,
        };
        e.preventDefault();
        return;
      }

      // 2. 检查是否点中了某个已有方框 → 选中它（显示手柄）
      const clickedBox = getBoxAt(pos.x, pos.y);
      if (clickedBox) {
        selectedBoxId = clickedBox.id;
        drawCanvas();
        renderBoxList();
        return;
      }

      // 3. 都不是 → 开始画新框
      selectedBoxId = null;
      isDrawing = true;
      drawStart = pos;
      drawCurrent = { ...pos };
      drawCanvas();
    });

    canvas.addEventListener('mousemove', (e) => {
      const pos = getMousePos(e);

      // 正在调整大小
      if (isResizing) {
        const dx = pos.x - resizeStart.x;
        const dy = pos.y - resizeStart.y;
        applyResize(dx, dy);
        drawCanvas();
        return;
      }

      // 正在画框
      if (isDrawing) {
        drawCurrent = pos;
        drawCanvas();
        return;
      }

      // 悬停：更新鼠标样式
      const handle = getResizeHandleAt(pos.x, pos.y);
      if (handle) {
        canvas.style.cursor = getCursorForHandle(handle.handle);
      } else if (getBoxAt(pos.x, pos.y)) {
        canvas.style.cursor = 'move';
      } else {
        canvas.style.cursor = 'crosshair';
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      // 结束调整大小
      if (isResizing) {
        isResizing = false;
        resizeHandle = null;
        resizeBoxId = null;
        drawCanvas();
        return;
      }

      // 结束画框
      if (!isDrawing) return;
      isDrawing = false;
      drawCurrent = getMousePos(e);

      const x = Math.min(drawStart.x, drawCurrent.x);
      const y = Math.min(drawStart.y, drawCurrent.y);
      const w = Math.abs(drawCurrent.x - drawStart.x);
      const h = Math.abs(drawCurrent.y - drawStart.y);

      // 太小的框忽略
      if (w < 10 || h < 10) {
        drawCanvas();
        return;
      }

      // 创建新框
      const color = BOX_COLORS[boxes.length % BOX_COLORS.length];
      // 根据当前框数量自动选择默认字段
      const defaultFieldKey = DEFAULT_FIELD_ORDER[boxes.length % DEFAULT_FIELD_ORDER.length];
      const newBox = {
        id: Date.now(),
        x, y, w, h,
        fieldKey: defaultFieldKey,
        color,
        result: '',
        imageIndex: currentImageIndex, // 记录该框属于哪张图片
      };
      boxes.push(newBox);
      selectedBoxId = newBox.id; // 自动选中新画的框
      drawCanvas();
      renderBoxList();
      showStatus('info', `已画 ${boxes.length} 个框。点击方框可选中并拖拽手柄调整大小。`);
    });

    canvas.addEventListener('mouseleave', () => {
      if (isDrawing) {
        isDrawing = false;
        drawCanvas();
      }
      if (isResizing) {
        isResizing = false;
        resizeHandle = null;
        resizeBoxId = null;
        drawCanvas();
      }
      canvas.style.cursor = 'crosshair';
    });
  }

  // ============================================================
  //  方框列表渲染
  // ============================================================
  function renderBoxList() {
    const listEl = document.getElementById('bp-box-list');
    listEl.innerHTML = '';

    if (boxes.length === 0) {
      listEl.innerHTML = '<div style="color:#999;font-size:12px;padding:4px;">还没有画框。在上方图片上拖拽即可画框。</div>';
      return;
    }

    boxes.forEach((box, idx) => {
      const item = document.createElement('div');
      item.className = 'bp-box-item';
      item.innerHTML = `
        <div class="bp-box-color" style="background:${box.color}"></div>
        <span style="font-size:11px;color:#999;flex-shrink:0;">图${(box.imageIndex ?? 0) + 1}-框${idx + 1}</span>
        <select data-box-id="${box.id}">
          ${TARGET_FIELDS.map((f) =>
            `<option value="${f.key}" ${f.key === box.fieldKey ? 'selected' : ''}>${f.label}</option>`
          ).join('')}
        </select>
        ${box.result ? `<span class="bp-box-result ${box.valid === false ? 'bp-box-result-invalid' : box.valid === true ? 'bp-box-result-valid' : ''} bp-box-result-editable" contenteditable="true" spellcheck="false" data-box-id="${box.id}" title="点击可编辑识别结果&#10;${box.validationMessage ? box.validationMessage + ' | ' : ''}${box.result}">${box.valid === false ? '❌ ' : box.valid === true ? '✅ ' : ''}${box.result}</span>` : ''}
        <span class="bp-box-del" data-box-id="${box.id}">&times;</span>
      `;
      listEl.appendChild(item);
    });

    // 绑定字段选择
    listEl.querySelectorAll('select').forEach((sel) => {
      sel.addEventListener('change', (e) => {
        const id = parseInt(e.target.getAttribute('data-box-id'));
        const box = boxes.find((b) => b.id === id);
        if (box) {
          box.fieldKey = e.target.value;
          drawCanvas();
        }
      });
    });

    // 绑定结果编辑（失焦时保存并重新验证）
    listEl.querySelectorAll('.bp-box-result-editable').forEach((span) => {
      span.addEventListener('blur', (e) => {
        const id = parseInt(e.target.getAttribute('data-box-id'));
        const box = boxes.find((b) => b.id === id);
        if (!box) return;
        // 取纯文本，去掉前面的 ✅/❌ 图标
        let edited = e.target.textContent.replace(/^[✅❌]\s*/, '').trim();
        if (edited !== box.result) {
          box.result = edited;
          // 重新验证
          const validation = validateField(box.fieldKey, edited);
          box.valid = validation.valid;
          box.validationMessage = validation.message;
          log(`手动修正 图${(box.imageIndex ?? 0) + 1}-框:`, edited, validation.valid ? '✅' : '❌');
          // 刷新显示（保留焦点不重渲染，只更新样式）
          e.target.className = 'bp-box-result bp-box-result-editable ' + (box.valid === false ? 'bp-box-result-invalid' : 'bp-box-result-valid');
          e.target.textContent = (box.valid === false ? '❌ ' : '✅ ') + edited;
          e.target.title = (box.validationMessage ? box.validationMessage + ' | ' : '') + '点击可编辑识别结果';
        }
      });
      // 阻止编辑时的回车换行
      span.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.target.blur();
        }
      });
    });

    // 绑定删除
    listEl.querySelectorAll('.bp-box-del').forEach((del) => {
      del.addEventListener('click', (e) => {
        const id = parseInt(e.target.getAttribute('data-box-id'));
        boxes = boxes.filter((b) => b.id !== id);
        drawCanvas();
        renderBoxList();
      });
    });
  }

  // ============================================================
  //  核心：裁剪方框区域 → OCR 识别 → 填入表单
  // ============================================================
  async function recognizeAndFill(doFill = true) {
    if (boxes.length === 0) {
      showStatus('error', '请先在图片上画至少一个方框');
      return;
    }

    const btn = document.getElementById(doFill ? 'bp-ocr-btn' : 'bp-ocr-only-btn');
    btn.disabled = true;
    btn.textContent = '识别中...';
    // 仅识别模式下隐藏填入按钮
    if (!doFill) {
      const fillBtn = document.getElementById('bp-fill-btn');
      if (fillBtn) fillBtn.style.display = 'none';
    }
    const logEl = document.getElementById('bp-fill-log');
    logEl.innerHTML = '';
    const addLog = (text, type) => {
      const div = document.createElement('div');
      div.className = type || '';
      div.textContent = (type === 'ok' ? '✅ ' : type === 'fail' ? '❌ ' : '• ') + text;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    };

    const engine = GM_getValue('ocr_engine', 'tesseract');
    const useDoubao = engine === 'doubao' && isDoubaoConfigured();
    const useGlm = engine === 'glm' && isGlmConfigured();
    const useOcrSpace = engine === 'ocrspace' && isOcrSpaceConfigured();
    const useBaidu = engine === 'baidu' && isBaiduConfigured();
    const highPrecision = GM_getValue('baidu_high_precision', false);

    if (useDoubao) {
      showStatus('warning', '正在使用豆包视觉模型识别，请稍候...');
    } else if (useGlm) {
      showStatus('warning', '正在使用智谱 GLM-4.6V 视觉模型识别，请稍候...');
    } else if (useOcrSpace) {
      showStatus('warning', '正在使用 OCR.space 识别，请稍候...');
    } else if (useBaidu) {
      showStatus('warning', '正在使用百度 OCR 识别，请稍候...');
    } else {
      showStatus('warning', '正在加载本地 OCR 引擎，首次需 10-30 秒...');
      try {
        await loadTesseract();
      } catch (err) {
        showStatus('error', '本地 OCR 引擎加载失败：' + err.message + '。建议配置智谱 GLM（免费）或豆包。');
        btn.disabled = false;
        btn.textContent = '🔍 识别并填入';
        return;
      }
    }

    showStatus('warning', '正在逐个识别方框区域，请稍候...');

    if (doFill) {
      // 自动选中"不含税"选项
      const noTaxSelected = autoSelectNoTax();
      if (noTaxSelected) {
        const logDiv = document.createElement('div');
        logDiv.className = 'ok';
        logDiv.textContent = '✅ 已自动选中"不含税"选项';
        logEl.appendChild(logDiv);
      }

      // 自动勾选"是否开票给自然人"
      const naturalPersonChecked = autoCheckNaturalPerson();
      if (naturalPersonChecked) {
        const logDiv = document.createElement('div');
        logDiv.className = 'ok';
        logDiv.textContent = '✅ 已自动勾选"是否开票给自然人"';
        logEl.appendChild(logDiv);
      }
    }

    let successCount = 0;
    const virtualValues = {}; // 存储虚拟字段值，用于组合备注
    let remarkDirectlyFilled = false; // 标记备注是否已被直接填入

    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      const fieldInfo = TARGET_FIELDS.find((f) => f.key === box.fieldKey);

      addLog(`识别图${(box.imageIndex ?? 0) + 1}-框${i + 1}（${fieldInfo.label}）...`);
      showStatus('warning', `正在识别图${(box.imageIndex ?? 0) + 1}-框${i + 1}/${boxes.length}（${fieldInfo.label}）...`);

      try {
        // 获取该方框对应的图片对象（包含旋转信息）
        const imgObj = images[box.imageIndex];
        if (!imgObj) {
          addLog(`图${(box.imageIndex ?? 0) + 1}-框${i + 1} 找不到对应图片，跳过`, 'fail');
          continue;
        }
        const boxImg = imgObj.img;
        const rotation = imgObj.rotation || 0;

        // 先把旋转后的完整图片画到临时 canvas（与 canvas 显示完全一致）
        const isSideways = rotation === 90 || rotation === 270;
        const effW = isSideways ? boxImg.height : boxImg.width;
        const effH = isSideways ? boxImg.width : boxImg.height;
        const panelEl = document.getElementById('box-panel');
        const panelW = panelEl ? panelEl.getBoundingClientRect().width : 420;
        const baseW = Math.max(280, panelW - 40);
        const maxW = baseW * canvasZoom;
        const dispScale = effW > maxW ? maxW / effW : 1;
        const dispW = Math.round(effW * dispScale);
        const dispH = Math.round(effH * dispScale);

        // 画旋转后的完整图片到临时 canvas
        const rotCanvas = document.createElement('canvas');
        rotCanvas.width = dispW;
        rotCanvas.height = dispH;
        const rotCtx = rotCanvas.getContext('2d');
        rotCtx.imageSmoothingEnabled = true;
        rotCtx.imageSmoothingQuality = 'high';
        if (rotation === 0) {
          rotCtx.drawImage(boxImg, 0, 0, dispW, dispH);
        } else {
          rotCtx.translate(dispW / 2, dispH / 2);
          rotCtx.rotate(rotation * Math.PI / 180);
          if (isSideways) {
            rotCtx.drawImage(boxImg, -dispH / 2, -dispW / 2, dispH, dispW);
          } else {
            rotCtx.drawImage(boxImg, -dispW / 2, -dispH / 2, dispW, dispH);
          }
        }

        // 直接按 canvas 坐标从旋转后的临时 canvas 裁剪（无需坐标转换）
        const sx = Math.max(0, Math.round(box.x));
        const sy = Math.max(0, Math.round(box.y));
        const sw = Math.max(1, Math.min(dispW - sx, Math.round(box.w)));
        const sh = Math.max(1, Math.min(dispH - sy, Math.round(box.h)));

        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = sw;
        tmpCanvas.height = sh;
        const tmpCtx = tmpCanvas.getContext('2d');
        tmpCtx.drawImage(rotCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
        const croppedDataUrl = tmpCanvas.toDataURL('image/png');
        // 百度 OCR 需要 base64 不含前缀
        const base64Pure = croppedDataUrl.split(',')[1];

        let text;

        if (useDoubao) {
          // 豆包视觉模型识别
          text = await doubaoOCR(base64Pure, fieldInfo.label);
          showStatus('warning', `图${(box.imageIndex ?? 0) + 1}-框${i + 1} 豆包识别完成`);
        } else if (useGlm) {
          // 智谱 GLM 视觉模型识别
          text = await glmOCR(base64Pure, fieldInfo.label);
          showStatus('warning', `图${(box.imageIndex ?? 0) + 1}-框${i + 1} GLM 识别完成`);
        } else if (useOcrSpace) {
          // OCR.space 识别
          text = await ocrSpaceRecognize(base64Pure);
          showStatus('warning', `图${(box.imageIndex ?? 0) + 1}-框${i + 1} OCR.space 识别完成`);
        } else if (useBaidu) {
          // 百度 OCR 识别
          text = await baiduOCR(base64Pure, highPrecision);
          showStatus('warning', `图${(box.imageIndex ?? 0) + 1}-框${i + 1} 百度 OCR 识别完成`);
        } else {
          // Tesseract 本地识别
          const { data: { text: tessText } } = await Tesseract.recognize(
            croppedDataUrl,
            'chi_sim+eng',
            { logger: (m) => { if (m.status === 'recognizing text') {
              showStatus('warning', `图${(box.imageIndex ?? 0) + 1}-框${i + 1} 本地识别中... ${Math.round(m.progress * 100)}%`);
            }}
          });
          text = tessText;
        }

        const rawText = text.trim().replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ');

        // === 字段验证 + 自动修正 ===
        const validation = validateField(box.fieldKey, rawText);
        let cleanText = rawText;
        box.valid = validation.valid;
        box.validationMessage = validation.message;

        if (validation.corrected) {
          cleanText = validation.corrected;
          addLog(`图${(box.imageIndex ?? 0) + 1}-框${i + 1} OCR修正: "${rawText.substring(0, 20)}" → "${cleanText.substring(0, 20)}"`, 'info');
        }

        if (validation.valid) {
          if (validation.message) {
            addLog(`图${(box.imageIndex ?? 0) + 1}-框${i + 1} ✅ ${validation.message}`, 'ok');
          }
        } else {
          addLog(`图${(box.imageIndex ?? 0) + 1}-框${i + 1} ❌ 验证失败: ${validation.message}（值: "${cleanText.substring(0, 30)}"）`, 'warn');
        }

        box.result = cleanText;
        log(`图${(box.imageIndex ?? 0) + 1}-框${i + 1} 识别结果:`, cleanText, validation.valid ? '✅' : '❌');
        addLog(`图${(box.imageIndex ?? 0) + 1}-框${i + 1} 结果: "${cleanText.substring(0, 30)}${cleanText.length > 30 ? '...' : ''}"`, validation.valid ? 'ok' : 'warn');

        // 仅识别模式：只存储结果，不填入表单
        if (!doFill) {
          successCount++;
          renderBoxList();
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }

        // 虚拟字段：存储值，不直接填入表单
        if (VIRTUAL_FIELDS.includes(box.fieldKey)) {
          virtualValues[box.fieldKey] = cleanText;
          addLog(`→ 已存储（将用于自动组合备注）`, 'ok');
          successCount++;
          renderBoxList();
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }

        // 直接填入表单
        const filled = await fillTargetField(box.fieldKey, cleanText);
        if (filled) {
          addLog(`→ 已填入"${fieldInfo.label}"`, 'ok');
          successCount++;
          if (box.fieldKey === 'remark') remarkDirectlyFilled = true;
        } else {
          addLog(`→ 未找到"${fieldInfo.label}"对应的输入框`, 'fail');
        }

        // 等待页面滚动和框架响应
        await new Promise((r) => setTimeout(r, 500));

        renderBoxList();

      } catch (err) {
        log('框识别出错:', err);
        box.valid = false;
        box.validationMessage = '识别失败: ' + err.message;
        addLog(`图${(box.imageIndex ?? 0) + 1}-框${i + 1} 识别失败: ${err.message}`, 'fail');
      }
    }

    if (doFill) {
      // === 填入模式：自动组合备注 + 填入 ===

      // 所有框识别完成后，自动组合备注
      const virtualCount = Object.keys(virtualValues).length;
      if (virtualCount > 0 && !remarkDirectlyFilled) {
        addLog('正在自动组合备注...');

        // 检查哪些虚拟字段缺失
        const missingFields = VIRTUAL_FIELDS.filter((k) => !virtualValues[k]);
        if (missingFields.length > 0) {
          const missingLabels = missingFields.map((k) => TARGET_FIELDS.find((f) => f.key === k)?.label || k);
          addLog(`⚠️ 以下虚拟字段未识别到，备注中对应位置将为空：${missingLabels.join('、')}`, 'warn');
        }

        let remarkText = REMARK_TEMPLATE;
        for (const key of VIRTUAL_FIELDS) {
          const val = virtualValues[key] || '';
          remarkText = remarkText.replace(`{${key}}`, val);
        }
        log('组合备注:', remarkText);
        addLog(`备注内容: "${remarkText.substring(0, 50)}${remarkText.length > 50 ? '...' : ''}"`, 'ok');

        const remarkFilled = await fillTargetField('remark', remarkText);
        if (remarkFilled) {
          addLog(`→ 已填入"备注"`, 'ok');
          successCount++;
        } else {
          addLog(`→ 未找到"备注"输入框`, 'fail');
        }
      }

      // === 跨字段校验 ===
      const crossWarnings = crossFieldValidate(virtualValues, {});
      for (const w of crossWarnings) {
        addLog(`⚠️ ${w}`, 'warn');
      }

      btn.disabled = false;
      btn.textContent = '🔍 识别并填入';
      showStatus('success', `完成！识别 ${boxes.length} 个区域，成功填入 ${successCount} 个字段。`);
    } else {
      // === 仅识别模式：不填入，显示填入按钮 ===

      // 从 boxes 重建虚拟字段值，用于跨字段校验
      const virtualVals = {};
      for (const box of boxes) {
        if (VIRTUAL_FIELDS.includes(box.fieldKey) && box.result) {
          virtualVals[box.fieldKey] = box.result;
        }
      }
      const crossWarnings = crossFieldValidate(virtualVals, {});
      for (const w of crossWarnings) {
        addLog(`⚠️ ${w}`, 'warn');
      }

      btn.disabled = false;
      btn.textContent = '🔍 仅识别';
      // 显示填入按钮
      const fillBtn = document.getElementById('bp-fill-btn');
      if (fillBtn) {
        fillBtn.style.display = '';
        fillBtn.disabled = false;
      }
      const validCount = boxes.filter((b) => b.valid === true).length;
      const failedCount = boxes.filter((b) => b.valid === false || !b.result).length;
      if (failedCount > 0) {
        showStatus('error', `识别完成！共 ${boxes.length} 个区域，✅${validCount} 个通过，❌${failedCount} 个失败/未通过验证。请检查后重试或手动修正。`);
      } else {
        showStatus('success', `识别完成！共 ${boxes.length} 个区域，全部通过验证。请检查后点击"填入已识别结果"。`);
      }
    }
  }

  /**
   * 从已识别结果填入表单（仅识别模式的第二步）
   * 读取 box.result，填入表单 + 组合备注
   */
  async function fillRecognizedValues() {
    const boxesWithResult = boxes.filter((b) => b.result);
    if (boxesWithResult.length === 0) {
      showStatus('error', '没有已识别的结果，请先点击"仅识别"');
      return;
    }

    const btn = document.getElementById('bp-fill-btn');
    btn.disabled = true;
    btn.textContent = '填入中...';
    const logEl = document.getElementById('bp-fill-log');
    const addLog = (text, type) => {
      const div = document.createElement('div');
      div.className = type || '';
      div.textContent = (type === 'ok' ? '✅ ' : type === 'fail' ? '❌ ' : '• ') + text;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    };

    addLog('开始填入已识别结果...', 'info');

    // 自动选中"不含税"选项
    const noTaxSelected = autoSelectNoTax();
    if (noTaxSelected) {
      addLog('已自动选中"不含税"选项', 'ok');
    }

    // 自动勾选"是否开票给自然人"
    const naturalPersonChecked = autoCheckNaturalPerson();
    if (naturalPersonChecked) {
      addLog('已自动勾选"是否开票给自然人"', 'ok');
    }

    let successCount = 0;
    const virtualValues = {};
    let remarkDirectlyFilled = false;

    // 先收集虚拟字段值
    for (const box of boxesWithResult) {
      if (VIRTUAL_FIELDS.includes(box.fieldKey)) {
        virtualValues[box.fieldKey] = box.result;
      }
    }

    // 填入非虚拟字段
    for (const box of boxesWithResult) {
      const fieldInfo = TARGET_FIELDS.find((f) => f.key === box.fieldKey);
      if (!fieldInfo) continue;

      // 跳过虚拟字段（已收集）
      if (VIRTUAL_FIELDS.includes(box.fieldKey)) {
        addLog(`${fieldInfo.label}: "${box.result.substring(0, 30)}${box.result.length > 30 ? '...' : ''}" → 已存储（用于备注）`, 'ok');
        successCount++;
        continue;
      }

      // 填入表单
      const filled = await fillTargetField(box.fieldKey, box.result);
      if (filled) {
        addLog(`已填入"${fieldInfo.label}": "${box.result.substring(0, 30)}${box.result.length > 30 ? '...' : ''}"`, 'ok');
        successCount++;
        if (box.fieldKey === 'remark') remarkDirectlyFilled = true;
      } else {
        addLog(`未找到"${fieldInfo.label}"对应的输入框`, 'fail');
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    // 自动组合备注
    const virtualCount = Object.keys(virtualValues).length;
    if (virtualCount > 0 && !remarkDirectlyFilled) {
      addLog('正在自动组合备注...');

      const missingFields = VIRTUAL_FIELDS.filter((k) => !virtualValues[k]);
      if (missingFields.length > 0) {
        const missingLabels = missingFields.map((k) => TARGET_FIELDS.find((f) => f.key === k)?.label || k);
        addLog(`⚠️ 以下虚拟字段未识别到，备注中对应位置将为空：${missingLabels.join('、')}`, 'warn');
      }

      let remarkText = REMARK_TEMPLATE;
      for (const key of VIRTUAL_FIELDS) {
        const val = virtualValues[key] || '';
        remarkText = remarkText.replace(`{${key}}`, val);
      }
      log('组合备注:', remarkText);
      addLog(`备注内容: "${remarkText.substring(0, 50)}${remarkText.length > 50 ? '...' : ''}"`, 'ok');

      const remarkFilled = await fillTargetField('remark', remarkText);
      if (remarkFilled) {
        addLog(`→ 已填入"备注"`, 'ok');
        successCount++;
      } else {
        addLog(`→ 未找到"备注"输入框`, 'fail');
      }
    }

    // 跨字段校验
    const crossWarnings = crossFieldValidate(virtualValues, {});
    for (const w of crossWarnings) {
      addLog(`⚠️ ${w}`, 'warn');
    }

    btn.disabled = false;
    btn.textContent = '✅ 填入已识别结果';
    showStatus('success', `填入完成！共 ${boxesWithResult.length} 个区域，成功填入 ${successCount} 个字段。`);
  }

  // ============================================================
  //  填入目标网站表单
  // ============================================================

  const FIELD_LABELS = {
    name: ['名称', '购买方名称', '购方名称', '买方名称', '单位名称'],
    taxid: ['统一社会信用代码/纳税人识别号', '统一社会信用代码', '纳税人识别号', '税号', '识别号'],
    spec: ['规格型号', '规格', '型号'],
    price: ['单价（不含税）', '单价(不含税)', '单价', '不含税单价'],
    order_no: ['订单号', '订单编号', '订单'],
    personal_pay: ['个人支付金额', '个人支付', '个人付款'],
    subsidy: ['政府补贴金额', '政府补贴', '补贴金额'],
    product_code: ['商品编码', '商品编号', '商品条码'],
    remark: ['备注', '说明'],
  };

  // 表格类字段（需要按列头查找对应列的输入框）
  const TABLE_FIELDS = ['spec', 'price'];

  /**
   * 在表格中按列头文字查找对应列的数据行输入框
   * 支持 <table> 和 div 网格两种布局
   * 关键：必须按列索引定位，不能只找第一个 input
   */
  function findTableInputByHeader(headerTexts) {
    // ===== 策略1：标准 <table> 布局 =====
    const ths = document.querySelectorAll('th, [role="columnheader"]');
    for (const th of ths) {
      const thText = (th.textContent || '').trim().replace(/[*\s：:]/g, '');
      for (const ht of headerTexts) {
        const target = ht.replace(/[*\s：:]/g, '');
        if (thText === target || thText.includes(target)) {
          const headerRow = th.closest('tr');
          if (!headerRow) continue;
          const cells = Array.from(headerRow.children);
          const colIndex = cells.indexOf(th);
          if (colIndex < 0) continue;

          // 找数据行
          let dataRow = headerRow.nextElementSibling;
          let rowCount = 0;
          while (dataRow && rowCount < 5) {
            const dataCell = dataRow.children[colIndex];
            if (dataCell) {
              const input = dataCell.querySelector('input, textarea, [contenteditable], .t-input__inner, .el-input__inner, .ant-input');
              if (input && isFillable(input)) return input;
            }
            dataRow = dataRow.nextElementSibling;
            rowCount++;
          }
        }
      }
    }

    // ===== 策略2：div 网格布局 —— 通过列头行容器定位列索引 =====
    // 先找到"列头行"：一个容器，其直接子元素包含多个已知列头文字
    const knownHeaders = ['序号', '项目名称', '规格型号', '单位', '数量', '单价', '金额', '税率', '税额'];
    const allContainers = document.querySelectorAll('div, tr, ul, thead');
    let headerRowEl = null;
    let headerChildren = [];
    let targetColIndex = -1;

    for (const container of allContainers) {
      const children = Array.from(container.children);
      if (children.length < 3) continue; // 列头行至少有3列

      // 检查这个容器的子元素是否包含多个已知列头
      let matchCount = 0;
      let foundColIndex = -1;
      for (let i = 0; i < children.length; i++) {
        const childText = (children[i].textContent || '').trim().replace(/[*\s：:]/g, '');
        if (childText.length > 30) continue; // 列头文字不应该太长

        for (const kh of knownHeaders) {
          if (childText === kh || childText.includes(kh)) {
            matchCount++;
            // 检查是否是目标列
            for (const ht of headerTexts) {
              const target = ht.replace(/[*\s：:]/g, '');
              if (childText === target || childText.includes(target)) {
                foundColIndex = i;
              }
            }
            break;
          }
        }
      }

      if (matchCount >= 3 && foundColIndex >= 0) {
        headerRowEl = container;
        headerChildren = children;
        targetColIndex = foundColIndex;
        break;
      }
    }

    if (headerRowEl && targetColIndex >= 0) {
      log(`找到列头行，目标列索引: ${targetColIndex}`);

      // 获取目标列头的位置范围（用于位置匹配，避免 el-select 内部多 input 导致索引偏移）
      const targetHeaderEl = headerChildren[targetColIndex];
      const headerRect = targetHeaderEl ? targetHeaderEl.getBoundingClientRect() : null;
      if (headerRect) {
        log(`  目标列头位置: left=${headerRect.left.toFixed(0)}, right=${headerRect.right.toFixed(0)}, bottom=${headerRect.bottom.toFixed(0)}`);
      }

      // 找数据行：列头行的下一个兄弟元素
      let dataRow = headerRowEl.nextElementSibling;
      let rowCount = 0;
      while (dataRow && rowCount < 5) {
        const dataChildren = Array.from(dataRow.children);
        // 按列索引找对应的单元格
        if (targetColIndex < dataChildren.length) {
          const dataCell = dataChildren[targetColIndex];
          if (dataCell) {
            const input = dataCell.querySelector('input, textarea, [contenteditable], .t-input__inner, .el-input__inner, .ant-input');
            if (input && isFillable(input)) {
              log(`在数据行第${targetColIndex}列找到输入框`);
              return input;
            }
          }
        }

        // 列数不匹配时，用位置坐标匹配找输入框（优先方案）
        if (headerRect) {
          const allInputs = dataRow.querySelectorAll('input, textarea, .t-input__inner, .el-input__inner, .ant-input');
          for (const inp of allInputs) {
            if (!isFillable(inp)) continue;
            const inpRect = inp.getBoundingClientRect();
            const inpCenterX = inpRect.left + inpRect.width / 2;
            // input 的 x 中心坐标在列头的 x 范围内，且在列头下方
            if (inpCenterX >= headerRect.left - 5 && inpCenterX <= headerRect.right + 5 && inpRect.top > headerRect.bottom - 15) {
              log(`通过位置匹配找到输入框 (x=${inpCenterX.toFixed(0)} 在列头范围 ${headerRect.left.toFixed(0)}-${headerRect.right.toFixed(0)} 内)`);
              return inp;
            }
          }
        }

        // 位置匹配失败时，回退到 input 索引
        const allInputs = dataRow.querySelectorAll('input, textarea, .t-input__inner, .el-input__inner, .ant-input');
        if (allInputs.length > targetColIndex) {
          const input = allInputs[targetColIndex];
          if (input && isFillable(input)) {
            log(`通过 input 索引 ${targetColIndex} 找到输入框（回退方案）`);
            return input;
          }
        }

        dataRow = dataRow.nextElementSibling;
        rowCount++;
      }

      // 策略2b：数据行和列头行不是兄弟关系时，用位置匹配在更大范围搜索
      if (headerRect) {
        let tableContainer = headerRowEl.parentElement;
        for (let i = 0; i < 3 && tableContainer; i++) {
          tableContainer = tableContainer.parentElement;
          if (!tableContainer) break;
          const allInputs = tableContainer.querySelectorAll('input[placeholder*="请输入"], input[type="text"], .el-input__inner');
          // 优先用位置匹配
          for (const inp of allInputs) {
            if (!isFillable(inp)) continue;
            let parent = inp;
            let inHeader = false;
            for (let j = 0; j < 5 && parent; j++) {
              if (parent === headerRowEl) { inHeader = true; break; }
              parent = parent.parentElement;
            }
            if (inHeader) continue;
            const inpRect = inp.getBoundingClientRect();
            const inpCenterX = inpRect.left + inpRect.width / 2;
            if (inpCenterX >= headerRect.left - 5 && inpCenterX <= headerRect.right + 5 && inpRect.top > headerRect.bottom - 15) {
              log(`通过容器内位置匹配找到输入框 (x=${inpCenterX.toFixed(0)})`);
              return inp;
            }
          }
          // 位置匹配失败，回退到索引
          const dataInputs = Array.from(allInputs).filter((inp) => {
            if (!isFillable(inp)) return false;
            let parent = inp;
            for (let j = 0; j < 5 && parent; j++) {
              if (parent === headerRowEl) return false;
              parent = parent.parentElement;
            }
            return true;
          });
          if (dataInputs.length > targetColIndex) {
            log(`通过容器内 input 索引 ${targetColIndex} 找到输入框（回退方案）`);
            return dataInputs[targetColIndex];
          }
        }
      }

      // 策略2c：全页面位置匹配——在整个页面找 x 坐标在列头范围内的 input
      if (headerRect) {
        log('策略2c: 全页面位置匹配...');
        const allPageInputs = document.querySelectorAll('input[type="text"], input:not([type]), textarea, .t-input__inner, .el-input__inner, .ant-input');
        let candidates = [];
        for (const inp of allPageInputs) {
          if (!isFillable(inp)) continue;
          let parent = inp;
          let inHeader = false;
          for (let j = 0; j < 10 && parent; j++) {
            if (parent === headerRowEl) { inHeader = true; break; }
            parent = parent.parentElement;
          }
          if (inHeader) continue;
          const inpRect = inp.getBoundingClientRect();
          const inpCenterX = inpRect.left + inpRect.width / 2;
          if (inpCenterX >= headerRect.left - 10 && inpCenterX <= headerRect.right + 10 && inpRect.top > headerRect.bottom - 20) {
            candidates.push({ inp, dist: Math.abs(inpCenterX - (headerRect.left + headerRect.right) / 2) });
          }
        }
        if (candidates.length > 0) {
          candidates.sort((a, b) => a.dist - b.dist);
          const best = candidates[0];
          const bestRect = best.inp.getBoundingClientRect();
          log(`策略2c: 全页面位置匹配找到输入框 (x=${(bestRect.left + bestRect.width / 2).toFixed(0)}, placeholder="${best.inp.placeholder}")`);
          return best.inp;
        }
        log(`策略2c: 未找到位置匹配的 input (搜索了 ${allPageInputs.length} 个 input)`);
      }
    }

    return null;
  }

  /**
   * 检查元素是否可填写（不限可见性，因为可能需要滚动才能看到）
   */
  function isFillable(el) {
    if (!el) return false;
    if (el.disabled) return false;
    // 不跳过 readonly —— TDesign 表格输入框可能显示为 readonly，但仍可通过事件写入
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  }

  /**
   * 在多个输入框中，找到距离标签元素最近的那个（按位置坐标匹配）
   */
  function findClosestInputByPosition(labelEl, inputs) {
    const labelRect = labelEl.getBoundingClientRect();
    let best = null;
    let minScore = Infinity;

    for (const inp of inputs) {
      if (!isFillable(inp)) continue;
      const inpRect = inp.getBoundingClientRect();
      // 垂直距离（权重最高——标签和输入框应在同一行）
      const vDist = Math.abs(inpRect.top + inpRect.height / 2 - labelRect.top - labelRect.height / 2);
      // 水平距离（输入框应在标签右侧或下方）
      const hDist = Math.abs(inpRect.left - labelRect.right);
      // 综合评分：垂直距离权重 3，水平距离权重 1
      const score = vDist * 3 + hDist * 0.5;
      // 已有值的输入框增加惩罚分（避免覆盖已填字段）
      const hasValue = inp.value && inp.value.trim().length > 0;
      const finalScore = score + (hasValue ? 500 : 0);

      if (finalScore < minScore) {
        minScore = finalScore;
        best = inp;
      }
    }
    return best;
  }

  function findInputByLabel(labelTexts) {
    // 按长度排序（最长的最具体，优先匹配）
    const sortedTexts = [...labelTexts].sort((a, b) => b.length - a.length);

    // 策略1：通过 label/span/div 文本找邻近的输入框
    const allElements = document.querySelectorAll('label, span, div, td, th');
    for (const labelEl of allElements) {
      const elText = (labelEl.textContent || '').trim().replace(/[*\s：:]/g, '');
      for (const lt of sortedTexts) {
        const target = lt.replace(/[*\s：:]/g, '');
        if (elText === target || (elText.length < 20 && elText.includes(target))) {
          // 找到匹配的标签，先在同一行（父元素）中找输入框
          let container = labelEl;
          for (let i = 0; i < 5 && container; i++) {
            container = container.parentElement;
            if (!container) break;
            const inputs = container.querySelectorAll(
              'input[type="text"], input:not([type]), textarea, [contenteditable="true"], .t-input__inner, .el-input__inner, .ant-input'
            );
            const fillableInputs = Array.from(inputs).filter(isFillable);
            if (fillableInputs.length === 1) {
              return fillableInputs[0];
            }
            if (fillableInputs.length > 1) {
              // 多个输入框：用位置匹配找最近的
              const closest = findClosestInputByPosition(labelEl, fillableInputs);
              if (closest) return closest;
            }
          }
        }
      }
    }
    // 策略2：placeholder 查找
    for (const lt of labelTexts) {
      const inputs = document.querySelectorAll('input, textarea, [contenteditable]');
      for (const input of inputs) {
        const ph = input.getAttribute('placeholder') || '';
        if (ph.includes(lt) && isFillable(input)) return input;
      }
    }
    return null;
  }

  /**
   * 通过 Vue 3 组件实例直接设置值（绕过 DOM 事件）
   * TDesign Vue Next 的组件实例上挂载了 __vueParentComponent
   */
  async function setViaVueComponent(input, value) {
    let el = input;
    for (let depth = 0; depth < 15 && el; depth++) {
      const comp = el.__vueParentComponent;
      if (comp) {
        // 策略A: 通过 emit 触发 update:modelValue
        if (typeof comp.emit === 'function') {
          try {
            comp.emit('update:modelValue', value);
            comp.emit('update:value', value);
            await sleep(60);
            if (input.value === value) return true;
          } catch (e) { /* 忽略 */ }
        }
        // 策略B: 直接修改 props（Vue 3 props 是响应式的）
        if (comp.props) {
          for (const key of ['modelValue', 'value', 'model-value']) {
            if (key in comp.props) {
              try {
                comp.props[key] = value;
                await sleep(60);
                if (input.value === value) return true;
              } catch (e) { /* 忽略 */ }
            }
          }
        }
        // 策略C: 访问 setupState 中的内部值
        if (comp.setupState) {
          const keys = Object.keys(comp.setupState);
          for (const key of keys) {
            const lk = key.toLowerCase();
            if (lk.includes('value') || lk.includes('model') || lk === 'innerValue' || lk === 'displayvalue') {
              try {
                comp.setupState[key] = value;
                await sleep(60);
                if (input.value === value) return true;
              } catch (e) { /* 忽略 */ }
            }
          }
        }
      }
      el = el.parentElement;
    }
    return false;
  }

  async function setFieldValue(input, value) {
    if (!input || !value) return false;

    const wasReadOnly = input.readOnly;
    log(`[写入] 开始: tag=${input.tagName}, type="${input.type}", readonly=${wasReadOnly}, disabled=${input.disabled}, class="${(input.className||'').substring(0,50)}", value="${value}"`);

    // 如果是 readonly，临时移除以允许写入
    if (wasReadOnly) {
      log('[写入] input 是 readonly，临时移除...');
      try { input.readOnly = false; } catch (e) { /* 忽略 */ }
    }

    // 滚动到可视区域
    try {
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) { /* 忽略 */ }
    await sleep(250);

    // 最多重试 3 次
    for (let attempt = 1; attempt <= 3; attempt++) {
      log(`[写入] === 第${attempt}次尝试 ===`);

      // ---- 策略1: execCommand 模拟真实键盘输入 ----
      try {
        input.focus();
        await sleep(80);
        if (input.select) { try { input.select(); } catch (e) {} }
        await sleep(30);

        // 先清空
        try {
          document.execCommand('selectAll', false);
          document.execCommand('delete', false);
        } catch (e) { /* 忽略 */ }

        // 插入文本
        let execOk = false;
        try {
          execOk = document.execCommand('insertText', false, value);
        } catch (e) {
          log(`[写入] execCommand异常: ${e.message}`);
        }

        await sleep(50);

        if (input.value === value) {
          log(`[写入] ✅ execCommand 成功 (第${attempt}次)`);
          // 只派发 input 和 change，不派发 blur（blur 可能导致 TDesign 重置值）
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(100);
          if (input.value === value) {
            log(`[写入] ✅ 验证通过，值保持不变`);
            return true;
          }
          log(`[写入] ⚠️ input事件后值被重置: "${input.value}"`);
        } else if (execOk) {
          log(`[写入] ⚠️ execCommand返回true但值不匹配: "${input.value}"`);
        }
      } catch (e) {
        log(`[写入] 策略1异常: ${e.message}`);
      }

      // ---- 策略2: 原生 setter + InputEvent（不触发 blur）----
      try {
        const proto = input.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

        if (setter) {
          setter.call(input, value);
        } else {
          input.value = value;
        }

        // 派发 InputEvent，明确设置 isComposing: false（TDesign 会检查此属性）
        input.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          data: value,
          inputType: 'insertText',
          isComposing: false
        }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        await sleep(100);

        if (input.value === value) {
          log(`[写入] ✅ 原生setter成功 (第${attempt}次)`);
          return true;
        }
        log(`[写入] ⚠️ 原生setter后值不匹配: 期望="${value}" 实际="${input.value}"`);
      } catch (e) {
        log(`[写入] 策略2异常: ${e.message}`);
      }

      // ---- 策略3: Vue 3 组件实例直接设置 ----
      try {
        const vueOk = await setViaVueComponent(input, value);
        if (vueOk) {
          log(`[写入] ✅ Vue组件设置成功 (第${attempt}次)`);
          return true;
        }
      } catch (e) {
        log(`[写入] 策略3异常: ${e.message}`);
      }

      // ---- 策略4: 先清空再设置（解决 TDesign 覆盖问题）----
      try {
        const proto = input.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

        // 先清空并触发事件，让 TDesign 内部状态归零
        if (setter) setter.call(input, ''); else input.value = '';
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'deleteContentBackward', isComposing: false }));
        await sleep(80);

        // 再设置新值
        if (setter) setter.call(input, value); else input.value = value;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText', isComposing: false }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(100);

        if (input.value === value) {
          log(`[写入] ✅ 清空+设置成功 (第${attempt}次)`);
          return true;
        }
        log(`[写入] ⚠️ 策略4后值不匹配: "${input.value}"`);
      } catch (e) {
        log(`[写入] 策略4异常: ${e.message}`);
      }

      if (attempt < 3) {
        log(`[写入] 等待300ms后重试...`);
        await sleep(300);
      }
    }

    // 恢复 readonly
    if (wasReadOnly) {
      try { input.readOnly = true; } catch (e) { /* 忽略 */ }
    }

    log(`[写入] ❌ 所有策略均失败，最终值: "${input.value}"`);
    return false;
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  /**
   * 自动选中"不含税"选项
   * 在开票信息区域找到"不含税"单选按钮并点击选中
   */
  function autoSelectNoTax() {
    log('尝试自动选中"不含税"选项...');

    // 策略1：查找包含"不含税"文字的可点击元素
    const allElements = document.querySelectorAll('label, span, div, input[type="radio"], .el-radio, .ant-radio-wrapper, .t-radio, .t-radio-button, [role="radio"]');
    for (const el of allElements) {
      const text = (el.textContent || '').trim();
      if (text === '不含税' || text.includes('不含税')) {
        // 检查是否已选中
        const radio = el.querySelector('input[type="radio"]') || el;
        if (radio.checked) {
          log('"不含税"已选中，无需操作');
          return true;
        }
        // 点击选中
        log('点击"不含税"选项');
        el.click();
        // 也尝试点击内部的 input
        const innerInput = el.querySelector('input[type="radio"]');
        if (innerInput) innerInput.click();
        return true;
      }
    }

    // 策略2：直接查找 type=radio 的元素，检查关联文字
    const radios = document.querySelectorAll('input[type="radio"]');
    for (const radio of radios) {
      // 检查 radio 的关联 label
      const parent = radio.closest('label, .el-radio, .ant-radio-wrapper, .t-radio, .t-radio-button');
      if (parent && parent.textContent.includes('不含税')) {
        if (!radio.checked) {
          radio.click();
          log('通过 radio 点击选中"不含税"');
        }
        return true;
      }
    }

    log('⚠️ 未找到"不含税"选项');
    return false;
  }

  /**
   * 自动勾选"是否开票给自然人"复选框
   * 在购买方信息区域找到该复选框并勾选
   */
  function autoCheckNaturalPerson() {
    log('尝试自动勾选"是否开票给自然人"...');

    // 策略1：查找包含"开票给自然人"文字的 label/checkbox 容器
    const allElements = document.querySelectorAll('label, span, div, .el-checkbox, .ant-checkbox-wrapper, .t-checkbox, .t-checkbox-group, [role="checkbox"]');
    for (const el of allElements) {
      const text = (el.textContent || '').trim();
      if (text.includes('开票给自然人') || text.includes('自然人')) {
        // 检查是否已勾选
        const checkbox = el.querySelector('input[type="checkbox"]') || el.querySelector('.el-checkbox__inner') || el.querySelector('.ant-checkbox-input') || el.querySelector('.t-checkbox__original') || el;
        const isChecked = el.classList.contains('is-checked') || el.classList.contains('ant-checkbox-checked') || el.querySelector('.is-checked, .ant-checkbox-checked, .t-checkbox--checked') || (checkbox.type === 'checkbox' && checkbox.checked);
        if (isChecked) {
          log('"是否开票给自然人"已勾选，无需操作');
          return true;
        }
        // 点击勾选
        log('点击"是否开票给自然人"复选框');
        el.click();
        // 也尝试点击内部的 input
        const innerInput = el.querySelector('input[type="checkbox"]');
        if (innerInput && !innerInput.checked) innerInput.click();
        return true;
      }
    }

    // 策略2：直接查找所有 checkbox，检查关联文字
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    for (const cb of checkboxes) {
      const parent = cb.closest('label, .el-checkbox, .ant-checkbox-wrapper, .t-checkbox, .t-checkbox-group');
      if (parent && parent.textContent.includes('自然人')) {
        if (!cb.checked) {
          cb.click();
          log('通过 checkbox 点击勾选"是否开票给自然人"');
        }
        return true;
      }
    }

    log('⚠️ 未找到"是否开票给自然人"复选框');
    return false;
  }

  /**
   * 调试函数：测试写入"规格型号"栏
   * 用途：在不进行OCR的情况下，直接测试表格输入框的定位和写入
   */
  async function debugWriteSpec() {
    const logEl = document.getElementById('bp-fill-log');
    logEl.innerHTML = '';
    const addLog = (text, type) => {
      const div = document.createElement('div');
      div.className = type || '';
      div.textContent = (type === 'ok' ? '✅ ' : type === 'fail' ? '❌ ' : '• ') + text;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    };

    const testValue = 'TEST-KFR-35GW';
    addLog(`开始调试写入"规格型号"，测试值: "${testValue}"`);
    showStatus('warning', '正在调试写入"规格型号"...');

    // 步骤1：查找所有页面上的 input 元素
    const allInputs = document.querySelectorAll('input, textarea, .t-input__inner');
    addLog(`页面上共有 ${allInputs.length} 个 input/textarea 元素`);

    // 步骤2：列出所有可见的 input 信息
    let visibleCount = 0;
    for (const inp of allInputs) {
      const rect = inp.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = window.getComputedStyle(inp);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      visibleCount++;
      const hasVue = !!inp.__vueParentComponent || !!inp.parentElement?.__vueParentComponent;
      log(`  input#${visibleCount}: tag=${inp.tagName}, type="${inp.type}", readonly=${inp.readOnly}, placeholder="${inp.placeholder}", class="${(inp.className||'').substring(0,40)}", pos=(${rect.left.toFixed(0)},${rect.top.toFixed(0)},${rect.width.toFixed(0)}x${rect.height.toFixed(0)}), vue=${hasVue}`);
    }
    addLog(`其中 ${visibleCount} 个可见`);

    // 步骤3：用 findTableInputByHeader 查找
    addLog('用 findTableInputByHeader 查找"规格型号"列...');
    const input = findTableInputByHeader(['规格型号', '规格', '型号']);

    if (input) {
      const rect = input.getBoundingClientRect();
      addLog(`找到输入框: tag=${input.tagName}, readonly=${input.readOnly}, placeholder="${input.placeholder}", class="${(input.className||'').substring(0,50)}"`, 'ok');
      addLog(`位置: left=${rect.left.toFixed(0)}, top=${rect.top.toFixed(0)}, ${rect.width.toFixed(0)}x${rect.height.toFixed(0)}`);

      // 步骤4：尝试写入
      addLog('开始写入测试值...');
      const result = await setFieldValue(input, testValue);
      if (result) {
        addLog(`写入成功！当前值: "${input.value}"`, 'ok');
        showStatus('success', `调试成功！值已写入: "${input.value}"`);
      } else {
        addLog(`写入失败！当前值: "${input.value}"`, 'fail');
        showStatus('error', `调试失败：值未写入。最终值="${input.value}"`);

        // 步骤5：如果写入失败，尝试点击单元格激活后再写入
        addLog('尝试点击单元格激活编辑模式后重试...');
        const activatedInput = await clickCellToActivateInput(['规格型号', '规格', '型号']);
        if (activatedInput && activatedInput !== input) {
          addLog(`点击后找到新的输入框`, 'ok');
          const result2 = await setFieldValue(activatedInput, testValue);
          if (result2) {
            addLog(`二次写入成功！`, 'ok');
            showStatus('success', `调试成功（二次尝试）！值已写入`);
          } else {
            addLog(`二次写入也失败`, 'fail');
          }
        } else {
          addLog('点击单元格未找到新输入框', 'fail');
        }
      }
    } else {
      addLog('findTableInputByHeader 未找到"规格型号"列的输入框', 'fail');

      // 尝试点击单元格激活
      addLog('尝试点击单元格激活编辑模式...');
      const activatedInput = await clickCellToActivateInput(['规格型号', '规格', '型号']);
      if (activatedInput) {
        addLog(`点击后找到输入框`, 'ok');
        const result = await setFieldValue(activatedInput, testValue);
        if (result) {
          addLog(`写入成功！`, 'ok');
          showStatus('success', `调试成功（激活后）！值已写入`);
        } else {
          addLog(`写入失败`, 'fail');
          showStatus('error', '调试失败：激活后仍未写入');
        }
      } else {
        addLog('点击单元格也未找到输入框', 'fail');
        showStatus('error', '调试失败：未找到"规格型号"输入框');
      }
    }

    // 输出到控制台的完整日志
    log('=== 调试结束，请查看上方日志 ===');
  }

  /**
   * 点击表格单元格以激活编辑模式
   * TDesign 表格的输入框可能需要点击单元格才会渲染出来
   */
  async function clickCellToActivateInput(headerTexts) {
    // 找到目标列头
    const knownHeaders = ['序号', '项目名称', '规格型号', '单位', '数量', '单价', '金额', '税率', '税额'];
    const allContainers = document.querySelectorAll('div, tr, thead');
    let headerRowEl = null;
    let targetColIndex = -1;
    let headerChildren = [];

    for (const container of allContainers) {
      const children = Array.from(container.children);
      if (children.length < 3) continue;

      let matchCount = 0;
      let foundColIndex = -1;
      for (let i = 0; i < children.length; i++) {
        const childText = (children[i].textContent || '').trim().replace(/[*\s：:]/g, '');
        if (childText.length > 30) continue;
        for (const kh of knownHeaders) {
          if (childText === kh || childText.includes(kh)) {
            matchCount++;
            for (const ht of headerTexts) {
              const target = ht.replace(/[*\s：:]/g, '');
              if (childText === target || childText.includes(target)) {
                foundColIndex = i;
              }
            }
            break;
          }
        }
      }
      if (matchCount >= 3 && foundColIndex >= 0) {
        headerRowEl = container;
        targetColIndex = foundColIndex;
        headerChildren = children;
        break;
      }
    }

    if (!headerRowEl || targetColIndex < 0) return false;

    // 找数据行
    let dataRow = headerRowEl.nextElementSibling;
    let rowCount = 0;
    while (dataRow && rowCount < 5) {
      const dataChildren = Array.from(dataRow.children);
      if (targetColIndex < dataChildren.length) {
        const cell = dataChildren[targetColIndex];
        if (cell) {
          // 点击单元格以激活编辑模式
          log(`[激活] 点击数据行第${targetColIndex}列单元格...`);
          cell.click();
          await sleep(300);

          // 点击后检查是否出现了新的 input
          const newInput = cell.querySelector('input, textarea, [contenteditable], .t-input__inner, .el-input__inner');
          if (newInput) {
            log(`[激活] ✅ 点击后出现输入框: tag=${newInput.tagName}, class="${(newInput.className||'').substring(0,40)}"`);
            return newInput;
          }

          // 也尝试点击单元格内部的元素
          const innerEls = cell.querySelectorAll('div, span, [role="textbox"], [role="gridcell"]');
          for (const inner of innerEls) {
            inner.click();
            await sleep(200);
            const inp = cell.querySelector('input, textarea, .t-input__inner');
            if (inp) {
              log(`[激活] ✅ 点击内部元素后出现输入框`);
              return inp;
            }
          }
        }
      }
      dataRow = dataRow.nextElementSibling;
      rowCount++;
    }
    return false;
  }

  async function fillTargetField(fieldKey, value) {
    const labelTexts = FIELD_LABELS[fieldKey];
    if (!labelTexts) return false;

    let input = null;

    // 表格类字段：先用列头查找
    if (TABLE_FIELDS.includes(fieldKey)) {
      log(`[诊断] 查找表格字段 "${fieldKey}"，列头关键词: ${labelTexts.join(', ')}`);
      input = findTableInputByHeader(labelTexts);
      if (input) {
        const rect = input.getBoundingClientRect();
        log(`[诊断] findTableInputByHeader 找到 input: tag=${input.tagName}, readonly=${input.readOnly}, placeholder="${input.placeholder}", class="${(input.className||'').substring(0, 60)}", value="${input.value}", 位置=(${rect.left.toFixed(0)},${rect.top.toFixed(0)},${rect.width.toFixed(0)}x${rect.height.toFixed(0)})`);
      } else {
        log(`[诊断] findTableInputByHeader 未找到 input，尝试点击单元格激活编辑模式...`);
        // 尝试点击单元格激活编辑模式
        input = await clickCellToActivateInput(labelTexts);
        if (input) {
          const rect = input.getBoundingClientRect();
          log(`[诊断] 点击激活后找到 input: tag=${input.tagName}, readonly=${input.readOnly}, placeholder="${input.placeholder}", class="${(input.className||'').substring(0, 60)}"`);
        }
      }

      // 回退：通过 placeholder 查找
      if (!input) {
        const fieldInfo = TARGET_FIELDS.find(f => f.key === fieldKey);
        if (fieldInfo && fieldInfo.placeholder) {
          log(`[诊断] 尝试通过 placeholder 查找: "${fieldInfo.placeholder}"`);
          const allInputs = document.querySelectorAll('input, textarea, .t-input__inner, .el-input__inner');
          for (const inp of allInputs) {
            const ph = inp.getAttribute('placeholder') || '';
            if (ph.includes(fieldInfo.placeholder.substring(2)) && isFillable(inp)) {
              input = inp;
              log(`[诊断] ✅ 通过 placeholder 找到 input`);
              break;
            }
          }
        }
      }
    } else {
      // 非表格字段：用 label 查找
      input = findInputByLabel(labelTexts);
      if (input) {
        const rect = input.getBoundingClientRect();
        log(`[诊断] findInputByLabel 找到 input: tag=${input.tagName}, readonly=${input.readOnly}, placeholder="${input.placeholder}", class="${(input.className||'').substring(0, 60)}", 当前值="${input.value}", 位置=(${rect.left.toFixed(0)},${rect.top.toFixed(0)})`);
      } else {
        log(`[诊断] findInputByLabel 未找到 input`);
      }
    }

    if (!input) return false;
    return await setFieldValue(input, value);
  }

  // ============================================================
  //  辅助
  // ============================================================
  function showStatus(type, message) {
    const area = document.getElementById('bp-status-area');
    if (!type && !message) { area.innerHTML = ''; return; }
    area.innerHTML = `<div class="bp-status bp-status-${type}">${message}</div>`;
  }

  function appendFillLog(type, text) {
    const logEl = document.getElementById('bp-fill-log');
    if (!logEl) return;
    const div = document.createElement('div');
    div.className = type || '';
    const prefix = type === 'ok' ? '✅ ' : type === 'fail' ? '❌ ' : type === 'warn' ? '⚠️ ' : '• ';
    div.textContent = prefix + text;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function makeDraggable() {
    const panel = document.getElementById('box-panel');
    const header = panel.querySelector('.bp-header');
    let isDragging = false, startX, startY, startLeft, startTop;

    header.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('bp-close')) return;
      isDragging = true;
      startX = e.clientX; startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      startLeft = rect.left; startTop = rect.top;
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
    document.addEventListener('mouseup', () => isDragging = false);
  }

  function makeResizable() {
    const panel = document.getElementById('box-panel');
    const handle = document.getElementById('bp-resize-handle');
    if (!handle) return;
    let isResizing = false, startX, startY, startW, startH;

    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX; startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      startW = rect.width; startH = rect.height;
      e.preventDefault();
      e.stopPropagation();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const newW = Math.max(320, startW + (e.clientX - startX));
      const newH = Math.max(300, Math.min(window.innerHeight - 20, startH + (e.clientY - startY)));
      panel.style.width = newW + 'px';
      panel.style.maxHeight = newH + 'px';
    });
    // 调整结束时重新计算 canvas 以适应新面板宽度
    document.addEventListener('mouseup', () => {
      if (isResizing && images.length > 0) {
        initCanvas();
        updateZoomLabel();
      }
      isResizing = false;
    });
  }

  // ============================================================
  //  备注模板编辑器
  // ============================================================
  function showTemplateEditor() {
    const existing = document.getElementById('bp-settings-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'bp-settings-overlay';
    overlay.innerHTML = `
      <div class="bp-settings-box" style="width:520px;max-height:85vh;overflow-y:auto;">
        <div class="bp-settings-title">✏️ 备注模板编辑</div>
        <div class="bp-settings-hint" style="margin-bottom:12px;">
          编辑备注自动组合模板。使用 <code style="background:#f0f0f0;padding:1px 4px;border-radius:2px;">{字段名}</code> 作为占位符，识别结果会自动替换。
          <br>"能效等级: 一级"是固定文字，保持不变即可。
        </div>

        <div class="bp-settings-label">模板内容</div>
        <textarea class="bp-template-textarea" id="bp-template-input">${REMARK_TEMPLATE}</textarea>

        <div class="bp-settings-label" style="margin-top:10px;">可用占位符（点击插入到光标位置）</div>
        <div class="bp-placeholder-chips">
          ${TEMPLATE_PLACEHOLDERS.map(p => `<span class="bp-placeholder-chip" data-key="${p.key}">{${p.key}}</span>`).join('')}
          <span class="bp-placeholder-chip" data-key="能效固定" style="background:#f6ffed;border-color:#b7eb8f;color:#52c41a;">能效等级: 一级</span>
        </div>

        <div class="bp-settings-label" style="margin-top:10px;">预览（使用示例值）</div>
        <div style="padding:8px 10px;background:#f6ffed;border:1px solid #b7eb8f;border-radius:4px;font-size:12px;color:#52c41a;line-height:1.6;" id="bp-template-preview"></div>

        <div class="bp-settings-actions">
          <button class="bp-btn bp-btn-secondary" id="bp-template-reset">恢复默认</button>
          <button class="bp-btn bp-btn-secondary" id="bp-template-cancel">取消</button>
          <button class="bp-btn bp-btn-primary" id="bp-template-save">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const textarea = document.getElementById('bp-template-input');
    const previewEl = document.getElementById('bp-template-preview');

    // 预览函数
    function updatePreview() {
      let text = textarea.value;
      const sampleValues = {
        order_no: '2026071717XXX',
        personal_pay: '2549.15',
        subsidy: '449.85',
        product_code: '6938187313313',
      };
      for (const [key, val] of Object.entries(sampleValues)) {
        text = text.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
      }
      previewEl.textContent = text;
    }
    updatePreview();
    textarea.addEventListener('input', updatePreview);

    // 占位符点击插入
    overlay.querySelectorAll('.bp-placeholder-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const key = chip.getAttribute('data-key');
        const insertText = key === '能效固定' ? '能效等级: 一级' : `{${key}}`;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const before = textarea.value.substring(0, start);
        const after = textarea.value.substring(end);
        textarea.value = before + insertText + after;
        textarea.selectionStart = textarea.selectionEnd = start + insertText.length;
        textarea.focus();
        updatePreview();
      });
    });

    // 恢复默认
    document.getElementById('bp-template-reset').addEventListener('click', () => {
      textarea.value = DEFAULT_REMARK_TEMPLATE;
      updatePreview();
    });

    // 取消
    document.getElementById('bp-template-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // 保存
    document.getElementById('bp-template-save').addEventListener('click', () => {
      const newTemplate = textarea.value.trim();
      if (!newTemplate) {
        alert('模板不能为空');
        return;
      }
      REMARK_TEMPLATE = newTemplate;
      GM_setValue('remark_template', newTemplate);
      updateTemplatePreview();
      overlay.remove();
      showStatus('success', '备注模板已保存！');
      log('备注模板已更新:', newTemplate);
    });
  }

  function updateTemplatePreview() {
    const el = document.getElementById('bp-remark-template-preview');
    if (el) {
      el.textContent = REMARK_TEMPLATE.length > 80 ? REMARK_TEMPLATE.substring(0, 80) + '...' : REMARK_TEMPLATE;
    }
  }

  // ============================================================
  //  启动
  // ============================================================
  setTimeout(() => {
    if (!document.getElementById('box-panel')) buildUI();
  }, 1500);

})();
