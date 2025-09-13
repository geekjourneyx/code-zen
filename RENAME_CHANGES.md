# 项目名称更改记录

## 从 opcode 更改为 code-zen

### 已修改的文件：

1. **src/App.tsx**
   - 欢迎页面标题：`Welcome to opcode` → `Welcome to code-zen`

2. **src/components/StartupIntro.tsx**
   - 品牌文字：`opcode` → `code-zen`
   - 图片 alt 属性：`opcode` → `code-zen`
   - 注释文字更新

3. **src/components/AnalyticsConsent.tsx**
   - 对话框标题：`Help Improve opcode` → `Help Improve code-zen`
   - 描述文字：`Help improve opcode` → `Help improve code-zen`

4. **src/components/Settings.tsx**
   - 分析设置描述：`Help improve opcode` → `Help improve code-zen`

5. **src/components/NFOCredits.tsx**
   - 版本信息：`opcode v0.2.1` → `code-zen v0.2.1`
   - NFO 文件名：`opcode.NFO` → `code-zen.NFO`

6. **src-tauri/tauri.conf.json**
   - 产品名称：`opcode` → `code-zen`
   - 窗口标题：`opcode` → `code-zen`

7. **package.json**
   - 项目名称：`opcode` → `code-zen`

8. **index.html**
   - 页面标题：`opcode - Claude Code Session Browser` → `code-zen - 编码禅师`

### 保持不变的引用：
- GitHub 链接和仓库引用（指向原始项目）
- 文件扩展名 `.opcode.json`（保持兼容性）
- 资源文件路径
- 注释中的存储键名

### 效果：
用户在启动应用后看到的所有界面文字都已更新为 "code-zen"，体现了项目的新身份：编码禅师。