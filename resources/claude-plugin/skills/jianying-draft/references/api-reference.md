# pyJianYingDraft 完整 API 参考

基于 pyJianYingDraft 0.3.0 源码整理。目录：

- [时间工具](#时间工具)
- [DraftFolder 草稿文件夹](#draftfolder-草稿文件夹)
- [ScriptFile 草稿文件](#scriptfile-草稿文件)
- [轨道操作](#轨道操作)
- [素材](#素材)
- [VideoSegment 视频/图片片段](#videosegment-视频图片片段)
- [AudioSegment 音频片段](#audiosegment-音频片段)
- [StickerSegment 贴纸片段](#stickersegment-贴纸片段)
- [TextSegment 文本片段](#textsegment-文本片段)
- [ClipSettings 图像调节](#clipsettings-图像调节)
- [关键帧](#关键帧)
- [元数据枚举总表](#元数据枚举总表)
- [异常](#异常)

## 时间工具

```python
from pyJianYingDraft import SEC, tim, trange, Timerange
```

- `SEC = 1000000`：1 秒的微秒数。
- `tim("1h52m3s")` / `tim("0.15s")` / `tim(500000)` → 微秒 `int`，支持负号。
- `Timerange(start, duration)`：属性 `start`、`duration`、`end`（均微秒）；方法 `overlaps(other)`。
- `trange(start, duration)`：便捷构造，两个参数都接受字符串或微秒数。**第二参数是持续时长，不是结束时间**。
- 片段属性 `seg.start` / `seg.duration` / `seg.end` 均为微秒。

## DraftFolder 草稿文件夹

```python
draft_folder = draft.DraftFolder("<剪映草稿文件夹路径>", fallback_loader=None)
```

- `fallback_loader`：可选回调，输入 `draft_content.json` 原始字节，返回 JSON 字符串或 dict。新版剪映草稿非明文 JSON 时需要它（模板模式）。

方法：

| 方法 | 说明 |
|---|---|
| `list_drafts() -> List[str]` | 列出文件夹中所有草稿名 |
| `has_draft(name) -> bool` | 检查草稿是否存在 |
| `remove(name)` | 删除指定草稿 |
| `create_draft(name, width, height, fps=30, *, maintrack_adsorb=True, allow_replace=False) -> ScriptFile` | 新建草稿并开始编辑。`allow_replace=True` 时允许覆盖同名草稿 |
| `load_template(name) -> ScriptFile` | 以模板模式打开已有草稿进行编辑 |
| `duplicate_as_template(template_name, new_name, allow_replace=False) -> ScriptFile` | 复制一份草稿并在副本上编辑 |
| `inspect_material(name)` | 打印指定草稿中的贴纸/气泡/花字元数据（resource_id 等） |

## ScriptFile 草稿文件

属性：`width`、`height`、`fps`、`duration`（微秒，自动随片段更新）、`maintrack_adsorb`（主轨磁吸）。

| 方法 | 说明 |
|---|---|
| `save()` | 保存到打开时的路径（模板模式 / `create_draft` 之后用） |
| `dump(file_path)` | 导出到任意路径 |
| `dumps() -> str` | 导出为 JSON 字符串 |
| `add_material(material)` | 向草稿添加 `VideoMaterial`/`AudioMaterial`（`add_segment` 时会自动添加，一般不用手动调） |
| `add_segment(segment, track=None)` | 添加片段到轨道；`track` 为轨道名或 `TrackRef`，同类轨道仅一条时可省略。链式返回 `ScriptFile` |
| `add_effect(effect, t_range, track_name=None, *, params=None)` | 向独立特效轨道加特效片段（全局作用） |
| `add_filter(filter_meta, t_range, track_name=None, intensity=100.0)` | 向独立滤镜轨道加滤镜片段 |
| `import_srt(srt_path, track_name, *, time_offset=0.0, style_reference=None, text_style=..., clip_settings=...)` | 导入 SRT 字幕（详见下文） |
| `get_imported_track(track_type, name=None, index=None)` | 模板模式：取导入轨道（见 template-and-export.md） |
| `list_imported_tracks(track_type=None)` | 模板模式：列出导入轨道 |
| `import_track(source_script, track, *, offset=0, new_name=None, under_track=None, over_track=None, at_index=None)` | 模板模式：把另一草稿的轨道整体导入 |
| `replace_material_by_name(...)` / `replace_material_by_seg(...)` / `replace_text(...)` | 模板模式替换功能（见 template-and-export.md） |
| `inspect_material()` | 打印本草稿中贴纸/气泡/花字的元数据 |

## 轨道操作

轨道类型 `TrackType`：`video`、`audio`、`text`、`effect`、`filter`、`sticker`（`adjust` 仅供导入，不可新建）。

```python
# 追加到最上层（后来居上，越晚添加越靠前景）
ref = script.append_track(draft.TrackSpec(draft.TrackType.video, "主视频", mute=False))
refs = script.append_tracks([TrackSpec(...), TrackSpec(...)])

# 插入到指定位置：三个定位参数必须且只能给一个
script.insert_track(draft.TrackSpec(draft.TrackType.video, "前景"), over_track=ref)   # ref 上方（更靠前）
script.insert_track(draft.TrackSpec(draft.TrackType.video, "背景"), under_track=ref)  # ref 下方
script.insert_track(draft.TrackSpec(draft.TrackType.video, "底层"), at_index=0)       # 0=最底层
script.insert_tracks([...], over_track=ref)  # 整块插入
```

- `TrackSpec(track_type, name=None, mute=False)`：不指定 name 时用类型名做默认名；同类型已存在匿名轨道时必须显式命名。
- 返回值 `TrackRef` 可直接传给 `add_segment` 的 `track` 参数。
- 轨道名重复会抛 `NameError`。

## 素材

### VideoMaterial（视频或图片）

```python
mat = draft.VideoMaterial(path, material_name=None, crop_settings=draft.CropSettings())
```

- 支持 mp4/mov/avi 等视频、jpg/jpeg/png 图片、gif。
- 属性：`duration`（微秒；图片固定为 3 小时）、`width`、`height`、`material_type`（`"video"` 或 `"photo"`）、`path`。
- `CropSettings`：裁剪设置，8 个角点坐标（0~1，原点在左上），默认不裁剪。要设置裁剪必须用"先建素材再造片段"的传统构造方式。

### AudioMaterial

```python
mat = draft.AudioMaterial(path, material_name=None)  # 不能传视频文件
```

## VideoSegment 视频/图片片段

```python
seg = draft.VideoSegment(
    material,                    # VideoMaterial 实例或素材路径字符串
    target_timerange,            # 片段在轨道上的时间范围 trange("0s", "4s")
    source_timerange=None,       # 截取素材的时间范围，默认从头按 speed 截取等长部分
    speed=None,                  # 播放速度，默认 1.0
    volume=1.0,                  # 音量
    change_pitch=False,          # 变速时是否变调
    clip_settings=None,          # ClipSettings 图像调节
)
```

截取与变速的三种组合：

```python
# 1. 只给 target：从头截取 target.duration * speed 的素材
draft.VideoSegment(path, trange("0s", "4s"), speed=1.25)   # 截素材前 5 秒
# 2. 只给 source：speed 自动 = source.duration / target.duration
draft.VideoSegment(path, trange("4s", "1s"), source_timerange=trange(0, "4s"))  # 5倍速
# 3. 两者都给：target 的 duration 被覆盖为 source.duration / speed
draft.VideoSegment(path, trange("1s", "999h"), source_timerange=trange(0, "5s"), speed=2.0)
```

`source_timerange` 超出素材时长抛 `ValueError`。所有方法均返回 `self` 可链式调用：

| 方法 | 说明 |
|---|---|
| `add_animation(anim, duration=None)` | 入场 `IntroType` / 出场 `OutroType` / 组合 `GroupAnimationType` 动画。duration 支持 `"1s"` 字符串。组合动画与出入场动画互斥，同类动画只能加一个 |
| `add_effect(effect, params=None)` | 片段特效：`VideoSceneEffectType`（画面特效）或 `VideoCharacterEffectType`（人物特效）。params 是 0~100 的浮点列表，顺序与枚举注释一致，`None` 项用默认值 |
| `add_filter(filter_type, intensity=100.0)` | 滤镜 `FilterType`，intensity 0~100 |
| `add_transition(transition, *, duration=None)` | 转场 `TransitionType`，**加在前一个片段上**；每片段最多一个 |
| `add_fade(in_duration, out_duration)` | 音频淡入淡出（仅对有音轨的视频有效），如 `add_fade("1.5s", "1.5s")`；每片段一次 |
| `add_mask(mask_type, *, center_x=0, center_y=0, size=0.5, rotation=0, feather=0, invert=False, rect_width=None, round_corner=None)` | 蒙版 `MaskType`（线性/镜面/圆形/矩形/爱心/星形）。center 单位是素材像素；size 是主尺寸占素材高度比例；feather/round_corner 0~100；rect_width/round_corner 仅矩形蒙版可用；每片段一个 |
| `add_chroma(color, intensity=20.0, shadow=0.0, edge_smooth=0.0, spill=0.0)` | 色度抠图。color 格式 `#RRGGBBAA`，其余参数 0~100；每片段一个 |
| `add_background_filling(fill_type, blur=0.0625, color="#00000000")` | 背景填充，仅对**底层视频轨道**片段生效。`fill_type="blur"`（模糊，四档值 0.0625/0.375/0.75/1.0）或 `"color"`（纯色，color 为 `#RRGGBBAA`） |
| `set_mix_mode(mode)` | 混合模式 `MixModeType`：正片叠底、颜色减淡、颜色加深、线性加深、柔光、强光、滤色、叠加、变亮、变暗。叠加轨道必须在基础轨道**上方** |
| `add_keyframe(property, time_offset, value)` | 关键帧，见下文"关键帧" |

特效参数示例（params 顺序以枚举成员注释为准，可用 `list_metadata.py` 查看）：

```python
seg.add_effect(VideoSceneEffectType.全息扫描, [None, None, 100.0])  # 前两个默认，第三个参数设为100
```

## AudioSegment 音频片段

```python
seg = draft.AudioSegment(material, target_timerange,
                         source_timerange=None, speed=None, volume=1.0, change_pitch=False)
```

截取/变速规则与 VideoSegment 相同。方法：

| 方法 | 说明 |
|---|---|
| `add_fade(in_duration, out_duration)` | 淡入淡出，每片段一次 |
| `add_effect(effect, params=None)` | 音效：`AudioSceneEffectType`（场景音）/ `ToneEffectType`（音色）/ `SpeechToSongType`（声音成曲，剪映 5.9 不生效）。**每类音效只能加一个** |
| `add_keyframe(time_offset, volume)` | 音量关键帧（音频片段只支持音量），如 `add_keyframe("0s", 0.6)` |

## StickerSegment 贴纸片段

```python
seg = draft.StickerSegment(resource_id, trange("0s", "3s"), clip_settings=None)
```

- `resource_id` 是一串数字字符串，通过对含该贴纸的模板草稿调用 `inspect_material()` 获得。
- 贴纸轨道：`draft.TrackSpec(draft.TrackType.sticker, "sticker")`。
- 支持 `add_keyframe`（位置和缩放相关属性）。

## TextSegment 文本片段

```python
seg = draft.TextSegment(
    "文本内容", trange("0s", "5s"),
    font=draft.FontType.文轩体,            # 字体，默认系统字体
    style=draft.TextStyle(...),           # 字体样式
    clip_settings=draft.ClipSettings(transform_y=-0.8),  # 位置/缩放等
    border=draft.TextBorder(...),         # 描边，默认无
    background=draft.TextBackground(...), # 背景，默认无
    shadow=draft.TextShadow(...),         # 阴影，默认无
)
```

### TextStyle 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `size` | 8.0 | 字号 |
| `bold` / `italic` / `underline` | False | 加粗/斜体/下划线 |
| `color` | (1,1,1) | RGB 三元组，取值 0~1 |
| `alpha` | 1.0 | 不透明度 0~1 |
| `align` | 0 | 0 左 / 1 居中 / 2 右 |
| `vertical` | False | 竖排文本 |
| `letter_spacing` / `line_spacing` | 0 | 字距/行距（与剪映定义一致） |
| `auto_wrapping` | False | 自动换行 |
| `max_line_width` | 0.82 | 最大行宽占屏幕宽度比例 0~1 |

### TextBorder / TextBackground / TextShadow

```python
draft.TextBorder(alpha=1.0, color=(0,0,0), width=40.0)          # width 0~100
draft.TextBackground(color="#RRGGBB", style=1, alpha=1.0,       # style 为 1 或 2
                     round_radius=0.0, height=0.14, width=0.14,
                     horizontal_offset=0.5, vertical_offset=0.5)
draft.TextShadow(alpha=1.0, color=(0,0,0), diffuse=15.0,        # diffuse/distance 0~100
                 distance=5.0, angle=-45.0)                     # angle -180~180
```

### TextSegment 方法

| 方法 | 说明 |
|---|---|
| `add_animation(anim, duration=None)` | 文本动画：`TextIntro`（入场）/ `TextOutro`（出场）/ `TextLoopAnim`（循环）。**先加出入场动画再加循环动画** |
| `add_bubble(effect_id, resource_id)` | 气泡效果，两个 id 通过模板 `inspect_material()` 获得 |
| `add_effect(effect_id)` | 花字效果，id 同上 |
| `add_keyframe(property, time_offset, value)` | 关键帧（仅位置和缩放相关属性） |
| `TextSegment.create_from_template(text, timerange, template)` | 类方法：以现有文本片段为样式模板创建新片段 |

### 导入 SRT 字幕

```python
script.import_srt(
    "subtitles.srt",
    track_name="subtitle",          # 轨道不存在时自动创建（插入到最上层视频/文本轨之上）
    time_offset="1.5s",             # 整体时间偏移
    text_style=draft.TextStyle(size=10, color=(1,0,0)),   # 样式（默认模拟剪映导入样式）
    clip_settings=draft.ClipSettings(transform_y=0.8),    # 位置（默认在屏幕下方 -0.8）
    # style_reference=某个TextSegment  # 用现有文本片段做样式模板，会覆盖 text_style
    # clip_settings=None              # 显式传 None 才采用 style_reference 的位置
)
```

导入的字幕默认启用自动换行。

## ClipSettings 图像调节

```python
draft.ClipSettings(
    alpha=1.0,                    # 不透明度 0~1
    flip_horizontal=False,        # 水平翻转
    flip_vertical=False,          # 垂直翻转
    rotation=0.0,                 # 顺时针角度，可负
    scale_x=1.0, scale_y=1.0,     # 缩放
    transform_x=0.0,              # 水平位移，单位=半个画布宽
    transform_y=0.0,              # 垂直位移，单位=半个画布高（字幕常用 -0.8）
)
```

适用于 VideoSegment / StickerSegment / TextSegment。关键帧优先级高于 ClipSettings。

## 关键帧

```python
from pyJianYingDraft import KeyframeProperty

# 视频/贴纸/文本片段
seg.add_keyframe(KeyframeProperty.alpha, "0s", 1.0)     # time_offset 相对片段头部
seg.add_keyframe(KeyframeProperty.alpha, seg.duration, 0.0)  # 线性插值，模拟淡出

# 音频片段（只能控制音量，不传 property）
audio_seg.add_keyframe("0s", 0.6)
```

`KeyframeProperty` 一览：

| 属性 | 说明 |
|---|---|
| `position_x` / `position_y` | 位移，单位=半个画布宽/高（右/上为正） |
| `rotation` | 顺时针角度 |
| `scale_x` / `scale_y` | 单轴缩放（与 uniform_scale 互斥） |
| `uniform_scale` | 双轴等比缩放 |
| `alpha` | 不透明度，仅视频 |
| `saturation` / `contrast` / `brightness` | 饱和度/对比度/亮度，-1~1，仅视频 |
| `volume` | 音量，音频和视频均可 |

只支持线性插值；不支持特效/滤镜参数的关键帧。

## 元数据枚举总表

均从 `pyJianYingDraft` 顶层导出。成员名通常是剪映中的中文名，所有枚举支持 `XxxType.from_name("名字")`（忽略大小写、空格、下划线）查找。完整清单用 `scripts/list_metadata.py` 查询。

| 枚举 | 用途 | 用在哪 |
|---|---|---|
| `IntroType` / `OutroType` / `GroupAnimationType` | 视频入场/出场/组合动画 | `VideoSegment.add_animation` |
| `TextIntro` / `TextOutro` / `TextLoopAnim` | 文本入场/出场/循环动画 | `TextSegment.add_animation` |
| `VideoSceneEffectType` | 画面特效 | `VideoSegment.add_effect` / `script.add_effect` |
| `VideoCharacterEffectType` | 人物特效 | 同上 |
| `AudioSceneEffectType` / `ToneEffectType` / `SpeechToSongType` | 场景音/音色/声音成曲 | `AudioSegment.add_effect` |
| `FilterType` | 滤镜 | `VideoSegment.add_filter` / `script.add_filter` |
| `TransitionType` | 转场 | `VideoSegment.add_transition` |
| `MaskType` | 蒙版（线性/镜面/圆形/矩形/爱心/星形） | `VideoSegment.add_mask` |
| `MixModeType` | 混合模式（10 种） | `VideoSegment.set_mix_mode` |
| `FontType` | 字体 | `TextSegment(font=...)` |

特效 params：0~100 的浮点列表，顺序以枚举成员注释为准（可用 `list_metadata.py <类别> --search <名>` 查看参数名和默认值），`None` 表示该项用默认值，超出参数个数或范围抛 `ValueError`。

## 异常

`pyJianYingDraft.exceptions` 模块：`SegmentOverlap`（片段重叠）、`TrackNotFound` / `AmbiguousTrack`（模板轨道定位失败）、`MaterialNotFound` / `AmbiguousMaterial`（素材定位失败）、`ExtensionFailed`（替换素材延长失败）、`DraftNotFound` / `AutomationError`（自动导出）、`DraftContentLoadFailed`（模板读取失败）。
