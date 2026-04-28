import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Matter from 'matter-js';

import { cn } from '../../lib/tailwind-utils';
import { useSettingsStore } from '../../store/useBubblePageSettingsStore';
import {
  buildBubblePhysicsSignature,
  type DashboardBubbleCityData,
  type PhysicsBubbleCityData,
} from '../../utils/dashboard-bubble-adapter';

interface BubbleChartProps {
  physicsData: PhysicsBubbleCityData[];
  visualData: DashboardBubbleCityData[];
  layoutKey: string;
  onOpenCity?: (city: { cityKey: string; eventDate: string }) => void;
}

interface BubbleBodyPlugin {
  cityId: string;
  visualRadius: number;
  collisionRadius: number;
  anchorX: number;
  anchorY: number;
  anchorVelocityX: number;
  anchorVelocityY: number;
  driftRangeX: number;
  driftRangeY: number;
  driftPhaseX: number;
  driftPhaseY: number;
  driftFreqX: number;
  driftFreqY: number;
  visualData?: DashboardBubbleCityData;
}

const generateTopographySVG = (seed: string) => {
  const hash = seed.split('').reduce((acc, item) => {
    const next = (acc << 5) - acc + item.charCodeAt(0);
    return next & next;
  }, 0);
  const type = Math.abs(hash) % 3;

  let paths = '';
  if (type === 0) {
    paths =
      '<path d="M10,50 Q30,20 50,50 T90,50 M20,60 Q40,30 60,60 T100,60 M0,40 Q20,10 40,40 T80,40" fill="none" stroke="currentColor" stroke-width="0.5" opacity="0.2"/>';
  } else if (type === 1) {
    paths =
      '<path d="M0,20 L100,20 M0,40 L100,40 M0,60 L100,60 M0,80 L100,80 M20,0 L20,100 M40,0 L40,100 M60,0 L60,100 M80,0 L80,100" fill="none" stroke="currentColor" stroke-width="0.5" opacity="0.15"/>';
  } else {
    paths =
      '<path d="M0,50 C20,30 30,70 50,50 C70,30 80,70 100,50 M0,60 C20,40 30,80 50,60 C70,40 80,80 100,60" fill="none" stroke="currentColor" stroke-width="0.5" opacity="0.2"/>';
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">${paths}</svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const hashString = (seed: string) =>
  seed.split('').reduce((acc, item) => {
    const next = (acc * 31 + item.charCodeAt(0)) | 0;
    return next;
  }, 0);

const seededUnit = (seed: string, salt: string) => {
  const hash = hashString(`${seed}:${salt}`);
  return (Math.abs(hash) % 10_000) / 10_000;
};

const seededBetween = (seed: string, salt: string, min: number, max: number) =>
  min + seededUnit(seed, salt) * (max - min);

const FILTER_MODE_LABELS = {
  ALL: '全部',
  ALERTS: '强告警',
} as const;

const REGION_LABELS = {
  ALL: '全部',
  NA: '北美',
  EU: '欧洲',
  ASIA: '亚洲',
  OTHER: '其他',
} as const;

const DASHBOARD_COPY = {
  newAlert: '刚触发',
  alertStrength: '告警强弱',
  riskLevel: '泡泡分数',
  alerts: '告警数量',
  temperatureBand: '温度区间',
  yesPrice: '“是”价格',
} as const;

const STRENGTH_LABELS: Record<DashboardBubbleCityData['status_level'], string> = {
  CRITICAL: '强',
  WARNING: '弱',
  NORMAL: '无告警',
};

type BubbleLayoutPlacement = {
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  anchorVelocityX: number;
  anchorVelocityY: number;
  driftRangeX: number;
  driftRangeY: number;
};

interface BubbleLayoutOptions {
  collisionPadding?: number;
  layoutKey?: string;
}

export const buildBubbleLayout = (
  rows: PhysicsBubbleCityData[],
  width: number,
  height: number,
  options: BubbleLayoutOptions = {},
): Map<string, BubbleLayoutPlacement> => {
  const layout = new Map<string, BubbleLayoutPlacement>();
  const safeRows = rows.filter((row) => Number.isFinite(row.visualRadius) && row.visualRadius > 0);
  if (safeRows.length === 0) {
    return layout;
  }

  const collisionPadding = Math.max(0, options.collisionPadding ?? 0);
  const maxRadius = safeRows.reduce(
    (current, row) => Math.max(current, row.visualRadius + collisionPadding),
    0,
  );
  const edgeInset = Math.max(maxRadius + 32, 86);
  const usableWidth = Math.max(width - edgeInset * 2, width * 0.42);
  const usableHeight = Math.max(height - edgeInset * 2, height * 0.42);
  const centerX = width / 2;
  const centerY = height / 2;
  const spreadRadius = Math.max(usableWidth, usableHeight, 1);
  const slotSeed = safeRows
    .map((row) => `${row.id}:${(row.visualRadius + collisionPadding).toFixed(2)}`)
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .join('|');
  const layoutSeed = `${options.layoutKey ?? ''}|${slotSeed}`;

  const orderedRows = [...safeRows].sort((left, right) => {
    const radiusDelta = right.visualRadius - left.visualRadius;
    if (radiusDelta !== 0) {
      return radiusDelta;
    }
    return left.id.localeCompare(right.id);
  });

  const placed: Array<{ id: string; x: number; y: number; radius: number }> = [];
  const attemptsPerBubble = Math.max(64, Math.min(140, safeRows.length * 5 + 48));
  const baseDriftX = Math.max(20, Math.min(54, usableWidth / Math.max(6, Math.sqrt(safeRows.length) * 2.1)));
  const baseDriftY = Math.max(18, Math.min(48, usableHeight / Math.max(6, Math.sqrt(safeRows.length) * 2.1)));

  const resolveCandidate = (row: PhysicsBubbleCityData, rowIndex: number) => {
    const collisionRadius = row.visualRadius + collisionPadding;
    const inset = collisionRadius + 18;
    const minX = inset;
    const maxX = Math.max(inset, width - inset);
    const minY = inset;
    const maxY = Math.max(inset, height - inset);

    let best: { x: number; y: number; score: number } | null = null;
    let bestNonOverlapping: { x: number; y: number; score: number } | null = null;

    for (let attemptIndex = 0; attemptIndex < attemptsPerBubble; attemptIndex += 1) {
      const key = `${layoutSeed}:${row.id}:${attemptIndex}`;
      const randomX = seededBetween(key, 'x', minX, maxX);
      const randomY = seededBetween(key, 'y', minY, maxY);
      const orbitAngle = seededBetween(key, 'angle', 0, Math.PI * 2);
      const orbitScale = Math.sqrt(seededBetween(key, 'orbit-scale', 0.04, 1));
      const orbitX = clamp(
        centerX + Math.cos(orbitAngle) * usableWidth * 0.48 * orbitScale,
        minX,
        maxX,
      );
      const orbitY = clamp(
        centerY + Math.sin(orbitAngle) * usableHeight * 0.48 * orbitScale,
        minY,
        maxY,
      );
      const orbitMix = rowIndex < 3 ? 0.42 : 0.22;
      const x = clamp(randomX * (1 - orbitMix) + orbitX * orbitMix, minX, maxX);
      const y = clamp(randomY * (1 - orbitMix) + orbitY * orbitMix, minY, maxY);

      let minClearance =
        placed.length === 0 ? Math.min(maxX - minX, maxY - minY) * 0.45 : Number.POSITIVE_INFINITY;
      for (const other of placed) {
        const requiredGap = collisionRadius + other.radius + 24;
        const distance = Math.hypot(x - other.x, y - other.y);
        minClearance = Math.min(minClearance, distance - requiredGap);
      }

      const edgeClearance = Math.min(x - minX, maxX - x, y - minY, maxY - y);
      const centerDistance = Math.hypot(x - centerX, y - centerY);
      const centerScore = 1 - Math.min(centerDistance / spreadRadius, 1);
      const sizeScore = row.visualRadius / Math.max(maxRadius, 1);
      const score =
        minClearance * 1.4 +
        edgeClearance * 0.18 +
        centerScore * 34 * sizeScore +
        seededBetween(key, 'score-noise', -6, 6);

      if (!best || score > best.score) {
        best = { x, y, score };
      }
      if (minClearance >= 0 && (!bestNonOverlapping || score > bestNonOverlapping.score)) {
        bestNonOverlapping = { x, y, score };
      }
    }

    return (
      bestNonOverlapping ??
      best ?? {
        x: clamp(centerX, minX, maxX),
        y: clamp(centerY, minY, maxY),
        score: 0,
      }
    );
  };

  for (let index = 0; index < orderedRows.length; index += 1) {
    const row = orderedRows[index];
    const candidate = resolveCandidate(row, index);
    const collisionRadius = row.visualRadius + collisionPadding;
    placed.push({
      id: row.id,
      x: candidate.x,
      y: candidate.y,
      radius: collisionRadius,
    });

    layout.set(row.id, {
      x: candidate.x,
      y: candidate.y,
      anchorX: candidate.x,
      anchorY: candidate.y,
      anchorVelocityX: seededBetween(row.id, 'anchor-vx', -0.18, 0.18),
      anchorVelocityY: seededBetween(row.id, 'anchor-vy', -0.15, 0.15),
      driftRangeX: Math.min(
        baseDriftX,
        Math.max(18, row.visualRadius * 0.58),
        Math.max(
          0,
          Math.min(
            candidate.x - (collisionRadius + 16),
            width - (collisionRadius + 16) - candidate.x,
          ),
        ),
      ),
      driftRangeY: Math.min(
        baseDriftY,
        Math.max(16, row.visualRadius * 0.5),
        Math.max(
          0,
          Math.min(
            candidate.y - (collisionRadius + 16),
            height - (collisionRadius + 16) - candidate.y,
          ),
        ),
      ),
    });
  }

  return layout;
};

const getBubblePlugin = (body: Matter.Body) => body.plugin as BubbleBodyPlugin;

const getCollisionPadding = (bubblePadding: number) =>
  Math.min(24, Math.max(0, bubblePadding) / 2);

const MAX_BODY_SPEED = 7.5;
const MAX_DRAG_BODY_SPEED = 9.5;
const DRAG_EFFECT_SETTLE_MS = 220;
const TOOLTIP_WIDTH = 292;
const TOOLTIP_HEIGHT = 216;
const TOOLTIP_EDGE_GAP = 14;
const TOOLTIP_TARGET_GAP = 18;

const limitBodyVelocity = (body: Matter.Body, maxSpeed: number) => {
  const speed = Math.hypot(body.velocity.x, body.velocity.y);
  if (!Number.isFinite(speed) || speed <= maxSpeed) {
    return;
  }

  const scale = maxSpeed / speed;
  Matter.Body.setVelocity(body, {
    x: body.velocity.x * scale,
    y: body.velocity.y * scale,
  });
};

const getRegionGlow = (region: DashboardBubbleCityData['region']) => {
  switch (region) {
    case 'NA':
      return 'rgba(245, 158, 11, 0.15)';
    case 'EU':
      return 'rgba(99, 102, 241, 0.15)';
    case 'ASIA':
      return 'rgba(20, 184, 166, 0.15)';
    default:
      return 'rgba(255, 255, 255, 0.05)';
  }
};

const getBubbleBorder = (
  city: DashboardBubbleCityData,
  colorScheme: ReturnType<typeof useSettingsStore.getState>['colorScheme'],
) => {
  if (colorScheme === 'heatmap') {
    if (city.status_level === 'CRITICAL') return '1px solid rgba(239, 68, 68, 0.72)';
    if (city.status_level === 'WARNING') return '1px solid rgba(245, 158, 11, 0.52)';
    return '1px solid rgba(255, 255, 255, 0.14)';
  }

  if (colorScheme === 'neon') {
    if (city.status_level === 'CRITICAL') return '1px solid rgba(255, 74, 145, 0.72)';
    if (city.status_level === 'WARNING') return '1px solid rgba(99, 241, 255, 0.58)';
    return '1px solid rgba(121, 214, 255, 0.18)';
  }

  if (city.status_level === 'CRITICAL') return '1px solid rgba(245, 158, 11, 0.6)';
  if (city.status_level === 'WARNING') return '1px solid rgba(245, 158, 11, 0.3)';
  return '1px solid rgba(255, 255, 255, 0.1)';
};

const getBubbleShadow = (
  city: DashboardBubbleCityData,
  colorScheme: ReturnType<typeof useSettingsStore.getState>['colorScheme'],
) => {
  if (colorScheme === 'neon') {
    if (city.status_level === 'CRITICAL') {
      return '0 0 22px rgba(255, 74, 145, 0.28), inset 0 0 12px rgba(255, 74, 145, 0.18)';
    }
    if (city.status_level === 'WARNING') {
      return '0 0 18px rgba(99, 241, 255, 0.22), inset 0 0 10px rgba(99, 241, 255, 0.12)';
    }
  }

  if (colorScheme === 'heatmap') {
    if (city.status_level === 'CRITICAL') {
      return '0 0 24px rgba(239, 68, 68, 0.28), inset 0 0 12px rgba(239, 68, 68, 0.2)';
    }
    if (city.status_level === 'WARNING') {
      return '0 0 18px rgba(245, 158, 11, 0.2), inset 0 0 10px rgba(245, 158, 11, 0.12)';
    }
  }

  if (city.status_level === 'CRITICAL') {
    return '0 0 20px rgba(245, 158, 11, 0.3), inset 0 0 10px rgba(245, 158, 11, 0.2)';
  }
  return 'none';
};

const getRiskTextColor = (city: DashboardBubbleCityData) => {
  if (city.status_level === 'CRITICAL') {
    return 'text-[#F59E0B]';
  }
  if (city.status_level === 'WARNING') {
    return 'text-[#FCD34D]';
  }
  return 'text-[#10B981]';
};

const getStrengthLabel = (city: DashboardBubbleCityData) => STRENGTH_LABELS[city.status_level];

type TooltipSide = 'top' | 'bottom';

const buildTooltipLayout = (
  point: { x: number; y: number },
  width: number,
  height: number,
): {
  side: TooltipSide;
  style: CSSProperties;
} => {
  const safeWidth = Math.max(width, TOOLTIP_WIDTH + TOOLTIP_EDGE_GAP * 2);
  const safeHeight = Math.max(height, TOOLTIP_HEIGHT + TOOLTIP_EDGE_GAP * 2);
  const tooltipWidth = Math.min(TOOLTIP_WIDTH, safeWidth - TOOLTIP_EDGE_GAP * 2);
  const tooltipHeight = Math.min(TOOLTIP_HEIGHT, safeHeight - TOOLTIP_EDGE_GAP * 2);
  const spaceAbove = point.y - TOOLTIP_EDGE_GAP - TOOLTIP_TARGET_GAP;
  const spaceBelow = safeHeight - point.y - TOOLTIP_EDGE_GAP - TOOLTIP_TARGET_GAP;
  const side: TooltipSide =
    spaceAbove >= tooltipHeight || spaceAbove >= spaceBelow ? 'top' : 'bottom';
  const left = clamp(
    point.x - tooltipWidth / 2,
    TOOLTIP_EDGE_GAP,
    Math.max(TOOLTIP_EDGE_GAP, safeWidth - tooltipWidth - TOOLTIP_EDGE_GAP),
  );
  const preferredTop =
    side === 'top'
      ? point.y - tooltipHeight - TOOLTIP_TARGET_GAP
      : point.y + TOOLTIP_TARGET_GAP;
  const top = clamp(
    preferredTop,
    TOOLTIP_EDGE_GAP,
    Math.max(TOOLTIP_EDGE_GAP, safeHeight - tooltipHeight - TOOLTIP_EDGE_GAP),
  );
  const arrowX = clamp(point.x - left, 18, tooltipWidth - 18);

  return {
    side,
    style: {
      left,
      top,
      width: tooltipWidth,
      maxHeight: tooltipHeight,
      '--bubble-tooltip-arrow-x': `${arrowX}px`,
    } as CSSProperties,
  };
};

export const BubbleChart = ({ physicsData, visualData, layoutKey, onOpenCity }: BubbleChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const renderRef = useRef<number | null>(null);
  const bodiesRef = useRef<Record<string, Matter.Body>>({});
  const domRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const mouseElementRef = useRef<HTMLDivElement | null>(null);
  const visualDataByIdRef = useRef(new Map<string, DashboardBubbleCityData>());
  const visiblePhysicsDataRef = useRef<PhysicsBubbleCityData[]>([]);
  const onOpenCityRef = useRef(onOpenCity);
  const floatSpeedRef = useRef(useSettingsStore.getState().floatSpeed);
  const dragSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipFrameRef = useRef<number | null>(null);
  const pendingTooltipPosRef = useRef<{ x: number; y: number } | null>(null);

  const [hoveredCityId, setHoveredCityId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const { floatSpeed, filterMode, regionFilter, bubblePadding, showLabels, colorScheme } =
    useSettingsStore();

  const visualDataById = useMemo(
    () => new Map(visualData.map((city) => [city.id, city])),
    [visualData],
  );

  const filteredVisualData = useMemo(
    () =>
      visualData.filter((city) => {
        if (filterMode === 'ALERTS' && !city.is_new_alert && city.status_level !== 'CRITICAL') {
          return false;
        }
        if (regionFilter !== 'ALL' && city.region !== regionFilter) {
          return false;
        }
        return true;
      }),
    [visualData, filterMode, regionFilter],
  );

  const filteredVisualIds = useMemo(
    () => new Set(filteredVisualData.map((city) => city.id)),
    [filteredVisualData],
  );

  const visiblePhysicsData = useMemo(
    () => physicsData.filter((city) => filteredVisualIds.has(city.id)),
    [filteredVisualIds, physicsData],
  );

  const visiblePhysicsDataById = useMemo(
    () => new Map(visiblePhysicsData.map((city) => [city.id, city])),
    [visiblePhysicsData],
  );

  const physicsSignature = useMemo(
    () =>
      buildBubblePhysicsSignature(visiblePhysicsData, {
        layoutKey,
        filterMode,
        regionFilter,
        bubblePadding,
      }),
    [bubblePadding, filterMode, layoutKey, regionFilter, visiblePhysicsData],
  );

  const hoveredCity = hoveredCityId ? visualDataById.get(hoveredCityId) ?? null : null;

  useEffect(() => {
    onOpenCityRef.current = onOpenCity;
  }, [onOpenCity]);

  useEffect(() => {
    floatSpeedRef.current = floatSpeed;
  }, [floatSpeed]);

  useEffect(() => {
    visualDataByIdRef.current = visualDataById;
  }, [visualDataById]);

  useEffect(() => {
    visiblePhysicsDataRef.current = visiblePhysicsData;
  }, [visiblePhysicsData]);

  useEffect(() => {
    if (hoveredCityId && !filteredVisualIds.has(hoveredCityId)) {
      setHoveredCityId(null);
    }
  }, [filteredVisualIds, hoveredCityId]);

  useLayoutEffect(() => {
    visiblePhysicsDataRef.current = visiblePhysicsData;

    if (!containerRef.current || visiblePhysicsData.length === 0) {
      bodiesRef.current = {};
      return;
    }

    const container = containerRef.current;
    let currentWidth = Math.max(container.clientWidth, 1);
    let currentHeight = Math.max(container.clientHeight, 1);

    const engine = Matter.Engine.create({
      gravity: { x: 0, y: 0, scale: 0 },
      enableSleeping: false,
    });

    engine.positionIterations = 8;
    engine.velocityIterations = 6;
    engine.constraintIterations = 2;
    engineRef.current = engine;

    const world = engine.world;
    const wallThickness = 100;
    const wallOptions = {
      isStatic: true,
      render: { visible: false },
      friction: 0.02,
      restitution: 0.02,
    };
    let horizontalWallWidth = currentWidth * 3;
    let verticalWallHeight = currentHeight * 3;

    const walls = [
      Matter.Bodies.rectangle(
        currentWidth / 2,
        -wallThickness / 2,
        horizontalWallWidth,
        wallThickness,
        wallOptions,
      ),
      Matter.Bodies.rectangle(
        currentWidth / 2,
        currentHeight + wallThickness / 2,
        horizontalWallWidth,
        wallThickness,
        wallOptions,
      ),
      Matter.Bodies.rectangle(
        -wallThickness / 2,
        currentHeight / 2,
        wallThickness,
        verticalWallHeight,
        wallOptions,
      ),
      Matter.Bodies.rectangle(
        currentWidth + wallThickness / 2,
        currentHeight / 2,
        wallThickness,
        verticalWallHeight,
        wallOptions,
      ),
    ];
    Matter.World.add(world, walls);

    const newBodies: Record<string, Matter.Body> = {};
    const collisionPadding = getCollisionPadding(bubblePadding);
    const applyLayout = (nextWidth: number, nextHeight: number, repositionBodies: boolean) => {
      const nextLayout = buildBubbleLayout(visiblePhysicsDataRef.current, nextWidth, nextHeight, {
        collisionPadding,
        layoutKey,
      });

      for (const city of visiblePhysicsDataRef.current) {
        const placement = nextLayout.get(city.id);
        const body = bodiesRef.current[city.id];
        if (!placement || !body) {
          continue;
        }

        const plugin = getBubblePlugin(body);
        plugin.anchorX = placement.anchorX;
        plugin.anchorY = placement.anchorY;
        plugin.anchorVelocityX = placement.anchorVelocityX;
        plugin.anchorVelocityY = placement.anchorVelocityY;
        plugin.driftRangeX = placement.driftRangeX;
        plugin.driftRangeY = placement.driftRangeY;

        if (!repositionBodies) {
          continue;
        }

        Matter.Body.setPosition(body, {
          x: placement.x,
          y: placement.y,
        });
        Matter.Body.setVelocity(body, { x: 0, y: 0 });
      }
    };
    const layout = buildBubbleLayout(visiblePhysicsData, currentWidth, currentHeight, {
      collisionPadding,
      layoutKey,
    });

    for (const city of visiblePhysicsData) {
      const placement = layout.get(city.id);
      if (!placement) {
        continue;
      }
      const collisionRadius = city.visualRadius + collisionPadding;

      const body = Matter.Bodies.circle(placement.x, placement.y, collisionRadius, {
        restitution: 0.08,
        friction: 0.02,
        frictionAir: 0.08,
        density: 0.0016 * (city.visualRadius / 50),
        slop: 0.04,
      });

      body.plugin = {
        cityId: city.id,
        visualRadius: city.visualRadius,
        collisionRadius,
        anchorX: placement.anchorX,
        anchorY: placement.anchorY,
        anchorVelocityX: placement.anchorVelocityX,
        anchorVelocityY: placement.anchorVelocityY,
        driftRangeX: placement.driftRangeX,
        driftRangeY: placement.driftRangeY,
        driftPhaseX: seededBetween(city.id, 'phase-x', 0, Math.PI * 2),
        driftPhaseY: seededBetween(city.id, 'phase-y', 0, Math.PI * 2),
        driftFreqX: seededBetween(city.id, 'freq-x', 0.00022, 0.00038),
        driftFreqY: seededBetween(city.id, 'freq-y', 0.00018, 0.00034),
        visualData: visualDataByIdRef.current.get(city.id),
      } satisfies BubbleBodyPlugin;

      Matter.Body.setVelocity(body, {
        x: seededBetween(city.id, 'vx', -0.18, 0.18),
        y: seededBetween(city.id, 'vy', -0.14, 0.14),
      });

      newBodies[city.id] = body;
    }

    bodiesRef.current = newBodies;
    Matter.World.add(world, Object.values(newBodies));

    // Write the first stable transform before paint so the chart does not flash from (0, 0).
    for (const body of Object.values(newBodies)) {
      const plugin = getBubblePlugin(body);
      const element = domRefs.current[plugin.cityId];
      if (!element) {
        continue;
      }

      element.style.transform = `translate3d(${body.position.x - plugin.visualRadius}px, ${
        body.position.y - plugin.visualRadius
      }px, 0)`;
    }

    const mouseElement = document.createElement('div');
    mouseElement.style.position = 'absolute';
    mouseElement.style.inset = '0';
    mouseElement.style.zIndex = '10';
    container.appendChild(mouseElement);
    mouseElementRef.current = mouseElement;

    const mouse = Matter.Mouse.create(mouseElement);
    const mouseConstraint = Matter.MouseConstraint.create(engine, {
      mouse,
      constraint: { stiffness: 0.18, render: { visible: false } },
    });
    Matter.World.add(world, mouseConstraint);

    const getPointedCityId = (position: Matter.Vector) => {
      const activeBodies = Object.values(bodiesRef.current);
      const pointedBodies = Matter.Query.point(activeBodies, position);
      if (pointedBodies.length === 0) {
        return null;
      }

      return getBubblePlugin(pointedBodies[0]).cityId;
    };

    let currentHoveredId: string | null = null;
    let draggingBodyId: number | null = null;

    const scheduleTooltipPosition = (position: { x: number; y: number }) => {
      pendingTooltipPosRef.current = position;
      if (tooltipFrameRef.current !== null) {
        return;
      }

      tooltipFrameRef.current = requestAnimationFrame(() => {
        tooltipFrameRef.current = null;
        const nextPosition = pendingTooltipPosRef.current;
        if (nextPosition) {
          setTooltipPos(nextPosition);
        }
      });
    };

    const setDraggingVisualMode = (dragging: boolean) => {
      if (dragSettleTimerRef.current) {
        clearTimeout(dragSettleTimerRef.current);
        dragSettleTimerRef.current = null;
      }

      if (dragging) {
        container.classList.add('bubble-chart--dragging');
        return;
      }

      dragSettleTimerRef.current = setTimeout(() => {
        container.classList.remove('bubble-chart--dragging');
        dragSettleTimerRef.current = null;
      }, DRAG_EFFECT_SETTLE_MS);
    };

    Matter.Events.on(mouseConstraint, 'mousemove', (event) => {
      if (draggingBodyId !== null || mouseConstraint.body) {
        if (currentHoveredId !== null) {
          currentHoveredId = null;
          setHoveredCityId(null);
        }
        mouseElement.style.cursor = 'grabbing';
        return;
      }

      const cityId = getPointedCityId(event.mouse.position);
      if (cityId) {
        if (currentHoveredId !== cityId) {
          currentHoveredId = cityId;
          setHoveredCityId(cityId);
          mouseElement.style.cursor = 'grab';
        }
        scheduleTooltipPosition({ x: event.mouse.position.x, y: event.mouse.position.y });
      } else if (currentHoveredId !== null) {
        currentHoveredId = null;
        setHoveredCityId(null);
        mouseElement.style.cursor = 'default';
      }
    });

    const handleDoubleClick = () => {
      const cityId = getPointedCityId(mouse.position);
      if (!cityId) {
        return;
      }

      const city = visualDataByIdRef.current.get(cityId);
      if (city) {
        onOpenCityRef.current?.({ cityKey: city.cityKey, eventDate: city.eventDate });
      }
    };

    mouseElement.addEventListener('dblclick', handleDoubleClick);

    Matter.Events.on(mouseConstraint, 'startdrag', (event) => {
      const dragEvent = event as Matter.IEvent<Matter.MouseConstraint> & { body?: Matter.Body };
      mouseElement.style.cursor = 'grabbing';
      setHoveredCityId(null);
      if (dragEvent.body) {
        currentHoveredId = null;
        draggingBodyId = dragEvent.body.id;
        setDraggingVisualMode(true);
        Matter.Sleeping.set(dragEvent.body, false);
      }
    });

    Matter.Events.on(mouseConstraint, 'enddrag', (event) => {
      const dragEvent = event as Matter.IEvent<Matter.MouseConstraint> & { body?: Matter.Body };
      mouseElement.style.cursor = 'grab';
      if (!dragEvent.body) {
        draggingBodyId = null;
        setDraggingVisualMode(false);
        return;
      }

      limitBodyVelocity(dragEvent.body, MAX_DRAG_BODY_SPEED);
      const plugin = getBubblePlugin(dragEvent.body);
      const inset = plugin.collisionRadius + 16;
      plugin.anchorX = clamp(
        dragEvent.body.position.x + dragEvent.body.velocity.x * 18,
        inset,
        Math.max(inset, currentWidth - inset),
      );
      plugin.anchorY = clamp(
        dragEvent.body.position.y + dragEvent.body.velocity.y * 18,
        inset,
        Math.max(inset, currentHeight - inset),
      );
      plugin.anchorVelocityX = clamp(
        plugin.anchorVelocityX * 0.25 + dragEvent.body.velocity.x * 0.035,
        -0.22,
        0.22,
      );
      plugin.anchorVelocityY = clamp(
        plugin.anchorVelocityY * 0.25 + dragEvent.body.velocity.y * 0.035,
        -0.18,
        0.18,
      );
      Matter.Body.setVelocity(dragEvent.body, {
        x: dragEvent.body.velocity.x * 0.42,
        y: dragEvent.body.velocity.y * 0.42,
      });
      limitBodyVelocity(dragEvent.body, MAX_BODY_SPEED);
      draggingBodyId = null;
      setDraggingVisualMode(false);
    });

    Matter.Events.on(engine, 'beforeUpdate', () => {
      const timestamp = engine.timing.timestamp;
      const driftForce = 0.00000018 * Math.max(floatSpeedRef.current, 0);
      const springStrength = 0.0000021;
      const deltaFactor = Math.max(0.6, (engine.timing.lastDelta || 16.666) / 16.666);
      const anchorSpeedScale = 0.7 + floatSpeedRef.current * 0.9;

      for (const body of Object.values(bodiesRef.current)) {
        const plugin = getBubblePlugin(body);
        const isDragging = mouseConstraint.body?.id === body.id;
        limitBodyVelocity(body, isDragging ? MAX_DRAG_BODY_SPEED : MAX_BODY_SPEED);

        const inset = plugin.collisionRadius + 16;
        plugin.anchorX += plugin.anchorVelocityX * deltaFactor * anchorSpeedScale;
        plugin.anchorY += plugin.anchorVelocityY * deltaFactor * anchorSpeedScale;

        if (plugin.anchorX < inset || plugin.anchorX > currentWidth - inset) {
          plugin.anchorVelocityX *= -1;
          plugin.anchorX = clamp(plugin.anchorX, inset, Math.max(inset, currentWidth - inset));
        }
        if (plugin.anchorY < inset || plugin.anchorY > currentHeight - inset) {
          plugin.anchorVelocityY *= -1;
          plugin.anchorY = clamp(plugin.anchorY, inset, Math.max(inset, currentHeight - inset));
        }

        const targetX = clamp(
          plugin.anchorX +
            Math.sin(timestamp * plugin.driftFreqX + plugin.driftPhaseX) * plugin.driftRangeX,
          inset,
          Math.max(inset, currentWidth - inset),
        );
        const targetY = clamp(
          plugin.anchorY +
            Math.cos(timestamp * plugin.driftFreqY + plugin.driftPhaseY) * plugin.driftRangeY,
          inset,
          Math.max(inset, currentHeight - inset),
        );
        const dx = targetX - body.position.x;
        const dy = targetY - body.position.y;

        if (!isDragging) {
          Matter.Body.applyForce(body, body.position, {
            x: dx * springStrength * body.mass,
            y: dy * springStrength * body.mass,
          });
        }

        if (isDragging || driftForce <= 0) {
          continue;
        }

        Matter.Body.applyForce(body, body.position, {
          x: Math.sin(timestamp * plugin.driftFreqX + plugin.driftPhaseX) * driftForce * body.mass,
          y: Math.cos(timestamp * plugin.driftFreqY + plugin.driftPhaseY) * driftForce * body.mass,
        });
        limitBodyVelocity(body, MAX_BODY_SPEED);
      }
    });

    const render = () => {
      Matter.Engine.update(engine, 1000 / 60);

      for (const body of Object.values(bodiesRef.current)) {
        const plugin = getBubblePlugin(body);
        const element = domRefs.current[plugin.cityId];
        if (!element) {
          continue;
        }

        const { x, y } = body.position;
        element.style.transform = `translate3d(${x - plugin.visualRadius}px, ${y - plugin.visualRadius}px, 0)`;
      }

      renderRef.current = requestAnimationFrame(render);
    };

    render();

    const handleResize = () => {
      if (!containerRef.current) {
        return;
      }

      const nextWidth = Math.max(containerRef.current.clientWidth, 1);
      const nextHeight = Math.max(containerRef.current.clientHeight, 1);
      const previousWidth = currentWidth;
      const previousHeight = currentHeight;
      currentWidth = nextWidth;
      currentHeight = nextHeight;

      const nextHorizontalWallWidth = nextWidth * 3;
      if (Math.abs(nextHorizontalWallWidth - horizontalWallWidth) > 0.5) {
        const scaleX = nextHorizontalWallWidth / Math.max(horizontalWallWidth, 1);
        Matter.Body.scale(walls[0], scaleX, 1);
        Matter.Body.scale(walls[1], scaleX, 1);
        horizontalWallWidth = nextHorizontalWallWidth;
      }

      const nextVerticalWallHeight = nextHeight * 3;
      if (Math.abs(nextVerticalWallHeight - verticalWallHeight) > 0.5) {
        const scaleY = nextVerticalWallHeight / Math.max(verticalWallHeight, 1);
        Matter.Body.scale(walls[2], 1, scaleY);
        Matter.Body.scale(walls[3], 1, scaleY);
        verticalWallHeight = nextVerticalWallHeight;
      }

      Matter.Body.setPosition(walls[0], { x: nextWidth / 2, y: -wallThickness / 2 });
      Matter.Body.setPosition(walls[1], {
        x: nextWidth / 2,
        y: nextHeight + wallThickness / 2,
      });
      Matter.Body.setPosition(walls[2], { x: -wallThickness / 2, y: nextHeight / 2 });
      Matter.Body.setPosition(walls[3], {
        x: nextWidth + wallThickness / 2,
        y: nextHeight / 2,
      });

      const shouldRelayout =
        previousWidth <= 1 ||
        previousHeight <= 1 ||
        Math.abs(nextWidth - previousWidth) > 32 ||
        Math.abs(nextHeight - previousHeight) > 32;
      applyLayout(nextWidth, nextHeight, shouldRelayout);

      for (const body of Object.values(bodiesRef.current)) {
        const plugin = getBubblePlugin(body);
        const inset = plugin.collisionRadius + 16;
        plugin.anchorX = clamp(plugin.anchorX, inset, Math.max(inset, nextWidth - inset));
        plugin.anchorY = clamp(plugin.anchorY, inset, Math.max(inset, nextHeight - inset));

        if (
          body.position.x < inset ||
          body.position.x > nextWidth - inset ||
          body.position.y < inset ||
          body.position.y > nextHeight - inset
        ) {
          Matter.Body.setPosition(body, {
            x: clamp(body.position.x, inset, Math.max(inset, nextWidth - inset)),
            y: clamp(body.position.y, inset, Math.max(inset, nextHeight - inset)),
          });
          Matter.Body.setVelocity(body, { x: 0, y: 0 });
        }
      }
    };

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(container);
    } else {
      window.addEventListener('resize', handleResize);
    }
    handleResize();

    return () => {
      resizeObserver?.disconnect();
      if (!resizeObserver) {
        window.removeEventListener('resize', handleResize);
      }
      mouseElement.removeEventListener('dblclick', handleDoubleClick);
      setHoveredCityId(null);
      if (renderRef.current) {
        cancelAnimationFrame(renderRef.current);
        renderRef.current = null;
      }
      if (dragSettleTimerRef.current) {
        clearTimeout(dragSettleTimerRef.current);
        dragSettleTimerRef.current = null;
      }
      if (tooltipFrameRef.current !== null) {
        cancelAnimationFrame(tooltipFrameRef.current);
        tooltipFrameRef.current = null;
      }
      pendingTooltipPosRef.current = null;
      container.classList.remove('bubble-chart--dragging');
      Matter.World.clear(world, false);
      Matter.Engine.clear(engine);
      bodiesRef.current = {};
      engineRef.current = null;
      if (container.contains(mouseElement)) {
        container.removeChild(mouseElement);
      }
      mouseElementRef.current = null;
    };
  }, [physicsSignature]);

  useEffect(() => {
    for (const body of Object.values(bodiesRef.current)) {
      const plugin = getBubblePlugin(body);
      const physicsCity = visiblePhysicsDataById.get(plugin.cityId);
      plugin.visualData = visualDataById.get(plugin.cityId);

      const nextVisualRadius = physicsCity?.visualRadius ?? plugin.visualRadius;
      const nextCollisionRadius = nextVisualRadius + getCollisionPadding(bubblePadding);
      if (Math.abs(nextCollisionRadius - plugin.collisionRadius) > 0.05) {
        const scale = nextCollisionRadius / plugin.collisionRadius;
        Matter.Body.scale(body, scale, scale);
        plugin.collisionRadius = nextCollisionRadius;
        plugin.visualRadius = nextVisualRadius;
      }
    }
  }, [bubblePadding, visiblePhysicsDataById, visualDataById]);

  const tooltipLayout = hoveredCity
    ? buildTooltipLayout(
        tooltipPos,
        containerRef.current?.clientWidth ?? TOOLTIP_WIDTH + TOOLTIP_EDGE_GAP * 2,
        containerRef.current?.clientHeight ?? TOOLTIP_HEIGHT + TOOLTIP_EDGE_GAP * 2,
      )
    : null;

  return (
    <div
      className="bubble-chart relative h-full w-full overflow-hidden bg-[#0D0F14]"
      ref={containerRef}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.3) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="absolute right-4 top-4 z-20 flex gap-2">
        <div className="flex rounded-md border border-[#2D2D3A] bg-[#16161E]/80 p-1 font-mono text-xs backdrop-blur-md">
          <button
            onClick={() => useSettingsStore.getState().setFilterMode('ALL')}
            className={cn(
              'rounded px-3 py-1 transition-colors',
              filterMode === 'ALL' ? 'bg-[#2D2D3A] text-white' : 'text-[#71717A] hover:text-white',
            )}
          >
            {FILTER_MODE_LABELS.ALL}
          </button>
          <button
            onClick={() => useSettingsStore.getState().setFilterMode('ALERTS')}
            className={cn(
              'rounded px-3 py-1 transition-colors',
              filterMode === 'ALERTS'
                ? 'bg-[#EF4444]/20 text-[#EF4444]'
                : 'text-[#71717A] hover:text-white',
            )}
          >
            {FILTER_MODE_LABELS.ALERTS}
          </button>
        </div>
        <div className="flex rounded-md border border-[#2D2D3A] bg-[#16161E]/80 p-1 font-mono text-xs backdrop-blur-md">
          {(['ALL', 'NA', 'EU', 'ASIA', 'OTHER'] as const).map((region) => (
            <button
              key={region}
              onClick={() => useSettingsStore.getState().setRegionFilter(region)}
              className={cn(
                'rounded px-3 py-1 transition-colors',
                regionFilter === region ? 'bg-[#2D2D3A] text-white' : 'text-[#71717A] hover:text-white',
              )}
            >
              {REGION_LABELS[region]}
            </button>
          ))}
        </div>
      </div>

      {visiblePhysicsData.map((city) => {
        const visual = visualDataById.get(city.id);
        if (!visual) {
          return null;
        }

        const size = city.visualRadius * 2;

        return (
          <div
            key={city.id}
            ref={(element) => {
              domRefs.current[city.id] = element;
            }}
            className="bubble-chart__bubble absolute left-0 top-0 flex rounded-full transition-opacity duration-500"
            style={{
              width: size,
              height: size,
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              background: `radial-gradient(circle at 50% 50%, ${getRegionGlow(visual.region)}, rgba(255,255,255,0.02)), ${generateTopographySVG(visual.code)}`,
              backgroundSize: '100% 100%, 150% 150%',
              backgroundPosition: 'center, center',
              border: getBubbleBorder(visual, colorScheme),
              boxShadow: getBubbleShadow(visual, colorScheme),
              willChange: 'transform',
            }}
          >
            {visual.is_new_alert ? (
              <div
                className="pointer-events-none absolute inset-0 animate-radar-sweep rounded-full"
                style={{
                  background:
                    'conic-gradient(from 0deg, transparent 70%, rgba(245, 158, 11, 0.8) 100%)',
                  maskImage:
                    'radial-gradient(closest-side, transparent calc(100% - 2px), black calc(100% - 2px))',
                  WebkitMaskImage:
                    'radial-gradient(closest-side, transparent calc(100% - 2px), black calc(100% - 2px))',
                }}
              />
            ) : null}

            {visual.is_new_alert ? (
              <div className="absolute right-[10%] top-[10%] h-3 w-3 rounded-full border-2 border-[#0D0F14] bg-[#EF4444] shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
            ) : null}

            {showLabels ? (
              <div className="pointer-events-none relative z-10 flex flex-col items-center justify-center">
                <span
                  className="font-sans font-bold leading-none text-white"
                  style={{ fontSize: Math.max(16, city.visualRadius * 0.45) }}
                >
                  {visual.temperature}°
                </span>

                <span
                  className="mt-1 font-sans font-normal tracking-[0.04em] text-[#808080]"
                  style={{ fontSize: Math.max(8, city.visualRadius * 0.15) }}
                >
                  {visual.name}
                </span>
              </div>
            ) : (
              <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.14),transparent_28%)]" />
            )}
          </div>
        );
      })}

      {hoveredCity && tooltipLayout ? (
        <div
          className={`bubble-tooltip bubble-tooltip--${tooltipLayout.side} pointer-events-none absolute z-50 rounded border border-[#2D2D3A] bg-[#16161E]/95 p-4 text-[#E4E4E7] shadow-2xl backdrop-blur-md`}
          style={tooltipLayout.style}
        >
          <div className="bubble-tooltip__arrow" />

          <div className="relative z-10">
            <div className="mb-2 flex items-center justify-between gap-4">
              <h3 className="text-[14px] font-bold">{hoveredCity.name}</h3>
              {hoveredCity.is_new_alert ? (
                <span className="rounded-full border border-[#EF4444]/30 bg-[#EF4444]/20 px-2 py-0.5 text-[9px] font-bold text-[#EF4444]">
                  {DASHBOARD_COPY.newAlert}
                </span>
              ) : null}
            </div>

            <div className="space-y-2 font-mono text-[11px] opacity-80">
              <div className="flex justify-between">
                <span className="text-[#71717A]">{DASHBOARD_COPY.alertStrength}:</span>
                <span className={cn('font-bold', getRiskTextColor(hoveredCity))}>
                  {getStrengthLabel(hoveredCity)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#71717A]">{DASHBOARD_COPY.riskLevel}:</span>
                <span className={cn('font-bold', getRiskTextColor(hoveredCity))}>
                  {hoveredCity.riskLevel}/100
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#71717A]">{DASHBOARD_COPY.alerts}:</span>
                <span className="text-white">{hoveredCity.alertCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#71717A]">{DASHBOARD_COPY.temperatureBand}:</span>
                <span className="text-white">{hoveredCity.dominantTemperatureBand}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#71717A]">{DASHBOARD_COPY.yesPrice}:</span>
                <span className="text-white">
                  {hoveredCity.dominantYesPrice === null
                    ? '--'
                    : `${Math.round(hoveredCity.dominantYesPrice * 100)} 美分`}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
