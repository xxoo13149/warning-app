import { drag } from 'd3-drag';
import {
  forceCollide,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
} from 'd3-force';
import { pointer as getPointer, select } from 'd3-selection';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AppLanguage } from '../types/contracts';
import type {
  BubbleBurstState,
  BubbleRuntimeNode,
  CityBubbleVisualRow,
} from '../types/bubble-board';
import {
  BUBBLE_FLASH_WINDOW_MS,
  BUBBLE_SCENE_PADDING,
  buildBubbleRadius,
  computeBurstImpulse,
  deriveBubbleHue,
  generateBubblePoints,
  pickVisibleBubbleLabels,
  stableHash,
} from '../utils/bubble-board';
import {
  formatMarketCentsLabel,
  formatMarketPercent,
  formatTemperatureBandLabel,
} from '../utils/market-display';

interface BubbleBoardProps {
  rows: CityBubbleVisualRow[];
  selectedCityKey: string | null;
  onSelectCity: (row: CityBubbleVisualRow) => void;
  onOpenDetails: (row: CityBubbleVisualRow) => void;
  language: AppLanguage;
}

const LABEL_LIMIT = 12;
const DRAG_THRESHOLD_PX = 6;
const IDLE_ALPHA_TARGET = 0.012;
const INTERACTION_ALPHA = 0.18;
const FLOAT_INTERVAL_MS = 2400;
const TOOLTIP_WIDTH = 292;
const TOOLTIP_HEIGHT = 210;
const BURST_VISUAL_MS = 520;
const BUBBLE_PADDING = BUBBLE_SCENE_PADDING;
const HALO_RADIUS_PADDING = 6;
const COLLISION_PADDING = 4;

const bubbleCopy = {
  'zh-CN': {
    yes: '“是”价格',
    bid: '买一',
    ask: '卖一',
    spread: '价差',
    change5m: '5 分钟变化',
    rule: '主导规则',
    updatedAt: '最近更新',
    alertFlash: '新告警闪红',
    flashOn: '进行中',
    flashOff: '无',
    watchlist: '关注',
    severityNone: '无告警',
    severityInfo: '弱',
    severityWarning: '弱',
    severityCritical: '强',
    noRule: '暂无主导规则',
  },
  'en-US': {
    yes: 'YES',
    bid: 'Bid',
    ask: 'Ask',
    spread: 'Spread',
    change5m: '5m Change',
    rule: 'Dominant Rule',
    updatedAt: 'Updated',
    alertFlash: 'Fresh Alert Flash',
    flashOn: 'Active',
    flashOff: 'None',
    watchlist: 'Watchlist',
    severityNone: 'No Alert',
    severityInfo: 'Weak',
    severityWarning: 'Weak',
    severityCritical: 'Strong',
    noRule: 'No dominant rule',
  },
} as const;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const resolveSeverityLabel = (
  severity: CityBubbleVisualRow['ringSeverity'],
  language: AppLanguage,
) => {
  const copy = bubbleCopy[language];
  if (severity === 'critical') return copy.severityCritical;
  if (severity === 'warning') return copy.severityWarning;
  if (severity === 'info') return copy.severityInfo;
  return copy.severityNone;
};

const resolveRingColor = (severity: CityBubbleVisualRow['ringSeverity']) => {
  if (severity === 'critical') {
    return {
      ring: 'rgba(255, 119, 102, 0.92)',
      halo: 'rgba(255, 103, 84, 0.34)',
    };
  }
  if (severity === 'warning') {
    return {
      ring: 'rgba(255, 186, 104, 0.88)',
      halo: 'rgba(255, 182, 80, 0.28)',
    };
  }
  if (severity === 'info') {
    return {
      ring: 'rgba(122, 218, 255, 0.82)',
      halo: 'rgba(90, 198, 255, 0.24)',
    };
  }
  return {
    ring: 'rgba(164, 205, 237, 0.34)',
    halo: 'rgba(116, 155, 193, 0.15)',
  };
};

const buildGlassPalette = (
  seed: number,
  flashRatio: number,
): {
  fillA: string;
  fillB: string;
  fillC: string;
  shadow: string;
  edge: string;
  flash: string;
} => {
  const hue = deriveBubbleHue(seed);
  const flashMix = clamp(flashRatio, 0, 1);
  const baseHue = Math.round(hue * (1 - flashMix) + 4 * flashMix);
  return {
    fillA: `hsla(${baseHue}, ${64 - flashMix * 18}%, ${72 - flashMix * 6}%, 0.96)`,
    fillB: `hsla(${baseHue + 6}, ${56 - flashMix * 12}%, ${46 - flashMix * 8}%, 0.92)`,
    fillC: `hsla(${baseHue + 14}, ${45 - flashMix * 6}%, ${18 - flashMix * 6}%, 0.96)`,
    shadow: flashMix > 0.05 ? 'rgba(255, 95, 81, 0.45)' : 'rgba(76, 122, 170, 0.22)',
    edge: flashMix > 0.05 ? 'rgba(255, 198, 190, 0.62)' : 'rgba(242, 248, 255, 0.26)',
    flash: `rgba(255, 88, 72, ${0.16 + flashMix * 0.38})`,
  };
};

const getBurstRadius = (width: number) => (width <= 900 ? 120 : 168);
const getBurstStrength = (width: number) => (width <= 900 ? 0.24 : 0.32);

const buildSceneSignature = (rows: CityBubbleVisualRow[]) =>
  rows
    .map((row) => `${row.cityKey}:${row.cityBubbleScore.toFixed(2)}:${row.eventDate}`)
    .join('|');

const buildRuntimeNodes = (
  rows: CityBubbleVisualRow[],
  width: number,
  height: number,
  previousNodes: BubbleRuntimeNode[],
): BubbleRuntimeNode[] => {
  if (rows.length === 0 || width <= 0 || height <= 0) {
    return [];
  }

  const previousByKey = new Map(previousNodes.map((node) => [node.cityKey, node]));
  const sortedRows = [...rows].sort(
    (left, right) => stableHash(left.cityKey) - stableHash(right.cityKey),
  );
  const points = generateBubblePoints({
    count: sortedRows.length,
    width,
    height,
    padding: BUBBLE_PADDING,
    seed: stableHash(sortedRows.map((row) => row.cityKey).join('|')),
  });

  return sortedRows.map((row, index) => {
    const previous = previousByKey.get(row.cityKey);
    const radius = buildBubbleRadius({
      score: row.cityBubbleScore,
      width,
      height,
      count: rows.length,
    });
    const seededPoint = points[index] ?? { x: width / 2, y: height / 2 };
    const homeX = clamp(
      previous?.homeX ?? seededPoint.x,
      BUBBLE_PADDING + radius,
      Math.max(BUBBLE_PADDING + radius, width - BUBBLE_PADDING - radius),
    );
    const homeY = clamp(
      previous?.homeY ?? seededPoint.y,
      BUBBLE_PADDING + radius,
      Math.max(BUBBLE_PADDING + radius, height - BUBBLE_PADDING - radius),
    );
    const x = clamp(
      previous?.x ?? homeX,
      BUBBLE_PADDING + radius,
      Math.max(BUBBLE_PADDING + radius, width - BUBBLE_PADDING - radius),
    );
    const y = clamp(
      previous?.y ?? homeY,
      BUBBLE_PADDING + radius,
      Math.max(BUBBLE_PADDING + radius, height - BUBBLE_PADDING - radius),
    );

    return {
      cityKey: row.cityKey,
      row,
      radius,
      homeX,
      homeY,
      x,
      y,
      vx: previous?.vx ?? 0,
      vy: previous?.vy ?? 0,
      fx: previous?.fx ?? null,
      fy: previous?.fy ?? null,
      dragOriginX: previous?.dragOriginX ?? x,
      dragOriginY: previous?.dragOriginY ?? y,
      isDragging: false,
    };
  });
};

const sortRenderNodes = (
  nodes: BubbleRuntimeNode[],
  selectedCityKey: string | null,
  hoveredCityKey: string | null,
  draggingCityKey: string | null,
) =>
  [...nodes].sort((left, right) => {
    const weight = (node: BubbleRuntimeNode) => {
      if (node.cityKey === draggingCityKey) return 4;
      if (node.cityKey === hoveredCityKey) return 3;
      if (node.cityKey === selectedCityKey) return 2;
      return 1;
    };
    const weightDelta = weight(left) - weight(right);
    if (weightDelta !== 0) {
      return weightDelta;
    }
    return left.radius - right.radius;
  });

const formatTooltipTime = (value: string, language: AppLanguage) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(language, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
};

const computeTooltipPosition = (x: number, y: number, width: number, height: number) => ({
  left: clamp(x + 18, 12, Math.max(12, width - TOOLTIP_WIDTH - 12)),
  top: clamp(y + 18, 12, Math.max(12, height - TOOLTIP_HEIGHT - 12)),
});

export const BubbleBoard = ({
  rows,
  selectedCityKey,
  onSelectCity,
  onOpenDetails,
  language,
}: BubbleBoardProps) => {
  const copy = bubbleCopy[language];
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodeElementsRef = useRef(new Map<string, SVGGElement>());
  const nodesRef = useRef<BubbleRuntimeNode[]>([]);
  const simulationRef = useRef<Simulation<BubbleRuntimeNode, undefined> | null>(null);
  const frameRef = useRef<number | null>(null);
  const floatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const burstTimeoutRef = useRef<number | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [renderVersion, setRenderVersion] = useState(0);
  const [hoveredCityKey, setHoveredCityKey] = useState<string | null>(null);
  const [draggingCityKey, setDraggingCityKey] = useState<string | null>(null);
  const [tooltipState, setTooltipState] = useState<{ cityKey: string; x: number; y: number } | null>(
    null,
  );
  const [burstState, setBurstState] = useState<BubbleBurstState | null>(null);

  const sceneSignature = useMemo(() => buildSceneSignature(rows), [rows]);
  const labelCityKeys = useMemo(
    () => pickVisibleBubbleLabels(rows, LABEL_LIMIT, selectedCityKey, hoveredCityKey),
    [hoveredCityKey, rows, selectedCityKey],
  );

  const scheduleFrame = useCallback(() => {
    if (frameRef.current !== null) {
      return;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      setRenderVersion((version) => version + 1);
    });
  }, []);

  const syncRowsIntoNodes = useCallback(
    (nextRows: CityBubbleVisualRow[]) => {
      const nextByKey = new Map(nextRows.map((row) => [row.cityKey, row]));
      nodesRef.current = nodesRef.current
        .filter((node) => nextByKey.has(node.cityKey))
        .map((node) => ({
          ...node,
          row: nextByKey.get(node.cityKey) ?? node.row,
        }));
      scheduleFrame();
    },
    [scheduleFrame],
  );

  const updateTooltipFromEvent = useCallback(
    (event: React.MouseEvent<SVGGElement>, cityKey: string) => {
      if (!wrapperRef.current) {
        return;
      }
      const rect = wrapperRef.current.getBoundingClientRect();
      setTooltipState({
        cityKey,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    },
    [],
  );

  const triggerBurst = useCallback(
    (x: number, y: number, sourceCityKey?: string | null) => {
      const simulation = simulationRef.current;
      if (!simulation) {
        return;
      }

      const radius = getBurstRadius(size.width);
      const strength = getBurstStrength(size.width);
      let affected = false;

      for (const node of nodesRef.current) {
        if (sourceCityKey && node.cityKey === sourceCityKey) {
          continue;
        }

        const impulse = computeBurstImpulse({
          nodeX: node.x ?? node.homeX,
          nodeY: node.y ?? node.homeY,
          centerX: x,
          centerY: y,
          radius,
          strength,
        });

        if (!impulse.affected) {
          continue;
        }

        node.vx = (node.vx ?? 0) + impulse.vx;
        node.vy = (node.vy ?? 0) + impulse.vy;
        affected = true;
      }

      const startedAt = Date.now();
      setBurstState({
        x,
        y,
        radius,
        startedAt,
        sourceCityKey,
      });

      if (burstTimeoutRef.current) {
        window.clearTimeout(burstTimeoutRef.current);
      }
      burstTimeoutRef.current = window.setTimeout(() => {
        setBurstState((current) =>
          current && current.startedAt === startedAt ? null : current,
        );
      }, BURST_VISUAL_MS);

      if (affected) {
        simulation.alpha(Math.max(simulation.alpha(), INTERACTION_ALPHA)).restart();
      } else {
        scheduleFrame();
      }
    },
    [scheduleFrame, size.width],
  );

  useEffect(() => {
    if (!wrapperRef.current) {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      if (!wrapperRef.current) {
        return;
      }
      setSize({
        width: wrapperRef.current.clientWidth,
        height: wrapperRef.current.clientHeight,
      });
    });

    observer.observe(wrapperRef.current);
    setSize({
      width: wrapperRef.current.clientWidth,
      height: wrapperRef.current.clientHeight,
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    syncRowsIntoNodes(rows);
  }, [rows, syncRowsIntoNodes]);

  useEffect(() => {
    if (size.width <= 0 || size.height <= 0) {
      return undefined;
    }

    const runtimeNodes = buildRuntimeNodes(rows, size.width, size.height, nodesRef.current);
    nodesRef.current = runtimeNodes;

    simulationRef.current?.stop();

    const simulation = forceSimulation(runtimeNodes)
      .alpha(0.16)
      .alphaDecay(0.07)
      .alphaTarget(IDLE_ALPHA_TARGET)
      .velocityDecay(0.32)
      .force(
        'collide',
        forceCollide<BubbleRuntimeNode>()
          .radius((node) => node.radius + COLLISION_PADDING)
          .iterations(2),
      )
      .force('charge', forceManyBody<BubbleRuntimeNode>().strength(-4))
      .force('home-x', forceX<BubbleRuntimeNode>((node) => node.homeX).strength(0.026))
      .force('home-y', forceY<BubbleRuntimeNode>((node) => node.homeY).strength(0.026))
      .on('tick', () => {
        for (const node of nodesRef.current) {
          const x = clamp(
            node.x ?? node.homeX,
            BUBBLE_PADDING + node.radius,
            Math.max(BUBBLE_PADDING + node.radius, size.width - BUBBLE_PADDING - node.radius),
          );
          const y = clamp(
            node.y ?? node.homeY,
            BUBBLE_PADDING + node.radius,
            Math.max(BUBBLE_PADDING + node.radius, size.height - BUBBLE_PADDING - node.radius),
          );
          node.x = x;
          node.y = y;

          if (!node.isDragging) {
            node.homeX = clamp(
              node.homeX,
              BUBBLE_PADDING + node.radius,
              Math.max(BUBBLE_PADDING + node.radius, size.width - BUBBLE_PADDING - node.radius),
            );
            node.homeY = clamp(
              node.homeY,
              BUBBLE_PADDING + node.radius,
              Math.max(BUBBLE_PADDING + node.radius, size.height - BUBBLE_PADDING - node.radius),
            );
          }
        }
        scheduleFrame();
      });

    simulationRef.current = simulation;
    scheduleFrame();

    return () => {
      simulation.stop();
    };
  }, [sceneSignature, scheduleFrame, size.height, size.width]);

  useEffect(() => {
    if (floatTimerRef.current) {
      clearInterval(floatTimerRef.current);
    }

    if (!simulationRef.current || nodesRef.current.length === 0) {
      return undefined;
    }

    let step = 0;
    floatTimerRef.current = setInterval(() => {
      const simulation = simulationRef.current;
      if (!simulation) {
        return;
      }

      step += 1;
      for (const node of nodesRef.current) {
        if (node.isDragging) {
          continue;
        }
        const seed = stableHash(`${node.cityKey}:${step}`);
        const angle = ((seed % 360) * Math.PI) / 180;
        const drift = 0.028 + ((seed >>> 3) % 7) * 0.004;
        node.vx = (node.vx ?? 0) + Math.cos(angle) * drift;
        node.vy = (node.vy ?? 0) + Math.sin(angle) * drift;
      }

      simulation.alpha(Math.max(simulation.alpha(), 0.05)).restart();
    }, FLOAT_INTERVAL_MS);

    return () => {
      if (floatTimerRef.current) {
        clearInterval(floatTimerRef.current);
        floatTimerRef.current = null;
      }
    };
  }, [sceneSignature]);

  useEffect(() => {
    const simulation = simulationRef.current;
    const svgElement = svgRef.current;
    if (!simulation || !svgElement) {
      return;
    }

    const dragBehavior = drag<SVGGElement, BubbleRuntimeNode>()
      .clickDistance(DRAG_THRESHOLD_PX)
      .container(svgElement)
      .on('start', (event, node) => {
        node.dragOriginX = node.x ?? node.homeX;
        node.dragOriginY = node.y ?? node.homeY;
        node.isDragging = true;
        setDraggingCityKey(node.cityKey);
        if (!event.active) {
          simulation.alphaTarget(INTERACTION_ALPHA).restart();
        }
        node.fx = node.x ?? node.homeX;
        node.fy = node.y ?? node.homeY;
      })
      .on('drag', (event, node) => {
        node.fx = clamp(
          event.x,
          BUBBLE_PADDING + node.radius,
          Math.max(BUBBLE_PADDING + node.radius, size.width - BUBBLE_PADDING - node.radius),
        );
        node.fy = clamp(
          event.y,
          BUBBLE_PADDING + node.radius,
          Math.max(BUBBLE_PADDING + node.radius, size.height - BUBBLE_PADDING - node.radius),
        );
        node.homeX = node.fx;
        node.homeY = node.fy;
        scheduleFrame();
      })
      .on('end', (event, node) => {
        const finalX = clamp(
          node.fx ?? node.x ?? node.homeX,
          BUBBLE_PADDING + node.radius,
          Math.max(BUBBLE_PADDING + node.radius, size.width - BUBBLE_PADDING - node.radius),
        );
        const finalY = clamp(
          node.fy ?? node.y ?? node.homeY,
          BUBBLE_PADDING + node.radius,
          Math.max(BUBBLE_PADDING + node.radius, size.height - BUBBLE_PADDING - node.radius),
        );

        node.homeX = finalX;
        node.homeY = finalY;
        node.fx = null;
        node.fy = null;
        node.isDragging = false;

        if (
          Math.hypot(finalX - node.dragOriginX, finalY - node.dragOriginY) >
          DRAG_THRESHOLD_PX
        ) {
          suppressClickUntilRef.current = performance.now() + 260;
        }

        if (!event.active) {
          simulation.alphaTarget(IDLE_ALPHA_TARGET);
        }
        simulation.alpha(Math.max(simulation.alpha(), 0.09)).restart();
        setDraggingCityKey(null);
        scheduleFrame();
      });

    for (const node of nodesRef.current) {
      const element = nodeElementsRef.current.get(node.cityKey);
      if (!element) {
        continue;
      }
      select(element).datum(node).call(dragBehavior);
    }
  }, [sceneSignature, scheduleFrame, size.height, size.width]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      if (floatTimerRef.current) {
        clearInterval(floatTimerRef.current);
      }
      if (burstTimeoutRef.current) {
        window.clearTimeout(burstTimeoutRef.current);
      }
      simulationRef.current?.stop();
    },
    [],
  );

  const renderedNodes = useMemo(
    () => sortRenderNodes(nodesRef.current, selectedCityKey, hoveredCityKey, draggingCityKey),
    [draggingCityKey, hoveredCityKey, renderVersion, selectedCityKey],
  );

  const hoveredNode =
    (tooltipState ? renderedNodes.find((node) => node.cityKey === tooltipState.cityKey) : null) ??
    null;
  const tooltipPosition = tooltipState
    ? computeTooltipPosition(tooltipState.x, tooltipState.y, size.width, size.height)
    : null;
  const now = Date.now();

  const handleBoardClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (performance.now() < suppressClickUntilRef.current || !svgRef.current) {
      return;
    }

    const [x, y] = getPointer(event.nativeEvent, svgRef.current);
    triggerBurst(x, y, null);
  };

  const setNodeElementRef = (cityKey: string) => (node: SVGGElement | null) => {
    if (!node) {
      nodeElementsRef.current.delete(cityKey);
      return;
    }
    nodeElementsRef.current.set(cityKey, node);
  };

  return (
    <div ref={wrapperRef} className="physics-bubble-board">
      <svg
        ref={svgRef}
        className="physics-bubble-board__svg"
        viewBox={`0 0 ${Math.max(size.width, 1)} ${Math.max(size.height, 1)}`}
        preserveAspectRatio="none"
        onClick={handleBoardClick}
      >
        <defs>
          {renderedNodes.map((node) => {
            const flashRatio =
              node.row.flashActive && node.row.flashUntil
                ? clamp((Date.parse(node.row.flashUntil) - now) / BUBBLE_FLASH_WINDOW_MS, 0, 1)
                : 0;
            const palette = buildGlassPalette(node.row.colorSeed, flashRatio);
            return (
              <radialGradient
                id={`bubble-fill-${node.cityKey}`}
                key={node.cityKey}
                cx="30%"
                cy="28%"
                r="72%"
              >
                <stop offset="0%" stopColor={palette.fillA} />
                <stop offset="42%" stopColor={palette.fillB} />
                <stop offset="100%" stopColor={palette.fillC} />
              </radialGradient>
            );
          })}
          <radialGradient id="bubble-glare" cx="30%" cy="28%" r="72%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>

        <rect
          className="physics-bubble-board__backdrop"
          x="0"
          y="0"
          width={size.width}
          height={size.height}
          rx="30"
        />

        {burstState ? (
          <circle
            className="physics-bubble-board__burst"
            cx={burstState.x}
            cy={burstState.y}
            r={Math.min(burstState.radius * 0.58, 88)}
          />
        ) : null}

        {renderedNodes.map((node) => {
          const { row } = node;
          const isSelected = row.cityKey === selectedCityKey;
          const isHovered = row.cityKey === hoveredCityKey;
          const showLabel = labelCityKeys.has(row.cityKey);
          const ring = resolveRingColor(row.ringSeverity);
          const flashRatio =
            row.flashActive && row.flashUntil
              ? clamp((Date.parse(row.flashUntil) - now) / BUBBLE_FLASH_WINDOW_MS, 0, 1)
              : 0;
          const palette = buildGlassPalette(row.colorSeed, flashRatio);
          const x = node.x ?? node.homeX;
          const y = node.y ?? node.homeY;
          const labelSize = clamp(node.radius * 0.22, 11, 16);
          const secondarySize = clamp(node.radius * 0.13, 9, 12);
          const secondaryText = `${formatMarketCentsLabel(
            row.dominantYesPrice,
            undefined,
            language,
          )} · ${formatTemperatureBandLabel(row.dominantTemperatureBand, language)}`;

          return (
            <g
              key={row.cityKey}
              ref={setNodeElementRef(row.cityKey)}
              className={`physics-bubble${isSelected ? ' is-selected' : ''}${isHovered ? ' is-hovered' : ''}`}
              transform={`translate(${x}, ${y})`}
              onMouseEnter={(event) => {
                setHoveredCityKey(row.cityKey);
                updateTooltipFromEvent(event, row.cityKey);
              }}
              onMouseMove={(event) => updateTooltipFromEvent(event, row.cityKey)}
              onMouseLeave={() => {
                setHoveredCityKey((current) => (current === row.cityKey ? null : current));
                setTooltipState((current) => (current?.cityKey === row.cityKey ? null : current));
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (performance.now() < suppressClickUntilRef.current || !svgRef.current) {
                  return;
                }
                onSelectCity(row);
                const [localX, localY] = getPointer(event.nativeEvent, svgRef.current);
                triggerBurst(localX, localY, row.cityKey);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (performance.now() < suppressClickUntilRef.current) {
                  return;
                }
                onOpenDetails(row);
              }}
              tabIndex={0}
              role="button"
              aria-label={row.cityName}
              aria-pressed={isSelected}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onOpenDetails(row);
                }
                if (event.key === ' ') {
                  event.preventDefault();
                  onSelectCity(row);
                }
              }}
            >
              <circle
                className="physics-bubble__halo"
                r={node.radius + HALO_RADIUS_PADDING}
                fill={ring.halo}
                opacity={row.flashActive ? 0.7 : isHovered || isSelected ? 0.58 : 0.42}
              />
              <circle
                className="physics-bubble__body"
                r={node.radius}
                fill={`url(#bubble-fill-${row.cityKey})`}
                stroke={palette.edge}
                strokeWidth={isSelected ? 2.8 : isHovered ? 2.2 : 1.2}
                style={{
                  filter: `drop-shadow(0 14px 22px ${palette.shadow})`,
                }}
              />
              <circle
                className="physics-bubble__glare"
                r={node.radius * 0.64}
                cx={-node.radius * 0.18}
                cy={-node.radius * 0.22}
                fill="url(#bubble-glare)"
                opacity={0.32}
              />
              {flashRatio > 0.02 ? (
                <circle
                  className="physics-bubble__flash"
                  r={node.radius * 0.98}
                  fill={palette.flash}
                  opacity={0.3 + flashRatio * 0.45}
                />
              ) : null}
              <circle
                className="physics-bubble__ring"
                r={node.radius + 1.6}
                fill="none"
                stroke={ring.ring}
                strokeWidth={row.flashActive ? 2.4 : 1.6}
              />
              {isSelected ? (
                <circle
                  className="physics-bubble__selected-ring"
                  r={node.radius + 7}
                  fill="none"
                  stroke="rgba(248, 252, 255, 0.92)"
                  strokeWidth={2.3}
                />
              ) : null}
              {row.watchlisted ? (
                <g
                  className="physics-bubble__watch"
                  transform={`translate(${node.radius * 0.48}, ${-node.radius * 0.48})`}
                >
                  <title>{copy.watchlist}</title>
                  <circle
                    r={9}
                    fill="rgba(9, 15, 24, 0.78)"
                    stroke="rgba(255,255,255,0.18)"
                    strokeWidth={1}
                  />
                  <circle r={3.5} fill="rgba(255, 215, 122, 0.96)" />
                </g>
              ) : null}

              {showLabel ? (
                <g className="physics-bubble__label" pointerEvents="none">
                  <text
                    className="physics-bubble__label-primary"
                    y={row.dominantYesPrice !== null ? -4 : 2}
                    fontSize={labelSize}
                  >
                    {row.cityName}
                  </text>
                  {(isHovered || isSelected || node.radius >= 34) && (
                    <text
                      className="physics-bubble__label-secondary"
                      y={Math.min(node.radius * 0.28, 15)}
                      fontSize={secondarySize}
                    >
                      {secondaryText}
                    </text>
                  )}
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>

      {hoveredNode && tooltipState && tooltipPosition ? (
        <div
          className="physics-bubble-tooltip"
          style={{
            left: `${tooltipPosition.left}px`,
            top: `${tooltipPosition.top}px`,
          }}
        >
          <div className="physics-bubble-tooltip__head">
            <div>
              <strong>{hoveredNode.row.cityName}</strong>
              <span>
                {formatTemperatureBandLabel(hoveredNode.row.tooltipSnapshot.temperatureBand, language)}
              </span>
            </div>
            <span className={`severity severity--${hoveredNode.row.ringSeverity}`}>
              {resolveSeverityLabel(hoveredNode.row.ringSeverity, language)}
            </span>
          </div>

          <div className="physics-bubble-tooltip__grid">
            <span>
              {copy.yes}
              <strong>
                {formatMarketCentsLabel(hoveredNode.row.tooltipSnapshot.yesPrice, undefined, language)}
              </strong>
            </span>
            <span>
              {copy.alertFlash}
              <strong>{hoveredNode.row.flashActive ? copy.flashOn : copy.flashOff}</strong>
            </span>
            <span>
              {copy.bid}
              <strong>
                {formatMarketCentsLabel(hoveredNode.row.tooltipSnapshot.bestBid, undefined, language)}
              </strong>
            </span>
            <span>
              {copy.ask}
              <strong>
                {formatMarketCentsLabel(hoveredNode.row.tooltipSnapshot.bestAsk, undefined, language)}
              </strong>
            </span>
            <span>
              {copy.spread}
              <strong>
                {formatMarketCentsLabel(hoveredNode.row.tooltipSnapshot.spread, undefined, language)}
              </strong>
            </span>
            <span>
              {copy.change5m}
              <strong
                className={
                  hoveredNode.row.tooltipSnapshot.change5m >= 0 ? 'value-up' : 'value-down'
                }
              >
                {formatMarketPercent(hoveredNode.row.tooltipSnapshot.change5m)}
              </strong>
            </span>
          </div>

          <div className="physics-bubble-tooltip__footer">
            <span>
              {copy.rule}
              <strong>{hoveredNode.row.tooltipSnapshot.dominantRuleName ?? copy.noRule}</strong>
            </span>
            <span>
              {copy.updatedAt}
              <strong>
                {formatTooltipTime(hoveredNode.row.tooltipSnapshot.updatedAt, language)}
              </strong>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
};
