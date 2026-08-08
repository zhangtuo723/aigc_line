---
name: jianying-draft
description: 用 pyJianYingDraft（Python 库）编写脚本生成剪映专业版草稿，实现自动化视频剪辑/混剪流水线。当用户需要：用代码剪辑视频、生成剪映草稿、批量混剪、自动加字幕/转场/特效/滤镜/动画/蒙版/关键帧、替换模板草稿中的素材或文本、批量导出剪映草稿，或询问 pyJianYingDraft 的安装与用法时使用本技能。
---

# 剪映草稿脚本剪辑（pyJianYingDraft）

通过 pyJianYingDraft 用 Python 脚本在剪映草稿文件夹中生成草稿（`draft_content.json`），随后打开剪映专业版即可看到并导出成片。

## 安装

```bash
pip install pyJianYingDraft
```

- 推荐 Python 3.8 / 3.11（3.13 下自动导出依赖 `uiautomation` 可能有问题）。
- 依赖 `pymediainfo`；若报 MediaInfo 解析错误，Linux 需 `apt install libmediainfo-dev`，Mac 需 `brew install mediainfo`。
- 草稿生成与模板模式跨平台可用；**自动导出（JianyingController）仅限 Windows + 剪映 6 及以下版本**。
- 生成草稿前必须知道用户的**剪映草稿文件夹路径**（剪映"全局设置 → 草稿位置"中可查，形如 `.../JianyingPro Drafts`），用它初始化 `DraftFolder`。
- 剪映 5.9 与新版（如 10.8）均验证可用；蒙版在新版暂不支持；新版草稿非明文 JSON 时模板模式需 `fallback_loader`。

## 核心概念

- 时间单位是**微秒**。用 `trange("0s", "5s")` 构造时间范围（第二参数是**持续时长**不是结束时间），`tim("1m30s")` 转微秒，`SEC` 为 1 秒的微秒数。
- 流程固定为：`DraftFolder` → `create_draft()` 得 `ScriptFile` → 建轨道 → 造片段 → `add_segment` → `save()`。
- 轨道用 `TrackSpec(TrackType.video, "名称")` 描述，类型有 video / audio / text / effect / filter / sticker。`append_track` 追加到最上层（后来居上），`insert_track` 可指定层次。
- 同一类型轨道多于一条时，`add_segment` 必须指定轨道名。
- 特效/滤镜/转场/动画/字体全部通过枚举类引用，成员名通常就是剪映里的中文名（如 `TransitionType.信号故障`、`FilterType.原生肤`）。**不确定名字时用脚本查询**：

```bash
python <skill目录>/scripts/list_metadata.py --all                  # 列出全部类别
python <skill目录>/scripts/list_metadata.py transitions --search 故障
python <skill目录>/scripts/list_metadata.py scene-effects --search 扫描   # 附带参数说明
```

## 最小完整示例

```python
import pyJianYingDraft as draft
from pyJianYingDraft import trange, IntroType, TransitionType

draft_folder = draft.DraftFolder(r"<剪映草稿文件夹>")
script = draft_folder.create_draft("my_draft", 1920, 1080, allow_replace=True)

script.append_tracks([
    draft.TrackSpec(draft.TrackType.audio, "bgm"),
    draft.TrackSpec(draft.TrackType.video, "main"),
    draft.TrackSpec(draft.TrackType.text, "caption"),
])

# 音频：截取前5秒、音量60%、1秒淡入
audio = draft.AudioSegment("audio.mp3", trange("0s", "5s"), volume=0.6)
audio.add_fade("1s", "0s")

# 视频：取素材前4.2秒，加入场动画；转场加在"前一个"片段上
v1 = draft.VideoSegment("video.mp4", trange("0s", "4.2s"))
v1.add_animation(IntroType.斜切)
v1.add_transition(TransitionType.信号故障)
v2 = draft.VideoSegment("clip2.mp4", trange("4.2s", "3s"))

# 文本：黄色、居中、位于屏幕下方（transform_y 单位是半个画布高）
text = draft.TextSegment("你好剪映", trange("0s", "4s"),
                         font=draft.FontType.文轩体,
                         style=draft.TextStyle(size=5.0, color=(1, 1, 0), align=1),
                         clip_settings=draft.ClipSettings(transform_y=-0.8))

script.add_segment(audio, "bgm").add_segment(v1, "main").add_segment(v2, "main")
script.add_segment(text, "caption")
script.save()
```

## 能力地图（详情见 references）

| 需求 | 入口 |
|---|---|
| 截取/变速/音量/变调 | `VideoSegment` / `AudioSegment` 构造参数 `source_timerange`、`speed`、`volume`、`change_pitch` |
| 旋转/翻转/缩放/位移/不透明度 | `ClipSettings` 构造参数 |
| 关键帧（位置/旋转/缩放/透明度/饱和度/音量…） | `segment.add_keyframe(KeyframeProperty.xxx, 时刻, 值)` |
| 蒙版 / 色度抠图 / 混合模式 / 背景填充 | `add_mask` / `add_chroma` / `set_mix_mode` / `add_background_filling` |
| 转场 / 片段特效 / 滤镜 / 动画 | `add_transition` / `add_effect` / `add_filter` / `add_animation` |
| 独立特效轨、滤镜轨 | `script.add_effect(...)` / `script.add_filter(...)` |
| 文本样式/描边/背景/阴影/气泡/花字/自动换行 | `TextSegment` + `TextStyle` / `TextBorder` / `TextBackground` / `TextShadow` / `add_bubble` / `add_effect` |
| 导入 SRT 字幕 | `script.import_srt(...)` |
| 贴纸 | `StickerSegment(resource_id, trange)`（resource_id 由模板 `inspect_material` 获得） |
| 模板替换素材/文本、导入模板轨道 | 见 references/template-and-export.md |
| 批量导出草稿（Win + 剪映≤6） | 见 references/template-and-export.md |

## 参考文件

- **完整 API 细节**（所有构造参数、关键帧属性表、特效参数传法、字幕导入）：读 [references/api-reference.md](references/api-reference.md)
- **模板模式与批量导出**（复制模板、按名/按片段替换素材、替换文本、导入轨道、JianyingController 导出）：读 [references/template-and-export.md](references/template-and-export.md)
- **完整成品示例**（混剪流水线、字幕视频、模板批量替换）：读 [references/recipes.md](references/recipes.md)

## 常见坑

- `trange` 第二参数是**持续时长**；`source_timerange` 不能超出素材实际长度，否则抛 `ValueError`。
- 转场加在**前一个**视频片段上；每片段只能有一个转场、一个蒙版、一个淡入淡出、一个色度抠图。
- 文本同时加出入场动画和循环动画时，**先加出入场再加循环**；视频的组合动画不能与出入场动画共存。
- 关键帧优先级高于 `ClipSettings`，会覆盖对应属性。
- 未缓存的特效/字体首次打开草稿可能提示"加载失败"，让剪映重新打开一次草稿即可。
- 写完脚本后**实际运行一遍**验证无异常，再提示用户去剪映中打开对应草稿（可能需重进草稿列表刷新）。
