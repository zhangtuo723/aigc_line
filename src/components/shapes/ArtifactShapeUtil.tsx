import { BaseBoxShapeUtil, HTMLContainer, resizeBox, T, type TLResizeInfo } from 'tldraw'
import type { TLBaseShape } from '@tldraw/tlschema'
import type { Artifact } from '../../shared/ipc.types'
import { ArtifactRenderer } from '../ArtifactRenderer'

export type ArtifactShape = TLBaseShape<
  'artifact',
  {
    w: number
    h: number
    artifactId: string
    title: string
    contentType: 'markdown' | 'html' | 'image'
    content: string
  }
>

export class ArtifactShapeUtil extends BaseBoxShapeUtil<ArtifactShape> {
  static override type = 'artifact' as const
  static override props = {
    w: T.number,
    h: T.number,
    artifactId: T.string,
    title: T.string,
    contentType: T.string,
    content: T.string,
  }

  override canResize() {
    return true
  }

  override getDefaultProps(): ArtifactShape['props'] {
    return {
      w: 400,
      h: 300,
      artifactId: '',
      title: '',
      contentType: 'markdown',
      content: '',
    }
  }

  override getIndicatorPath(shape: ArtifactShape): Path2D {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }

  override onResize(shape: ArtifactShape, info: TLResizeInfo<ArtifactShape>) {
    return resizeBox(shape, info, { minWidth: 200, minHeight: 150 })
  }

  override component(shape: ArtifactShape) {
    const { w, h, title, contentType, content, artifactId } = shape.props
    const artifact: Artifact = {
      id: artifactId,
      type: contentType,
      title,
      content,
      width: w,
      height: h,
      timestamp: 0,
    }
    return (
      <HTMLContainer id={shape.id} style={{ width: w, height: h }}>
        <ArtifactRenderer artifact={artifact} onClose={() => this.editor.deleteShape(shape.id)} />
      </HTMLContainer>
    )
  }
}
