# 湖北税务开票辅助脚本

Tampermonkey 用户脚本，用于湖北税务电子发票平台的 OCR 识别与自动填表。

## 脚本

### box-select-ocr-fill-demo.user.js

凭证单据框选识别填表工具，功能包括：

- 上传单据图片 → 框选区域 → OCR 识别 → 自动填入开票页面
- 支持多图片、面板缩放、图片旋转/缩放、拖拽上传
- 多 OCR 引擎：豆包视觉模型、智谱 GLM-4.6V、百度 OCR、OCR.space、本地 Tesseract
- 字段验证 + OCR 字符自动修正（如 O→0、I→1）
- 两步工作流：仅识别 → 检查修正 → 填入表单
- 跨字段校验（个人支付 + 政府补贴 ≈ 单价）
- 备注模板自定义、方框调整大小、滚动填表

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击 [box-select-ocr-fill-demo.user.js](https://github.com/wuhoward805/hubei-tax-userscripts/raw/main/box-select-ocr-fill-demo.user.js) → Tampermonkey 自动弹出安装提示
3. 确认安装

## OCR 引擎配置

脚本支持多种 OCR 引擎，在面板点击「⚙️ 设置」按钮切换引擎并填入 API Key。

### 智谱 GLM-4.6V-Flash（永久免费，但容易出现平台服务过载，导致无法快速多次识别文字）

1. 打开 [智谱开放平台](https://open.bigmodel.cn/) 注册账号
2. 进入控制台 → 「API Keys」页面
3. 点击「添加 API Key」生成密钥
4. 复制 API Key 填入脚本设置面板

- 接口地址：`https://open.bigmodel.cn/api/paas/v4/chat/completions`
- 模型：`glm-4.6v-flash`
- 费用：**永久免费**
- 注意：容易出现平台服务过载，导致无法快速多次识别文字，稍后重试即可

### 豆包视觉模型（限定免费，额度用完按量收费，但价格不贵）

1. 打开 [火山引擎](https://www.volcengine.com/) 注册账号
2. 进入 [方舟控制台](https://console.volcengine.com/ark/) 
3. 「在线推理」→ 创建推理接入点，选择视觉模型（如 `doubao-seed-2-0-mini`）
4. 在接入点详情页获取 API Key
5. 复制 API Key 填入脚本设置面板

- 接口地址：`https://ark.cn-beijing.volces.com/api/v3/chat/completions`
- 费用：限定免费额度，额度用完按量收费，价格不贵
- 注意：如遇到「安全体验模式推理上限」提示，需在方舟控制台的 [开通管理页面](https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement) 关闭「安心体验模式」开关

### 百度 OCR（不是很好用，识别人手写的字准确率不高）

1. 打开 [百度智能云](https://cloud.baidu.com/) 注册账号
2. 进入 [文字识别 OCR 控制台](https://console.bce.baidu.com/ai/#/ai/ocr/overview/index)
3. 点击「创建应用」，填写应用名称
4. 创建后获取 **API Key** 和 **Secret Key**
5. 将两者填入脚本设置面板

- 接口地址：`https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic`
- 费用：每月有免费调用额度，超出后按次计费
- 支持高精度模式（accurate_basic），可在设置中开启
- 注意：识别人手写的字准确率不高

### OCR.space

1. 打开 [OCR.space](https://ocr.space/ocrapi) 注册账号
2. 注册后在页面中查看你的 API Key
3. 复制 API Key 填入脚本设置面板

- 费用：免费版每月 25000 次请求
- 支持中文识别

### Tesseract（本地引擎，无需配置）

- 无需 API Key，无需注册
- 基于 [tesseract.js](https://github.com/naptha/tesseract.js) 在浏览器本地运行
- 首次使用需下载语言模型（约 10-30 秒）
- 识别精度不如云端模型，建议作为备用方案

## License

MIT
