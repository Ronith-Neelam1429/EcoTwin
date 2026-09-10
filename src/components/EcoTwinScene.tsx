import { useImperativeHandle, useMemo, useState, type Ref } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import polygonClipping, { type MultiPolygon, type Pair } from "polygon-clipping";
import { SURFACE_COLORS } from "../lib/ecotwin/cellProperties";
import { cellAt, cellPolygon, type Neighborhood, type AreaFeature } from "../lib/ecotwin/geography";
import type { EcoCell, InterventionTool, TwinLocation, ViewMode } from "../lib/ecotwin/types";

// Preserve the imported footprints and physical heights, but exaggerate raised
// geometry so it remains legible at the neighborhood-scale camera distance.
const BUILDING_HEIGHT_SCALE = 2.5;
const MAX_EXTRA_BUILDING_HEIGHT = 3;
const TREE_HEIGHT_SCALE = 2.25;
const TREE_WIDTH_SCALE = 1.35;
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function colorFor(cell: EcoCell, mode: ViewMode, rainfallMm: number) {
  if (mode === "heat") return new THREE.Color().setHSL(0.14 * (1 - THREE.MathUtils.clamp((cell.temperature - 10) / 50, 0, 1)), 0.78, 0.53).getStyle();
  if (mode === "runoff") return new THREE.Color().setHSL(0.59, 0.7, 0.85 - THREE.MathUtils.clamp(cell.water / Math.max(1, rainfallMm), 0, 1) * 0.6).getStyle();
  return SURFACE_COLORS[cell.surfaceType];
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

function Building({ feature, cells, gridSize, mode, tool, onSelect, rainfallMm }: {
  rainfallMm: number; feature: AreaFeature; cells: EcoCell[]; gridSize: number; mode: ViewMode; tool: InterventionTool; onSelect: (id: string) => void;
}) {
  const displayHeight = feature.height + Math.min(
    feature.height * (BUILDING_HEIGHT_SCALE - 1),
    MAX_EXTRA_BUILDING_HEIGHT,
  );
  const roofs = useMemo(() => cells.filter((cell) => cell.buildingId === feature.id && (mode !== "surface" || cell.surfaceType === "green_roof"))
    .map((cell) => ({ cell, polygons: polygonClipping.intersection(feature.polygons, cellPolygon(cell.row, cell.col, gridSize)) })), [cells, feature, gridSize, mode]);
  function click(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    if (event.delta > 4) return;
    if (tool !== "green_roof" && tool !== "erase") {
      const groundPoint = event.ray.intersectPlane(
        GROUND_PLANE,
        new THREE.Vector3(),
      );
      if (groundPoint) {
        onSelect(cellAt(groundPoint.x, groundPoint.z, gridSize));
        return;
      }
    }
    const id = cellAt(event.point.x, event.point.z, gridSize);
    const cell = cells.find((c) => c.id === id && c.buildingId === feature.id)
      ?? cells.find((c) => c.buildingId === feature.id);
    if (cell) onSelect(cell.id);
  }
  return (
    <group>
      <Footprint polygons={feature.polygons} height={displayHeight} color={"#c9cdd3"} onClick={click} />
      {roofs.filter((r) => r.polygons.length).map(({ cell, polygons }) => (
        <Footprint key={cell.id} polygons={polygons} y={displayHeight + 0.035} color={colorFor(cell, mode, rainfallMm)} onClick={click} />
      ))}
    </group>
  );
}

function Tree({ x, z, color, onClick }: { x: number; z: number; color: string; onClick?: (event: ThreeEvent<MouseEvent>) => void }) {
  return (
    <group position={[x, 0, z]} scale={[TREE_WIDTH_SCALE, TREE_HEIGHT_SCALE, TREE_WIDTH_SCALE]} onClick={onClick}>
      <mesh position={[0, 0.25, 0]}><cylinderGeometry args={[0.045, 0.065, 0.5, 6]} /><meshStandardMaterial color="#79583b" /></mesh>
      <mesh position={[0, 0.65, 0]}><icosahedronGeometry args={[0.32, 1]} /><meshStandardMaterial color={color} /></mesh>
    </group>
  );
}

function CellSurface({ cell, boundary, gridSize, color, y, inset, onClick }: {
  cell: EcoCell; boundary: MultiPolygon; gridSize: number; color: string; y: number; inset: boolean;
  onClick: (event: ThreeEvent<MouseEvent>) => void;
}) {
  const polygons = useMemo(
    () => polygonClipping.intersection(boundary, cellPolygon(cell.row, cell.col, gridSize)),
    [boundary, cell.col, cell.row, gridSize],
  );
  if (cell.coverage > 0.999999) {
    const size = inset ? 0.985 : 1;
    const x = cell.col - gridSize / 2 + 0.5, z = cell.row - gridSize / 2 + 0.5;
    return (
      <mesh position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]} onClick={onClick}>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial color={color} />
      </mesh>
    );
  }
  return <Footprint polygons={polygons} y={y} color={color} onClick={onClick} />;
}

export type SceneCapture = { capture: () => string };
function CaptureBridge({ captureRef, viewMode }: { captureRef?: Ref<SceneCapture>; viewMode: ViewMode }) {
  const { gl, scene, camera } = useThree();
  useImperativeHandle(captureRef, () => ({ capture() {
    if (viewMode !== "surface") throw new Error("The surface view is still updating. Please try again.");
    const hidden: THREE.Object3D[] = [];
    scene.traverse((object) => { if (object.userData.captureHidden && object.visible) { hidden.push(object); object.visible = false; } });
    try {
      gl.render(scene, camera);
      const output = document.createElement('canvas');
      const scale = Math.min(1, 1536 / Math.max(gl.domElement.width, gl.domElement.height));
      output.width = Math.max(1, Math.round(gl.domElement.width * scale));
      output.height = Math.max(1, Math.round(gl.domElement.height * scale));
      const context = output.getContext('2d');
      if (!context) throw new Error('Could not capture the scene. Please retry.');
      context.drawImage(gl.domElement, 0, 0, output.width, output.height);
      return output.toDataURL('image/png');
    } finally { hidden.forEach((object) => { object.visible = true; }); gl.render(scene, camera); }
  } }), [gl, scene, camera, viewMode]);
  return null;
}

export function EcoTwinScene({ cells, viewMode, selectedTool, onCellClick, neighborhood, location, rainfallMm, captureRef }: {
  captureRef?: Ref<SceneCapture>; rainfallMm: number; cells: EcoCell[]; viewMode: ViewMode; selectedTool: InterventionTool; onCellClick: (id: string) => void; neighborhood: Neighborhood; location: TwinLocation;
}) {
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const gridSize = neighborhood.gridSize;
  const halfSize = gridSize / 2;
  const heading = location.heading * Math.PI / 180;
  const cameraPosition: [number, number, number] = [-Math.sin(heading) * gridSize, gridSize + 1, Math.cos(heading) * gridSize];
  function select(id: string) { setSelectedCell(id); onCellClick(id); }
  function clickCell(event: ThreeEvent<MouseEvent>, id: string) {
    event.stopPropagation();
    if (event.delta <= 4) select(id);
  }
  return (
    <div className="scene-canvas">
      <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ position: cameraPosition, fov: 48, near: 0.1, far: 300 }}>
        <CaptureBridge captureRef={captureRef} viewMode={viewMode} />
        <color attach="background" args={["#c9d1d7"]} />
        <ambientLight intensity={1.1} />
        <directionalLight position={[-15, 28, 10]} intensity={2.2} />
        <Footprint polygons={neighborhood.boundary} height={0.25} y={-0.25} color="#aeb4bc" />
        {viewMode === "surface" && neighborhood.features.filter((f) => f.surface !== "building").map((feature, index) => (
          <Footprint key={feature.id} polygons={feature.polygons} y={0.014 + index * 0.00003} color={SURFACE_COLORS[feature.surface]}
            onClick={(e) => clickCell(e, cellAt(e.point.x, e.point.z, gridSize))} />
        ))}
        {cells.map((cell) => {
          const x = cell.col - halfSize + 0.5, z = cell.row - halfSize + 0.5;
          const changed = cell.surfaceType !== cell.baselineSurfaceType;
          const showSurface = viewMode !== "surface" || (changed && !cell.buildingId);
          return (
            <group key={cell.id}>
              <CellSurface
                cell={cell}
                boundary={neighborhood.boundary}
                gridSize={gridSize}
                color={showSurface ? colorFor(cell, viewMode, rainfallMm) : SURFACE_COLORS.unknown}
                y={showSurface ? 0.025 : 0}
                inset={viewMode !== "surface"}
                onClick={(e) => clickCell(e, cell.id)}
              />
              {selectedCell === cell.id && <mesh userData={{ captureHidden: true }} position={[x, 0.04, z]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.37, 0.42, 4]} /><meshBasicMaterial color="#2f6fed" /></mesh>}
              {cell.surfaceType === "tree" && changed && <Tree x={x} z={z} color={colorFor(cell, viewMode, rainfallMm)} onClick={(e) => clickCell(e, cell.id)} />}
            </group>
          );
        })}
        {neighborhood.features.filter((f) => f.surface === "building").map((feature) => (
          <Building key={feature.id} feature={feature} cells={cells} gridSize={gridSize} mode={viewMode} tool={selectedTool} onSelect={select} rainfallMm={rainfallMm} />
        ))}
        {neighborhood.trees.filter((t) => cells.find((c) => c.id === cellAt(...t.point, gridSize))?.surfaceType === "tree").map((tree) => (
          <Tree key={tree.id} x={tree.point[0]} z={tree.point[1]} color={colorFor(cells.find((c) => c.id === cellAt(...tree.point, gridSize))!, viewMode, rainfallMm)} onClick={(e) => clickCell(e, cellAt(...tree.point, gridSize))} />
        ))}
        <mesh userData={{ captureHidden: true }} position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.19, 0.27, 32]} /><meshBasicMaterial color="#2f6fed" /></mesh>
        <Html position={[0, 0.4, -halfSize - 0.8]} center><span className="north-label">↑ N</span></Html>
        <OrbitControls makeDefault enableDamping minDistance={Math.max(3, gridSize / 6)} maxDistance={gridSize * 2.5} maxPolarAngle={Math.PI / 2.1} />
      </Canvas>
      <div className="scene-key">
        {viewMode === "surface" ? <><span className="unknown-swatch" />Unmapped ground · <span className="origin-swatch" />Selected location</>
          : <><span className={`scale-${viewMode}`} />{viewMode === "heat" ? "10°C → 60°C surface (ends clipped)" : `0 → ${Math.max(1, rainfallMm).toFixed(1)} mm runoff / cell`}</>}
      </div>
      <div className="scene-help">Drag to orbit · Scroll to zoom · Right-drag to pan · 1 cell = 10m</div>
      <div className="osm-attribution"><a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></div>
    </div>
  );
}
