import type { Scene } from '../semantics/scene';

export function snapshotScene(scene: Scene, maxLines = 48): string {
  const lines: string[] = [];
  for (const point of scene.points.values()) {
    lines.push(
      `${point.name}: point @ (${point.position.x.toFixed(3)}, ${point.position.y.toFixed(3)}) `
      + `[${point.free ? '自由' : '派生'}]`,
    );
  }
  for (const element of scene.elements) {
    if (element.kind === 'circle') {
      lines.push(
        `circle @ (${element.center.x.toFixed(3)}, ${element.center.y.toFixed(3)}) `
        + `r=${element.radius.toFixed(3)}`,
      );
    } else if (element.kind === 'polyline') {
      lines.push(`polyline ${element.points.length} pts${element.cycle ? ' (cycle)' : ''}`);
    } else if (element.kind === 'label') {
      lines.push(`label "${element.text}" @ (${element.at.x.toFixed(3)}, ${element.at.y.toFixed(3)})`);
    } else {
      lines.push(`${element.right ? 'right-angle' : 'angle'} @ (${element.vertex.x.toFixed(3)}, ${element.vertex.y.toFixed(3)})`);
    }
  }
  for (const issue of scene.issues) lines.push(`! stmt#${issue.stmtIndex}: ${issue.message}`);
  if (lines.length > maxLines) {
    return `${lines.slice(0, maxLines).join('\n')}\n…另有 ${lines.length - maxLines} 行省略`;
  }
  return lines.join('\n');
}
