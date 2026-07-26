import { GEOGEBRA_CONSTRUCTION_GUIDE, GEOGEBRA_REFERENCE } from '@/lib/math/geogebra-commands';
import { formatFullCommandIndexAppendix } from '@/lib/math/geogebra-context-builder';
import { GGB_INDEX_META } from '@/lib/math/geogebra-command-index';

/** Full GGB language spec for /rulesggb (client meta command). */
export function formatGgbRulesReference(): string {
  return [
    `# GeoGebra 作图语言规范（${GGB_INDEX_META.uniqueCommandCount} 条官方命令）`,
    '',
    '## 执行顺序与禁止项',
    GEOGEBRA_CONSTRUCTION_GUIDE.trim(),
    '',
    '## 常用命令速查',
    GEOGEBRA_REFERENCE.trim(),
    '',
    formatFullCommandIndexAppendix(),
    '',
    `Manual: ${GGB_INDEX_META.sourceRepo} · synced ${GGB_INDEX_META.syncedAt.slice(0, 10)}`,
  ].join('\n');
}
