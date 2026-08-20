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

脚本支持多种 OCR 引擎，在面板设置中切换：

| 引擎 | 说明 |
|------|------|
| 智谱 GLM-4.6V | 永久免费，推荐 |
| 豆包视觉模型 | 识别最准确，推荐 |
| 百度 OCR | 需配置 API Key |
| OCR.space | 免费，每月 25000 次 |
| Tesseract | 本地引擎，首次加载较慢 |

## License

MIT
