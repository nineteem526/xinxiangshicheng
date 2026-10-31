# RealityGlitch 2.0 开发原型

独立分支 `realityglitch-2`。当前为阶段 A/B 的早期原型，不代表真人动作、手机连接或现场性能已经验收。

## 启动

Windows 双击根目录 `start.bat`，或分别运行：

```powershell
cd server
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8011
```

```powershell
cd app
npm ci
npm run dev
```

电脑打开 https://localhost:5173 。原版保留在 https://localhost:5173/?classic 。手机与电脑处于同一局域网，点击“手机直连”，用手机扫码，按提示处理本地自签名证书并打开摄像头。画面接入后，把手机固定，保证肩膀、手腕和髋部可见；站直点击“重新校准”。需要本人在真实设备上校验识别与延迟。若无法连接，先用本机摄像头调试。

挥拳攻击；警告出现时侧身或下蹲；能量满时双手举过肩部保持约 0.65 秒释放终结技。备用调试：空格攻击，方向键闪避，F 终结技。开始按钮可由操作员使用。音效需要浏览器允许音频播放。

“扫描现实物品”仅在主动点击时发送单帧至已有后端和已配置的模型，服务端配置方式见 README。成功后当前只将识别内容匹配至两套本地场景之一，失败保留本地预设；并非生成全新 3D 模型。两个场景及 Boss 均为程序化占位，需进一步美术、玩法和性能验证。模型文件及 WASM 本地加载。

测试：`cd app; npm test; npm run build`；`cd server; python -m unittest discover -s tests`。现场手机配对、人体动作精度、完整游戏手感和扫描模型需真人验证。
