'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CONSTRUCTION_CATEGORY_LABELS,
  type ConstructionCategory,
} from '@/lib/tikz/authoring/construction-catalog';
import { AUTHORING_TOOLS, type Tool } from '@/lib/tikz/render/tools';
import { createDefaultCommandRegistry } from '@/lib/tikz/commands/default-commands';
import { formatShortcut } from '@/lib/tikz/commands/command-registry';
import {
  TIKZ_HOVER,
  TIKZ_MOTION,
  TIKZ_TAP,
} from './tikz-motion';
import type { TikzEngine } from './use-tikz-engine';

const CATEGORY_ORDER: ConstructionCategory[] = [
  'navigate',
  'primitive',
  'constraint',
  'transform',
  'olympiad',
];

function searchableText(tool: Tool): string {
  return [
    tool.label,
    tool.description,
    tool.id,
    ...tool.aliases,
  ].join(' ').toLocaleLowerCase();
}

export function TikzToolPalette({ engine }: { engine: TikzEngine }) {
  const active = AUTHORING_TOOLS.find((tool) => tool.id === engine.activeTool);
  const [category, setCategory] = useState<ConstructionCategory>(
    active?.category ?? 'primitive',
  );
  const [deckOpen, setDeckOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const deckOpenerRef = useRef<HTMLElement | null>(null);
  const commandRegistry = useMemo(
    () => createDefaultCommandRegistry(),
    [],
  );

  useEffect(() => {
    if (active) setCategory(active.category);
  }, [active]);

  const closeDeck = useCallback(() => {
    setDeckOpen(false);
    setQuery('');
    requestAnimationFrame(() => {
      const target = deckOpenerRef.current?.isConnected
        ? deckOpenerRef.current
        : triggerRef.current;
      target?.focus();
    });
  }, []);

  const toggleDeck = useCallback(() => {
    if (deckOpen) {
      closeDeck();
      return;
    }
    const activeElement = document.activeElement;
    deckOpenerRef.current = activeElement instanceof HTMLElement
      ? activeElement
      : triggerRef.current;
    setDeckOpen(true);
  }, [closeDeck, deckOpen]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      commandRegistry.dispatch({
        shortcut: event,
        event,
        scope: 'global',
        context: {
          togglePalette: toggleDeck,
        },
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commandRegistry, toggleDeck]);

  useEffect(() => {
    if (!deckOpen) return;
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [deckOpen]);

  const visibleTools = useMemo(
    () => AUTHORING_TOOLS.filter((tool) => tool.category === category),
    [category],
  );
  const resultSet = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const source = normalized
      ? AUTHORING_TOOLS.filter((tool) => searchableText(tool).includes(normalized))
      : [
        ...recent
          .map((id) => AUTHORING_TOOLS.find((tool) => tool.id === id))
          .filter((tool): tool is Tool => Boolean(tool)),
        ...AUTHORING_TOOLS.filter((tool) => !recent.includes(tool.id)),
      ];
    return {
      visible: source.slice(0, 24),
      total: source.length,
    };
  }, [query, recent]);
  const results = resultSet.visible;

  const choose = (tool: Tool) => {
    engine.setActiveTool(tool.id);
    setCategory(tool.category);
    setRecent((items) => [tool.id, ...items.filter((id) => id !== tool.id)].slice(0, 6));
    closeDeck();
  };

  return (
    <motion.div
      layout
      className="tz-tool-strip"
      transition={TIKZ_MOTION.softSpring}
    >
      <div className="tz-tool-categories" aria-label="构造工具类别">
        {CATEGORY_ORDER.map((item) => (
          <motion.button
            key={item}
            type="button"
            className={category === item ? 'is-active' : ''}
            aria-pressed={category === item}
            onClick={() => setCategory(item)}
            whileHover={TIKZ_HOVER}
            whileTap={TIKZ_TAP}
          >
            {category === item
              ? (
                <motion.span
                  className="tz-tool-categories__indicator"
                  layoutId="tz-tool-category-indicator"
                  transition={TIKZ_MOTION.spring}
                />
              )
              : null}
            {CONSTRUCTION_CATEGORY_LABELS[item]}
          </motion.button>
        ))}
      </div>
      <div className="tz-tool-palette" role="toolbar" aria-label={`${CONSTRUCTION_CATEGORY_LABELS[category]}工具`}>
        <AnimatePresence initial={false} mode="popLayout">
          {visibleTools.map((tool) => (
            <motion.button
              layout
              key={tool.id}
              type="button"
              className={engine.activeTool === tool.id ? 'is-active' : ''}
              aria-label={tool.label}
              aria-pressed={engine.activeTool === tool.id}
              title={`${tool.description}${tool.shortcut ? ` · ${formatShortcut(tool.shortcut)}` : ''}`}
              onClick={() => choose(tool)}
              {...TIKZ_MOTION.listItem}
              whileHover={{ y: -1, scale: 1.015 }}
              whileTap={TIKZ_TAP}
              transition={TIKZ_MOTION.spring}
            >
              {engine.activeTool === tool.id
                ? (
                  <motion.span
                    className="tz-tool-palette__indicator"
                    layoutId="tz-active-tool-indicator"
                    transition={TIKZ_MOTION.spring}
                  />
                )
                : null}
              <span aria-hidden="true">{tool.symbol}</span>
              <small>{tool.label}</small>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
      <motion.button
        ref={triggerRef}
        className="tz-command-trigger"
        type="button"
        aria-expanded={deckOpen}
        aria-haspopup="dialog"
        aria-controls="tz-command-deck"
        onClick={toggleDeck}
        whileHover={TIKZ_HOVER}
        whileTap={TIKZ_TAP}
      >
        <span>⌘</span>
        命令
        <kbd>⌘K / Ctrl+K</kbd>
      </motion.button>
      <div className="tz-tool-help" role="status">
        <span>{active?.description ?? '选择画板工具'}</span>
        {active?.inputSlots?.length
          ? (
            <span className="tz-tool-help__slots">
              {active.inputSlots.map((slot, index) => (
                <span key={`${slot.id}:${index}`}>{index + 1}. {slot.prompt}</span>
              ))}
            </span>
          )
          : null}
      </div>
      <AnimatePresence>
        {deckOpen
          ? (
            <motion.div
              id="tz-command-deck"
              className="tz-command-deck"
              role="dialog"
              aria-label="几何命令面板"
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                closeDeck();
              }}
              {...TIKZ_MOTION.panel}
              transition={TIKZ_MOTION.softSpring}
            >
            <div className="tz-command-deck__search">
              <span aria-hidden="true">⌕</span>
              <input
                ref={searchRef}
                value={query}
                placeholder="搜索反演、四边形、垂线、inversion…"
                aria-label="搜索几何命令"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && results[0]) {
                    event.preventDefault();
                    choose(results[0]);
                  }
                }}
              />
              <button type="button" onClick={closeDeck} aria-label="关闭命令面板">Esc</button>
            </div>
            <div className="tz-command-deck__meta">
              {query
                ? `找到 ${resultSet.total} 个命令${resultSet.total > results.length ? `，显示前 ${results.length} 个` : ''}`
                : recent.length > 0
                  ? `最近使用与全部命令 · 显示 ${results.length}/${resultSet.total}`
                  : `全部构造命令 · 显示 ${results.length}/${resultSet.total}`}
            </div>
            <div className="tz-command-deck__list">
              <AnimatePresence initial={false} mode="popLayout">
                {results.map((tool, index) => (
                <motion.button
                  layout
                  key={tool.id}
                  type="button"
                  className={index === 0 ? 'is-leading' : ''}
                  onClick={() => choose(tool)}
                  {...TIKZ_MOTION.listItem}
                  whileHover={{ x: 2 }}
                  whileTap={TIKZ_TAP}
                  transition={TIKZ_MOTION.spring}
                >
                  <span className="tz-command-deck__icon" aria-hidden="true">{tool.symbol}</span>
                  <span>
                    <strong>{tool.label}</strong>
                    <small>{tool.description}</small>
                  </span>
                  <span className="tz-command-deck__category">
                    {CONSTRUCTION_CATEGORY_LABELS[tool.category]}
                    {tool.shortcut ? <kbd>{formatShortcut(tool.shortcut)}</kbd> : null}
                  </span>
                </motion.button>
                ))}
              </AnimatePresence>
            </div>
            </motion.div>
          )
          : null}
      </AnimatePresence>
    </motion.div>
  );
}
