type PlacedNode = { position: { x: number; y: number }; measured?: { width?: number; height?: number }; width?: number; height?: number; data: { kind: string } }
export function vacantNodePosition(nodes: PlacedNode[], center: { x: number; y: number }, width: number, height = 500) {
  const gap = 48
  const origin = { x: center.x - width / 2, y: center.y - height / 2 }
  for (let row = 0; row <= nodes.length; row++) {
    for (let column = 0; column < 4; column++) {
      const candidate = { x: origin.x + column * (width + gap), y: origin.y + row * (height + gap) }
      if (nodes.every((node) => {
        const otherWidth = node.measured?.width ?? node.width ?? (['image', 'video'].includes(node.data.kind) ? 620 : 520)
        const otherHeight = node.measured?.height ?? node.height ?? 500
        return candidate.x + width + gap <= node.position.x || candidate.x >= node.position.x + otherWidth + gap
          || candidate.y + height + gap <= node.position.y || candidate.y >= node.position.y + otherHeight + gap
      })) return candidate
    }
  }
  return { x: origin.x, y: origin.y + (nodes.length + 1) * (height + gap) }
}
