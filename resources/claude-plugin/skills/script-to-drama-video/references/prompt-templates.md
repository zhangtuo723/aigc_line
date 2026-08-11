# 生产提示词模板

编写角色图、场景图或视频提示词前读取本文件。所有尖括号占位符都必须替换为具体内容，不要原样提交。

## 图片提示词通用规则

- 图片提示词统一使用中文，按“主体 → 姿态/空间 → 外观与材质 → 光线 → 风格 → 成图约束”的顺序编写。
- FLUX.2 Klein 与 Z-Image Turbo 不使用独立负面提示词。不堆叠“禁止、不要、避免”列表，改为直接描述成图应当具有的可见结果。
- 颜色、材质、数量、方向和位置要与具体对象绑定，不写模糊的全局形容词。
- 只保留对角色识别、服装连续或场景空间有实际帮助的细节。

## A-pose 三视图模板

```text
单张横向角色正交设定板，画面中精确包含同一个角色的三个完整全身视图，从左到右严格排列为：正面、标准侧面、背面。三个人形是同一个人的不同视角，共享完全相同的脸型、五官比例、肤色、发型发色、身高体型、服装、鞋、饰品和随身物。三个视图等比例、等高、等间距，脚底位于同一水平地面线，每个视图都从头顶到鞋底完整可见，四周留有干净空白。

角色身份：<姓名/角色代号>，<年龄段、性别表达、地域/时代身份、体型和气质>。不可变面部特征：<脸型、眉眼、鼻唇、肤色、痣/疤等>。发型：<长度、轮廓、分缝、刘海、发色和质感>。服装版本：<outfitId与适用场次>，<上装、下装、外套、鞋、帽、饰品、材质、颜色、版型、磨损或湿润状态>。

姿态：标准自然 A-pose，双臂向身体两侧轻微张开约 30–45 度，双腿自然分开，手掌放松、五指清晰，躯干和服装轮廓完整显露；中性表情，直立且无遮挡。

统一视觉风格：<用户确认的媒介、写实度、时代和质感>。背景为单一纯净浅灰无缝影棚，均匀中性棚拍光，正交感角色设计展示，透视自然，服装结构和材质细节清晰。最终画面只包含这三个角色视图和纯净背景，呈现为一张完整设定板，画面内没有标题、姓名、字母、标注线、尺寸线、边框或水印。
```

## 场景环境图模板

```text
一张空置无人的环境参考图，<sceneId与地点名称>，<时代、地理区域、室内/室外>，时间为<昼夜/具体时段>，天气为<天气>。这是完整、连续、真实可拍摄的单一空间，画面内没有人物或动物，玻璃和镜面中只显示环境反射。

空间结构：前景是<前景元素>；中景是<主要表演区域、固定家具和关键道具>；背景是<背景、门窗、道路或出入口>。清晰展示人物可进入、行走、站立和交互的空间，各家具、门窗、道路和固定道具的位置关系明确。

材质与陈设：<墙面、地面、家具、植被、车辆、器物的材质、颜色、年代状态>。光线：主光从<方向>进入，色温<冷/暖及数值感>，<辅光、轮廓光、阴影方向、空气雾、反射>。色彩与气氛：<主色、辅色、饱和度、对比度、情绪>。统一风格：<用户确认的媒介、写实度、摄影/美术方向>。<镜头高度、焦段感、广角程度>，清晰展示空间全貌和纵深，材质与固定陈设细节清晰。最终成图是单一场景的沉浸式环境参考，不是多格设计板或平面图，画面内没有字幕、标注、水印或 Logo。
```

## MiniMax H3 全模态参考视频模板（Ref2VA）

### 硬性写作规则

- 最终提交给 H3 的提示词按官方 Ref2VA 格式使用英文编写；只有 `<d>` 内的台词/歌词和画面内真实可见的文字保留原始语言。
- 六个字段的名称与顺序必须为：`subject_definitions` → `summary` → `retention_analysis` → `detailed_description` → `overall_soundscape` → `non_diegetic_music`。
- 先按 `referenceImageNodeIds` / `referenceVideoNodeIds` / `referenceAudioNodeIds` 的实际顺序建立 `<Picture N>` / `<Video N>` / `<Audio N>` 映射，数字与输入槽位严格一致。
- 角色、服装、场景、道具等可复用可见内容用 `<Subject N>` 抽象，并在定义中注明其来自哪个 `<Picture N>`。只有图片本身是首帧、尾帧、关键帧、构图锚点或分镜板时，才单独定义 `<Picture N>`。
- 角色三视图要抽象为一个 `<Subject N>`，明确三个人形是同一人的正面、侧面和背面，目标视频只实例化一个该角色。
- 发声者按目标视频中首次实际发声顺序分配稳定 `(S1)`、`(S2)`。`<d>` 内只写语言标签与必须逐字保留的台词，如 `<d>[Chinese] 你早就知道，对吗？</d>`。
- `[Shot 1]` 不写时间戳。后续镜头用 `[Shot N] At MM:SS.mmm, ...` 表示切点，时间严格递增且不超出视频时长。
- 普通生成任务的 `detailed_description` 通常写 350–500 个英文单词；台词密集时优先保证声画时间线完整，不为凑字数添加无效描述。
- 不添加第七个“负面约束”段。人物、服装、环境、道具的连续性改为 `retention_analysis` 中的正向保留关系，并在镜头描述中持续使用稳定的 `<Subject N>` 标签。

### 标准结构

```text
subject_definitions:
<Subject 1> is <角色名+outfitId> in <Picture 1>. <Picture 1> is a three-view orthographic character sheet showing one identical person from the front, side, and back; the three figures do not represent three different people. <Subject 1> has <脸型、五官、发型、体型、服装、鞋、饰品等必须继承的特征>.
<Subject 2> is <第二角色名+outfitId> in <Picture 2>. <Picture 2> is a three-view orthographic character sheet of one identical person. <Subject 2> has <必须继承的特征>.
<Subject N> is the unoccupied <sceneId> environment in <Picture N>, including <空间布局、固定道具、时间天气、色彩与光源方向>.
<Subject N+1> is <可选关键道具> in <Picture N+1>, with <颜色、材质、形状、磨损/污渍和尺寸关系>. <没有独立道具参考时删除本行>

summary:
[reference generation] Create a <5/10/15>-second <实拍/二维动画/三维动画> drama scene featuring <Subject 1> and <Subject 2> inside <Subject N>. Preserve <主要引用关系>, and stage <这一镜的剧情目标和情绪变化> with synchronized <语言> dialogue and diegetic sound.

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot N]): fully_preserved - <脸、发型、体型、当前服装版本、鞋和饰品始终保持不变>.
<Subject 2> (appears in [Shot 1], [Shot N]): fully_preserved - <需保持的角色特征>.
<Subject N> (appears in [Shot 1], [Shot 2], [Shot N]): fully_preserved - <入口、家具、天气、主光、人物左右位置和轴线的连续关系>.
<Subject N+1> (appears in [Shot N]): fully_preserved - <道具数量、外观、持有者与位置>. <没有道具时删除本行>

detailed_description:
The target video is <类型、时代、地域、媒介、写实度、摄影质感、色彩和表演尺度>.

[Shot 1] <景别、机位高度、角度、焦段感，角色与环境的起始构图>. <Subject 1> <动作路径、速度、表情和视线变化>. The camera <用自然英文写运镜类型、幅度、速度、方向、焦点与结束构图>. <声画触发点>, <说话者身份、声线和情绪> (S1) says: <d>[Chinese] <必须逐字准确的台词></d> while <其他人物>’s lips remain closed and <聆听反应>. <同步环境音与拟音>. The shot ends with <视线/动作/遮挡等明确切镜动机>.

[Shot 2] At 00:<SS.mmm>, the camera cuts to <新景别、机位、构图、焦点与上一镜的承接>. <连续动作、表情反应、空间关系和结束状态>. <英文运镜及声音描述>. <如有台词，使用稳定 Sx 和 `<d>[Chinese] ...</d>`；如无台词，明确无人发声>.

[Shot N] At 00:<SS.mmm>, <承接关系、高潮/反应/信息揭示>. <动作落点、最终表情、人物与道具状态>. <运镜由动到静并明确收束>. <最后台词、旁白或明确无语言>. <同步拟音自然衰减>. The final composition remains stable for <0.3–0.8> seconds and lands on <便于下一个 Canvas 镜头衔接的动作、视线或构图>.

overall_soundscape:
<用 1–4 个英文句子概括全片的环境底噪、动作拟音和非语言人声；人声清晰，环境音低于对白，不重复台词>.

non_diegetic_music: N/A
```

### 旁白、画外音和跨切镜台词

- 旁白/内心独白使用固定短语 `says in an off-screen voiceover`，并在 `<d>` 后立即写 `while every on-screen character's lips remain completely closed`。
- 台词跨切镜时，在两段连接处使用 `<scenetrans>`，并写明语音 `continues seamlessly across the cut`。
- 台词被视频结尾截断时使用 `<cutoff>`，不要用删字、加速或改词来勉强塞入时长。
- 只有剧情明确要求抢话时才让两个语音短暂重叠；普通对话为每句留出反应和呼吸时间。

## 10 秒双人对话示例骨架

以下示范官方 Ref2VA 六段式、角色抽象、台词和切镜密度；实际提示词必须按剧本与实际参考图重写。

```text
subject_definitions:
<Subject 1> is Gu Ning in <Picture 1>. <Picture 1> is a three-view orthographic character sheet showing one identical person from the front, side, and back, not three different people. She has a narrow face, short black hair, a black raincoat, and one silver earring.
<Subject 2> is Chen Mo in <Picture 2>. <Picture 2> is a three-view orthographic character sheet of one identical person. He has a square face, short slightly wavy hair, and a gray knitted home sweater.
<Subject 3> is the unoccupied rain-night living room in <Picture 3>, including the sofa, window, entrance, cold window light, and warm floor lamp.
<Subject 4> is the sealed envelope held by Chen Mo, with off-white paper and a worn folded edge.

summary:
[reference generation] Create a 10-second live-action cinematic suspense scene featuring <Subject 1> and <Subject 2> inside <Subject 3>. Preserve both identities, costumes, the living-room layout, and <Subject 4>, while staging a restrained confrontation with synchronized Chinese dialogue and diegetic sound.

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 3]): fully_preserved - her face, short black hair, black raincoat, silver earring, and body proportions remain unchanged.
<Subject 2> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - his face, wavy hair, gray sweater, and body proportions remain unchanged.
<Subject 3> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - the entrance remains on frame left, the sofa remains on frame right, and the cold rain light and warm floor lamp keep a stable direction.
<Subject 4> (appears in [Shot 2], [Shot 3]): fully_preserved - one sealed envelope remains in Chen Mo's right hand.

detailed_description:
The target video is live-action and cinematic, with restrained performances, low saturation, cold rain light contrasted against a warm practical lamp, natural 35mm lens rendering, and stable screen direction.

[Shot 1] A medium-wide shot frames <Subject 1> entering <Subject 3> from frame left while <Subject 2> stands beside the sofa on frame right. The camera pulls back with small amplitude at slow speed to preserve their spatial relationship. Gu Ning, with a low, restrained female voice (S1), stops and says: <d>[Chinese] 你早就知道，对吗？</d> Her lips synchronize naturally with the complete line. Chen Mo remains silent with his lips closed, first avoiding her gaze and then looking toward her. Wet footsteps, dripping fabric, and low rain ambience remain audible. The shot ends when Gu Ning looks toward the envelope in his hand.

[Shot 2] At 00:03.500, the camera cuts on her eyeline to a close-up of <Subject 4> in <Subject 2>'s right hand. His fingers tighten around the paper as the focus shifts toward his tense jaw in the background. No one speaks. A restrained inhale and a soft paper crumple are audible. At the end of the shot, he raises his eyes toward Gu Ning.

[Shot 3] At 00:06.000, the camera cuts to a close-up of <Subject 2>, with <Subject 1>'s shoulder softly out of focus in the left foreground. The camera pushes in with small amplitude at slow speed. Chen Mo, with a low, hesitant male voice (S2), says: <d>[Chinese] 我只是没想到，你会回来。</d> His lips synchronize naturally with the complete line. Gu Ning remains silent with her lips closed. Chen Mo lowers his gaze after finishing the sentence, and the final composition remains static for 0.5 seconds.

overall_soundscape:
Low rain taps against the windows throughout the video. Wet footsteps, fabric movement, one restrained inhale, and a soft paper crumple remain spatially synchronized and lower in volume than the dialogue.

non_diegetic_music: N/A
```
