# RealityGlitch (现实入侵)

黑客松项目,提交截止 2026-10-25 08:30。独立项目,与 Pain2Plan 无关,不要改动它。
用中文回复。目标:实时摄像头 + 手势识别 + AI 生成关卡的 60 秒互动游戏。

## 目录
- `app/`  React + TypeScript + Vite 前端(主工程)。`app/start.bat` 一键启动,地址 http://localhost:5173
- `gesture-check/`  已验证通过的最小 MediaPipe 验证页,只作参考,可保留
- 摄像头:安卓手机 + Iriun Webcam,在 Windows 中注册为普通摄像头,`getUserMedia` 可直接选到

## 已完成并在用户机器上跑通
- 摄像头接入、设备选择、中文故障提示(`src/vision/useCamera.ts`)
- MediaPipe 手势识别,模型和 WASM 在 `app/public/models`、`app/public/wasm`,完全本地加载(`src/vision/useGestures.ts`)
- 手势稳定器:置信度 0.6、持续 350ms、冷却 800ms(`src/vision/stabilizer.ts`)
- 60 秒状态机(`src/game/engine.ts`),纯 reducer,所有胜负、伤害、倒计时由程序判定
- HUD、闪屏、WebAudio 合成音效、键盘备用(1/2/3 手势,空格开始,R 重来)
- 5 套预设关卡(`src/game/levels.ts`),界面标注"预设数据(离线)"
- 测试 21 个:`cd app && npm test`(引擎 + 稳定器 + jsdom 键盘整局)

## 设计原则(不要违反)
- LLM 只生成内容(Level 数据),不决定胜负,不执行任何模型返回的代码
- 不连模型、不连机器人时,游戏必须能完整玩一局
- 生成结果必须通过严格 Schema 校验,字段范围受限(见 `src/game/types.ts` 的 `Level`)
- 摄像头视频只在本地处理;只有用户主动点击扫描时才发送单帧图片
- API Key 只放后端环境变量,不进前端、不进仓库
- 不得伪造识别结果冒充真实运行;预设/手动/AI 三种来源要在界面上如实标注

## 待办(按优先级)
1. 第二阶段:后端 `server/`(Python FastAPI)
   - `POST /api/level`:接收单帧图片(或手动输入的物品名),调用模型,返回 Level JSON
   - 严格校验:duration 30-90,difficulty 1-3,weakness 只能是 Open_Palm/Closed_Fist/Victory,accent 只能取 `ACCENTS`,文案长度限制
   - 失败或超时回退到预设关卡,并在界面标注
   - 前端加"扫描物品"按钮,截取 video 当前帧,显示生成中状态
   - 需要用户提供:模型 API 地址、模型名、是否支持图片输入(不支持则做手动输入物品名模式)。Key 让用户自己写进 `server/.env`
2. 让物品真正影响玩法:在允许范围内调整弱点手势、倒计时、入侵波节奏(只组合现有机制)
3. 第三阶段(可选):`RobotAdapter` 接口 + 模拟适配器,把游戏事件(start/success/failure 等)映射为 TTS/灯光/授权的预设动作;真机只调用工作人员授权的接口
4. 交付物:根目录 README、启动脚本、演示说明、一页作品介绍

## 待用户实测后再调的参数
- 入侵波窗口(`engine.ts` 中 `WAVE_WINDOW`,目前 3.5/3.0/2.5 秒)是否太紧
- 稳定器阈值是否需要按现场光线调整

## 注意
- 本机 Windows + bash 环境,路径用绝对路径
- `npm install` 时依赖已锁定精确版本,不要改成范围版本
- 之前的开发在隔离沙箱里做,没有真实摄像头;手势联动以用户机器实测为准
