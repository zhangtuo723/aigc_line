# AIGC CANVAS 3D 导演台设计

## 研究基线

本实现参考了两个 MIT 项目的产品思路与公开架构，但没有直接复制其组件源码：

- `jiguang132/storyai-3d-director-desk`：重点研究轻量 Web 3D 编辑器、对象树、导演/机位视角、TransformControls、姿势、画幅和截图回流宿主页面。
- `pengfeiqiao/kunpeng-director`：重点研究稳定 ID、纯 JSON 工程、24fps 时间语义、Shot 站位快照、相机关键帧、人工锁定和 Agent 可读写数据模型。

AIGC CANVAS 采用 React 19、Three.js、React Three Fiber 与 Drei 重新实现，并与现有 React Flow、项目存储、workspace 协议和 Canvas MCP 能力融合。

## 产品定位

导演台是生成模型之前的 3D Blocking 与 Camera Layout 工具，不负责最终渲染。它把难以用提示词准确表达的空间关系转成明确构图：

1. 在同一场景坐标系布置演员、群众和道具。
2. 保存每个 Shot 的站位、姿势、显隐和摄影机参数。
3. 从机位视角输出干净的二维构图参考图。
4. 自动形成 `director → image → video` 的生成链路。

## 融合后的能力

- 纯 JSON `DirectorProject`，随 canvas snapshot 持久化。
- 演员白模、群众阵列、立方体、球体、圆柱和墙体。
- 移动、旋转、缩放与精确数值编辑。
- 元素重命名、改色、显隐、锁定和删除。
- 自然站立、行走、坐姿、抱臂、指向、单膝跪地姿势预设；人物带有朝身体正面伸出的双脚以及正面的眼镜、嘴巴标识，便于在 Blocking 时识别朝向，跪姿会降低骨盆并分别表现承重腿与落地膝。
- 导演视角与机位视角。
- 多机位 Shot、FOV、Roll、画幅和时长；时长直接决定 24fps 时间线播放终点。
- 可拖动和播放的 24fps 相机关键帧时间线，支持位置、目标和 FOV 插值及越界关键帧清理；导演视角可直接拖拽机位移动与旋转。点击关键帧会切换到机位视角检查最终构图。
- 当前 Shot 可按画幅实时录制为 24fps WebM，保存后在画布创建与导演节点相连的只读视频节点。
- 机位视角支持游戏式自由相机：W/S 前后、A/D 左右、Space/Ctrl 升降，按住鼠标左键拖动旋转；交互结束后提交当前帧关键帧。
- 元素变换快捷键为 V（移动）、R（旋转）、Z（缩放），避免 S 与机位后退冲突。
- 每个 Shot 独立保存演员 Blocking 快照。
- 工程使用共享严格 schema 校验；损坏快照安全归一化，并检查重复 ID、悬空引用、活动 Shot 和关键帧范围。
- 切换或保存前原子提交当前 Shot；新增、删除和锁定元素在所有 Shot 中保持一致语义。
- 截图时冻结编辑并保留地面网格，只隐藏相机标记和变换手柄；画幅框与实际裁切共享同一像素矩形。
- PNG 头、尺寸、完整性与 25MB 大小验证后，以带随机后缀的唯一文件名写入 `generated/director-stills/`。
- 截图自动创建 `readOnly: true` 的图片节点并连接到导演台节点；该节点可作为后续视频参考，但不能修改内容或再次生成图片。
- 支持 16:9、9:16、4:3、1:1，竖屏元数据与生成尺寸保持一致；项目切换后不会跨项目写回节点。
- Three.js 编辑器 lazy import，不增加工作区首屏解析成本。
- `directorProject` 注册为 Canvas object 字段，Agent 可以读取或整体更新结构化工程。

## 数据边界

`DirectorProject` 只能包含可序列化数据。禁止保存：

- Three.js `Object3D`、材质和纹理实例；
- DOM、Canvas 或 WebGL 引用；
- Blob URL、data URL 和外部绝对路径；
- 运行时选择、悬停和 TransformControls 状态。

最近一次构图只在节点 `sourcePath`/`preview` 中引用，实际 PNG 位于项目目录。

## 与视频 Shot 的区别

导演台 Shot 是可编辑的预演机位和站位快照；视频节点内部 Shot 是生成提示词中的连续时间段。导演台不会创建独立视频片段，也不改变“一个生成片段对应一个 video 节点”的生产语义。

## 后续扩展顺序

1. 项目图片作为角色 Billboard、道具贴图和全景环境。
2. 单关节姿势、IK 与导入 GLB/VRM 角色。
3. 可编辑相机/演员关键帧时间轴和路径曲线。
4. 导出 OpenPose、Depth、Normal、Mask 等控制层。
5. 为导演工程增加细粒度 Canvas/Agent 动作，避免 Agent 每次整体替换 JSON。
6. 预演 MP4 和首尾帧批量输出。
