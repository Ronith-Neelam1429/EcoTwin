import { useMemo, useState } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import polygonClipping, { type MultiPolygon, type Pair } from "polygon-clipping";
import { SURFACE_COLORS } from "../lib/ecotwin/cellProperties";
import { cellAt, cellPolygon, type Neighborhood, type AreaFeature } from "../lib/ecotwin/geography";
import { calculateCellEnvironment } from "../lib/ecotwin/simulation";
import type { EcoCell, TwinLocation, ViewMode } from "../lib/ecotwin/types";

function colorFor(surface: EcoCell["surfaceType"], mode: ViewMode) {
  const { temperature, water } = calculateCellEnvironment(surface);
  if (mode === "heat") return new THREE.Color().setHSL(0.14 * (1 - THREE.MathUtils.clamp((temperature - 27) / 14, 0, 1)), 0.78, 0.53).getStyle();
  if (mode === "runoff") return new THREE.Color().setHSL(0.59, 0.7, 0.85 - water / 10 * 0.6).getStyle();
  return SURFACE_COLORS[surface];
}

function shapesFrom(polygons: MultiPolygon) {
  return polygons.map(([outer, ...holes]) => {
    const vectors = (ring: Pair[]) => ring.map(([x, z]) => new THREE.Vector2(x, -z));
    const shape = new THREE.Shape(vectors(outer));
    shape.holes = holes.map((ring) => new THREE.Path(vectors(ring)));
    return shape;
  });
}

function Footprint({ polygons, height = 0, y = 0.03, color, onClick }: {
  polygons: MultiPolygon; height?: number; y?: number; color: string;
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
}) {
  const shapes = useMemo(() => shapesFrom(polygons), [polygons]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} onClick={onClick}>
      {height > 0
        ? <extrudeGeometry args={[shapes, { depth: height, bevelEnabled: false }]} />
        : <shapeGeometry args={[shapes]} />}
      <meshStandardMaterial color={color} roughness={0.9} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Building({ feature, cells, mode, onSelect }: {
  feature: AreaFeature; cells: EcoCell[]; mode: ViewMode; onSelect: (id: string) => void;
}) {
  const roofs = useMemo(() => cells.filter((cell) => cell.buildingId === feature.id && (mode !== "surface" || cell.surfaceType === "green_roof"))
    .map((cell) => ({ cell, polygons: polygonClipping.intersection(feature.polygons, cellPolygon(cell.row, cell.col)) })), [cells, feature, mode]);
  function click(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    if (event.delta > 4) return;
    const id = cellAt(event.point.x, event.point.z);
    const cell = cells.find((c) => c.id === id && c.buildingId === feature.id)
      ?? cells.find((c) => c.buildingId === feature.id);
    if (cell) onSelect(cell.id);
  }
  return (
    <group>
      <Footprint polygons={feature.polygons} height={feature.height} color={mode === "surface" ? "#d4c7ad" : colorFor("building", mode)} onClick={click} />
      {roofs.filter((r) => r.polygons.length).map(({ cell, polygons }) => (
        <Footprint key={cell.id} polygons={polygons} y={feature.height + 0.035} color={colorFor(cell.surfaceType, mode)} onClick={click} />
      ))}
    </group>
  );
}

function Tree({ x, z, color, onClick }: { x: number; z: number; color: string; onClick?: (event: ThreeEvent<MouseEvent>) => void }) {
  return (
    <group position={[x, 0, z]} onClick={onClick}>
      <mesh position={[0, 0.25, 0]}><cylinderGeometry args={[0.045, 0.065, 0.5, 6]} /><meshStandardMaterial color="#79583b" /></mesh>
      <mesh position={[0, 0.65, 0]}><icosahedronGeometry args={[0.32, 1]} /><meshStandardMaterial color={color} /></mesh>
    </group>
  );
}

export function EcoTwinScene({ cells, viewMode, onCellClick, neighborhood, location }: {
  cells: EcoCell[]; viewMode: ViewMode; onCellClick: (id: string) => void; neighborhood: Neighborhood; location: TwinLocation;
}) {
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const heading = location.heading * Math.PI / 180;
  const cameraPosition: [number, number, number] = [-Math.sin(heading) * 30, 31, Math.cos(heading) * 30];
  function select(id: string) { setSelectedCell(id); onCellClick(id); }
  function clickCell(event: ThreeEvent<MouseEvent>, id: string) {
    event.stopPropagation();
    if (event.delta <= 4) select(id);
  }
  return (
    <div className="scene-canvas">
      <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ position: cameraPosition, fov: 48, near: 0.1, far: 300 }}>
        <color attach="background" args={["#e4ebe5"]} />
        <ambientLight intensity={1.1} />
        <directionalLight position={[-15, 28, 10]} intensity={2.2} />
        <mesh position={[0, -0.15, 0]}><boxGeometry args={[30.05, 0.25, 30.05]} /><meshStandardMaterial color="#b5bbaf" /></mesh>
        {viewMode === "surface" && neighborhood.features.filter((f) => f.surface !== "building").map((feature, index) => (
          <Footprint key={feature.id} polygons={feature.polygons} y={0.014 + index * 0.00003} color={SURFACE_COLORS[feature.surface]}
            onClick={(e) => clickCell(e, cellAt(e.point.x, e.point.z))} />
        ))}
        {cells.map((cell) => {
          const x = cell.col - 14.5, z = cell.row - 14.5;
          const changed = cell.surfaceType !== cell.baselineSurfaceType;
          const showSurface = viewMode !== "surface" || (changed && !cell.buildingId);
          return (
            <group key={cell.id}>
              <mesh position={[x, showSurface ? 0.025 : 0, z]} rotation={[-Math.PI / 2, 0, 0]} onClick={(e) => clickCell(e, cell.id)}>
                <planeGeometry args={[viewMode === "surface" ? 1 : 0.985, viewMode === "surface" ? 1 : 0.985]} />
                <meshStandardMaterial color={showSurface ? colorFor(cell.surfaceType, viewMode) : SURFACE_COLORS.unknown} />
              </mesh>
              {selectedCell === cell.id && <mesh position={[x, 0.04, z]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.37, 0.42, 4]} /><meshBasicMaterial color="#eead34" /></mesh>}
              {cell.surfaceType === "tree" && changed && <Tree x={x} z={z} color={colorFor("tree", viewMode)} onClick={(e) => clickCell(e, cell.id)} />}
            </group>
          );
        })}
        {neighborhood.features.filter((f) => f.surface === "building").map((feature) => (
          <Building key={feature.id} feature={feature} cells={cells} mode={viewMode} onSelect={select} />
        ))}
        {neighborhood.trees.filter((t) => cells.find((c) => c.id === cellAt(...t.point))?.surfaceType === "tree").map((tree) => (
          <Tree key={tree.id} x={tree.point[0]} z={tree.point[1]} color={colorFor("tree", viewMode)} onClick={(e) => clickCell(e, cellAt(...tree.point))} />
        ))}
        <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.19, 0.27, 32]} /><meshBasicMaterial color="#e39928" /></mesh>
        <Html position={[0, 0.4, -15.8]} center><span className="north-label">↑ N</span></Html>
        <OrbitControls makeDefault enableDamping minDistance={5} maxDistance={75} maxPolarAngle={Math.PI / 2.1} />
      </Canvas>
      <div className="scene-key">
        {viewMode === "surface" ? <><span className="unknown-swatch" />Unmapped ground · <span className="origin-swatch" />Selected location</>
          : <><span className={`scale-${viewMode}`} />{viewMode === "heat" ? "27°C → 41°C (model)" : "0 → 10 runoff units / cell"}</>}
      </div>
      <div className="scene-help">Drag to orbit · Scroll to zoom · Right-drag to pan · 1 cell = 10m</div>
      <div className="osm-attribution"><a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></div>
    </div>
  );
}
