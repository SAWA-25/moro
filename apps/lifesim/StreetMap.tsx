import React, { useMemo } from 'react';
import {
    ChatsCircle,
    Crosshair,
    HeartHalf,
    MapPin,
    Sparkle,
    Storefront,
    UsersThree,
} from '@phosphor-icons/react';

export type MapLayerMode = 'info' | 'relations' | 'routes';

export type MapNodeKind =
    | 'user'
    | 'family'
    | 'person'
    | 'shop'
    | 'event'
    | 'date'
    | 'worldline'
    | 'place';

export interface MapNode {
    id: string;
    kind: MapNodeKind;
    label: string;
    sublabel?: string;
    x: number;
    y: number;
    emoji?: string;
    avatar?: string;
    color?: string;
    badge?: string;
    active?: boolean;
    muted?: boolean;
}

export interface MapPoint {
    x: number;
    y: number;
}

export interface MapRoute {
    id: string;
    from: MapPoint;
    to: MapPoint;
    label?: string;
    color?: string;
    dashed?: boolean;
    width?: number;
}

interface StreetMapProps {
    nodes: MapNode[];
    routes?: MapRoute[];
    layer?: MapLayerMode;
    selectedNodeId?: string | null;
    user?: MapNode | null;
    height?: number | string;
    title?: string;
    subtitle?: string;
    className?: string;
    topLeft?: React.ReactNode;
    topRight?: React.ReactNode;
    bottomLeft?: React.ReactNode;
    bottomCenter?: React.ReactNode;
    onCanvasClick?: (point: MapPoint, event: React.MouseEvent<HTMLDivElement>) => void;
    onNodeClick?: (node: MapNode, event: React.MouseEvent<HTMLButtonElement>) => void;
}

const clampPct = (value: number) => Math.max(4, Math.min(96, value));
const safePoint = (point: MapPoint): MapPoint => ({ x: clampPct(point.x), y: clampPct(point.y) });

export function mapDistanceLabel(from: MapPoint, to: MapPoint): string {
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    const meters = Math.max(80, Math.round(Math.sqrt(dx * dx + dy * dy) * 58));
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`;
}

function nodeAccent(node: MapNode): string {
    if (node.color) return node.color;
    switch (node.kind) {
        case 'user': return '#2563eb';
        case 'family': return '#475569';
        case 'person': return '#dc3f6b';
        case 'shop': return '#0f8a6b';
        case 'event': return '#d97706';
        case 'date': return '#c026d3';
        case 'worldline': return '#7c3aed';
        default: return '#334155';
    }
}

function NodeGlyph({ node }: { node: MapNode }) {
    if (node.avatar) {
        return <img src={node.avatar} alt="" className="street-map-avatar" draggable={false} />;
    }
    if (node.emoji) {
        return <span className="street-map-emoji">{node.emoji}</span>;
    }
    const iconProps = { size: 15, weight: 'bold' as const };
    switch (node.kind) {
        case 'family': return <UsersThree {...iconProps} />;
        case 'shop': return <Storefront {...iconProps} />;
        case 'event': return <Sparkle {...iconProps} weight="fill" />;
        case 'date': return <HeartHalf {...iconProps} />;
        case 'worldline': return <ChatsCircle {...iconProps} />;
        case 'user': return <Crosshair {...iconProps} />;
        default: return <MapPin {...iconProps} weight="fill" />;
    }
}

function StreetMapNode({
    node,
    selected,
    onNodeClick,
}: {
    node: MapNode;
    selected: boolean;
    onNodeClick?: (node: MapNode, event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
    const point = safePoint(node);
    const accent = nodeAccent(node);
    const showCard = selected || node.kind === 'family' || node.kind === 'shop' || node.kind === 'date' || node.kind === 'worldline';

    return (
        <button
            type="button"
            title={[node.label, node.sublabel].filter(Boolean).join(' · ')}
            onClick={(event) => onNodeClick?.(node, event)}
            className={`street-map-node ${selected ? 'is-selected' : ''} ${node.active ? 'is-active' : ''} ${node.muted ? 'is-muted' : ''}`}
            style={{
                left: `${point.x}%`,
                top: `${point.y}%`,
                ['--node-accent' as string]: accent,
            }}
        >
            <span className="street-map-pin">
                <NodeGlyph node={node} />
            </span>
            {showCard && (
                <span className="street-map-label">
                    <span className="street-map-label-title">{node.label}</span>
                    {node.sublabel && <span className="street-map-label-sub">{node.sublabel}</span>}
                </span>
            )}
            {node.badge && <span className="street-map-badge">{node.badge}</span>}
        </button>
    );
}

const DISTRICTS = [
    { left: '5%', top: '9%', width: '26%', height: '19%', color: 'rgba(126, 192, 152, 0.22)', radius: 24 },
    { left: '68%', top: '8%', width: '25%', height: '24%', color: 'rgba(226, 232, 240, 0.58)', radius: 20 },
    { left: '8%', top: '65%', width: '28%', height: '24%', color: 'rgba(125, 190, 224, 0.24)', radius: 26 },
    { left: '58%', top: '62%', width: '33%', height: '22%', color: 'rgba(126, 192, 152, 0.18)', radius: 22 },
    { left: '36%', top: '36%', width: '22%', height: '18%', color: 'rgba(255, 255, 255, 0.64)', radius: 18 },
];

const ROAD_PATHS = [
    'M 4 34 C 17 31, 26 35, 39 31 S 65 22, 96 25',
    'M 12 86 C 23 73, 36 70, 51 59 S 75 50, 92 36',
    'M 42 4 C 45 20, 43 35, 48 48 S 54 72, 51 96',
    'M 3 58 C 25 54, 40 55, 58 57 S 80 65, 98 61',
    'M 22 6 C 28 23, 29 44, 24 59 S 18 78, 25 95',
];

const MINOR_ROADS = [
    'M 12 15 L 89 88',
    'M 8 75 L 92 12',
    'M 63 3 L 68 94',
    'M 2 46 L 97 42',
];

const StreetMap: React.FC<StreetMapProps> = ({
    nodes,
    routes = [],
    layer = 'info',
    selectedNodeId,
    user,
    height = 380,
    title,
    subtitle,
    className = '',
    topLeft,
    topRight,
    bottomLeft,
    bottomCenter,
    onCanvasClick,
    onNodeClick,
}) => {
    const allNodes = useMemo(() => {
        const list = user ? [user, ...nodes.filter(node => node.id !== user.id)] : nodes;
        return list.map(node => ({ ...node, x: clampPct(node.x), y: clampPct(node.y) }));
    }, [nodes, user]);

    const routeLabels = routes.filter(route => route.label);

    const handleCanvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!onCanvasClick) return;
        const box = event.currentTarget.getBoundingClientRect();
        const point = {
            x: clampPct(((event.clientX - box.left) / box.width) * 100),
            y: clampPct(((event.clientY - box.top) / box.height) * 100),
        };
        onCanvasClick(point, event);
    };

    return (
        <div className={`street-map ${className}`} style={{ height }}>
            <style>{streetMapCss}</style>
            <div className="street-map-canvas" onClick={handleCanvasClick}>
                {DISTRICTS.map((district, index) => (
                    <span
                        key={index}
                        className="street-map-district"
                        style={{
                            left: district.left,
                            top: district.top,
                            width: district.width,
                            height: district.height,
                            background: district.color,
                            borderRadius: district.radius,
                        }}
                    />
                ))}

                <svg className="street-map-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    {ROAD_PATHS.map((path, index) => (
                        <path key={`road-shadow-${index}`} d={path} className="street-map-road-shadow" />
                    ))}
                    {ROAD_PATHS.map((path, index) => (
                        <path key={`road-${index}`} d={path} className="street-map-road" />
                    ))}
                    {MINOR_ROADS.map((path, index) => (
                        <path key={`minor-${index}`} d={path} className="street-map-road-minor" />
                    ))}
                    {routes.map(route => {
                        const from = safePoint(route.from);
                        const to = safePoint(route.to);
                        const color = route.color || (layer === 'relations' ? '#7c3aed' : '#2563eb');
                        return (
                            <line
                                key={route.id}
                                x1={from.x}
                                y1={from.y}
                                x2={to.x}
                                y2={to.y}
                                stroke={color}
                                strokeWidth={route.width ?? (layer === 'relations' ? 0.8 : 1.1)}
                                strokeDasharray={route.dashed ?? true ? '3 2.5' : undefined}
                                strokeLinecap="round"
                                opacity={layer === 'relations' ? 0.62 : 0.78}
                            />
                        );
                    })}
                </svg>

                {title && (
                    <div className="street-map-title">
                        <div className="street-map-title-main">{title}</div>
                        {subtitle && <div className="street-map-title-sub">{subtitle}</div>}
                    </div>
                )}

                {topLeft && <div className="street-map-top-left">{topLeft}</div>}
                {topRight && <div className="street-map-top-right">{topRight}</div>}
                {bottomLeft && <div className="street-map-bottom-left">{bottomLeft}</div>}
                {bottomCenter && <div className="street-map-bottom-center">{bottomCenter}</div>}

                {routeLabels.map(route => {
                    const from = safePoint(route.from);
                    const to = safePoint(route.to);
                    return (
                        <span
                            key={`label-${route.id}`}
                            className="street-map-route-label"
                            style={{
                                left: `${(from.x + to.x) / 2}%`,
                                top: `${(from.y + to.y) / 2}%`,
                                color: route.color || '#2563eb',
                            }}
                        >
                            {route.label}
                        </span>
                    );
                })}

                {allNodes.map(node => (
                    <StreetMapNode
                        key={node.id}
                        node={node}
                        selected={selectedNodeId === node.id}
                        onNodeClick={onNodeClick}
                    />
                ))}
            </div>
        </div>
    );
};

const streetMapCss = `
.street-map {
    position: relative;
    width: 100%;
    min-height: 260px;
    overflow: hidden;
    border-radius: 22px;
    background: #eef2f3;
    color: #172033;
    box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08), 0 18px 44px -30px rgba(15, 23, 42, 0.45);
}
.street-map-canvas {
    position: absolute;
    inset: 0;
    overflow: hidden;
    cursor: default;
    background:
        radial-gradient(circle at 18% 72%, rgba(125, 190, 224, 0.18), transparent 18%),
        radial-gradient(circle at 82% 18%, rgba(126, 192, 152, 0.17), transparent 18%),
        linear-gradient(rgba(148, 163, 184, 0.18) 1px, transparent 1px),
        linear-gradient(90deg, rgba(148, 163, 184, 0.18) 1px, transparent 1px),
        linear-gradient(135deg, #f8fafc 0%, #edf2f4 42%, #f5f7f8 100%);
    background-size: auto, auto, 28px 28px, 28px 28px, auto;
}
.street-map-canvas::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
        radial-gradient(circle at 1px 1px, rgba(71, 85, 105, 0.22) 1px, transparent 1.5px);
    background-size: 34px 34px;
    opacity: 0.48;
}
.street-map-canvas::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow: inset 0 0 50px rgba(15, 23, 42, 0.08);
}
.street-map-district {
    position: absolute;
    border: 1px solid rgba(255, 255, 255, 0.76);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.76);
}
.street-map-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
}
.street-map-road-shadow {
    fill: none;
    stroke: rgba(15, 23, 42, 0.09);
    stroke-width: 5;
    stroke-linecap: round;
    stroke-linejoin: round;
}
.street-map-road {
    fill: none;
    stroke: rgba(255, 255, 255, 0.9);
    stroke-width: 3.1;
    stroke-linecap: round;
    stroke-linejoin: round;
}
.street-map-road-minor {
    fill: none;
    stroke: rgba(255, 255, 255, 0.64);
    stroke-width: 1.2;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 0.8 2.8;
}
.street-map-title,
.street-map-top-left,
.street-map-top-right,
.street-map-bottom-left,
.street-map-bottom-center {
    position: absolute;
    z-index: 30;
    pointer-events: none;
}
.street-map-top-left > *,
.street-map-top-right > *,
.street-map-bottom-left > *,
.street-map-bottom-center > * {
    pointer-events: auto;
}
.street-map-title {
    left: 14px;
    top: 14px;
    max-width: min(360px, calc(100% - 96px));
    padding: 8px 12px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.88);
    border: 1px solid rgba(226, 232, 240, 0.95);
    box-shadow: 0 12px 28px -22px rgba(15, 23, 42, 0.55);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
}
.street-map-title-main {
    font-size: 14px;
    font-weight: 800;
    line-height: 1.2;
    overflow-wrap: anywhere;
}
.street-map-title-sub {
    margin-top: 2px;
    font-size: 11px;
    color: #64748b;
    line-height: 1.25;
    overflow-wrap: anywhere;
}
.street-map-top-left { left: 14px; top: 14px; }
.street-map-top-right { right: 14px; top: 14px; }
.street-map-bottom-left { left: 14px; bottom: 14px; }
.street-map-bottom-center {
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
}
.street-map-node {
    position: absolute;
    z-index: 20;
    transform: translate(-50%, -100%);
    display: flex;
    align-items: center;
    gap: 7px;
    max-width: min(210px, 52vw);
    border: 0;
    background: transparent;
    color: #172033;
    cursor: pointer;
    padding: 0;
    text-align: left;
    transition: transform 0.16s ease, opacity 0.16s ease, filter 0.16s ease;
}
.street-map-node:hover,
.street-map-node.is-selected {
    z-index: 35;
    transform: translate(-50%, -100%) scale(1.04);
}
.street-map-node.is-muted {
    opacity: 0.42;
}
.street-map-pin {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 31px;
    height: 31px;
    flex: 0 0 31px;
    border-radius: 999px 999px 999px 7px;
    transform: rotate(-45deg);
    background: var(--node-accent);
    color: white;
    box-shadow: 0 12px 20px -14px rgba(15, 23, 42, 0.82), 0 0 0 3px rgba(255, 255, 255, 0.85);
}
.street-map-pin > * {
    transform: rotate(45deg);
}
.street-map-node.is-active .street-map-pin::after,
.street-map-node.is-selected .street-map-pin::after {
    content: "";
    position: absolute;
    inset: -8px;
    border-radius: 999px;
    border: 2px solid rgba(255, 255, 255, 0.72);
    animation: streetMapPulse 1.6s ease-out infinite;
}
.street-map-avatar {
    width: 23px;
    height: 23px;
    border-radius: 999px;
    object-fit: cover;
}
.street-map-emoji {
    font-size: 15px;
    line-height: 1;
}
.street-map-label {
    display: flex;
    flex-direction: column;
    min-width: 0;
    max-width: 168px;
    padding: 7px 10px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(226, 232, 240, 0.96);
    box-shadow: 0 12px 26px -22px rgba(15, 23, 42, 0.72);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
}
.street-map-label-title {
    min-width: 0;
    font-size: 12px;
    font-weight: 800;
    line-height: 1.22;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.street-map-label-sub {
    margin-top: 1px;
    min-width: 0;
    font-size: 10px;
    color: #64748b;
    line-height: 1.22;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.street-map-badge {
    position: absolute;
    left: 19px;
    top: -18px;
    max-width: 96px;
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 800;
    color: #172033;
    background: rgba(255, 255, 255, 0.94);
    border: 1px solid rgba(226, 232, 240, 0.95);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.street-map-route-label {
    position: absolute;
    z-index: 18;
    transform: translate(-50%, -50%);
    padding: 3px 8px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(226, 232, 240, 0.95);
    font-size: 10px;
    font-weight: 800;
    white-space: nowrap;
    box-shadow: 0 10px 22px -18px rgba(15, 23, 42, 0.7);
}
@keyframes streetMapPulse {
    from { transform: scale(0.75); opacity: 0.72; }
    to { transform: scale(1.25); opacity: 0; }
}
`;

export default StreetMap;
