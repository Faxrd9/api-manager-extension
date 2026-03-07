# API 配置管理器 (SillyTavern Extension)

在 SillyTavern 的 API 设置页注入一个轻量工具栏，提供 API 预设的搜索、切换、导入与导出能力。  
让常用配置管理更直观，也更省事。

---

## 👤 作者 (Author)

- **Faxrd9**
- 协作：ChatGPT / Gemini

---

## ✨ 核心功能 (Features)

- **配置搜索**：输入关键词快速筛选预设。
- **快速切换**：点击即可应用目标 API 配置。
- **保存/覆盖/删除**：支持管理多套 API 方案。
- **导入/导出 JSON**：支持备份与迁移。
- **可选密码加密导出**：导出时可设置访问密码（Web Crypto）。

---

## 📦 安装 (Installation)

### 方式一：扩展管理（推荐）

1. 打开 SillyTavern 扩展管理（Extensions）
2. 选择安装扩展（Install Extension）
3. 填入仓库地址：

```text
https://github.com/Faxrd9/api-manager-extension
```

4. 点击安装并刷新页面

### 方式二：Git 克隆

```bash
cd SillyTavern/public/scripts/extensions/third-party/
git clone https://github.com/Faxrd9/api-manager-extension.git
```

---

## 🚀 使用说明 (Usage)

1. 进入酒馆 API 设置页
2. 使用注入的工具栏或悬浮按钮打开管理面板
3. 可进行搜索、保存、切换、导入、导出等操作

---

## 📌 使用声明 (Usage Notice)

欢迎使用本项目。  
如果你希望用于**学习、二次修改、集成到其他项目**，请先联系我交流。  
使用或转载时请保留作者与项目来源信息。

> 要想使用请先联系我交流，欢迎使用。

---

## 📬 联系方式 (Contact)

- GitHub：`https://github.com/Faxrd9/api-manager-extension`
- 建议通过 **Issue** 联系

---

## 📄 License

本项目采用作者自定义使用声明。  
如需超出声明范围的使用方式（例如商用/打包分发），请先联系作者。

---

## ⚠️ 注意事项 (Notes)

- 插件仅在浏览器本地运行，不会主动上传你的 API Key。
- 导出的 JSON 可能包含敏感信息，请妥善保管。
