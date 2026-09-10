import { useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import polygonClipping, { type MultiPolygon, type Pair } from "polygon-clipping";
import { SURFACE_COLORS } from "../lib/ecotwin/cellProperties";
import { cellAt, cellPolygon, contains, type Neighborhood, type AreaFeature } from "../lib/ecotwin/geography";
import type { EcoCell, InterventionTool, TwinLocation, ViewMode } from "../lib/ecotwin/types";

// Preserve the imported footprints and physical heights, but exaggerate raised
// geometry so it remains legible at the neighborhood-scale camera distance.
const BUILDING_HEIGHT_SCALE = 2.5;
const MAX_EXTRA_BUILDING_HEIGHT = 3;
const TREE_HEIGHT_SCALE = 2.25;
const TREE_WIDTH_SCALE = 1.35;
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
// Keep the flat render layers physically separate. The neighborhood slab ends at
// y=0; drawing the cell grid there too makes the GPU alternate between their
// triangulations as the camera moves (z-fighting).
const CELL_SURFACE_Y = 0.006;
const MAPPED_SURFACE_Y = 0.014;
const EDITED_SURFACE_Y = 0.025;
// These dimensions are visually exaggerated just enough to read from the
// neighborhood camera. One scene unit represents ten metres.
const PAVEMENT_HEIGHT = 0.004;
const LANDSCAPE_HEIGHT = 0.018;
const CURB_HEIGHT = 0.026;
const CURB_WIDTH = 0.035;

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

function Footprint({ polygons, height = 0, y = 0.03, color, roughness = 0.9, onClick }: {
  polygons: MultiPolygon; height?: number; y?: number; color: string; roughness?: number;
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
}) {
  const shapes = useMemo(() => shapesFrom(polygons), [polygons]);
  return (
    <mesh castShadow={height > 0} receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} onClick={onClick}>
      {height > 0
        ? <extrudeGeometry args={[shapes, { depth: height, bevelEnabled: false }]} />
        : <shapeGeometry args={[shapes]} />}
      <meshStandardMaterial color={color} roughness={roughness} side={THREE.DoubleSide} />
    </mesh>
  );
}

type CurbSegment = { x: number; z: number; length: number; angle: number };

function curbSegments(features: AreaFeature[], boundary: MultiPolygon) {
  const segments: CurbSegment[] = [];
  const asphalt = features.filter((feature) => feature.surface === "asphalt");
  const seen = new Set<string>();
  for (const feature of asphalt) {
    for (const polygon of feature.polygons) {
      for (const ring of polygon) {
        for (let index = 0; index < ring.length - 1; index++) {
          const [x1, z1] = ring[index], [x2, z2] = ring[index + 1];
          const dx = x2 - x1, dz = z2 - z1;
          const length = Math.hypot(dx, dz);
          if (length < 0.04) continue;
          const x = (x1 + x2) / 2, z = (z1 + z2) / 2;
          const sampleDistance = CURB_WIDTH * 1.5;
          const nx = -dz / length * sampleDistance, nz = dx / length * sampleDistance;
          const left: Pair = [x + nx, z + nz], right: Pair = [x - nx, z - nz];
          // Overlapping road polygons create internal boundaries at junctions.
          // Only keep an edge when exactly one side is paved, and never turn the
          // artificial study-area crop into a curb.
          if (!contains(left, boundary) || !contains(right, boundary)) continue;
          const leftIsAsphalt = asphalt.some((candidate) => contains(left, candidate.polygons));
          const rightIsAsphalt = asphalt.some((candidate) => contains(right, candidate.polygons));
          if (leftIsAsphalt === rightIsAsphalt) continue;
          const first = `${x1.toFixed(4)},${z1.toFixed(4)}`;
          const second = `${x2.toFixed(4)},${z2.toFixed(4)}`;
          const key = first < second ? `${first}|${second}` : `${second}|${first}`;
          if (seen.has(key)) continue;
          seen.add(key);
          segments.push({ x, z, length, angle: Math.atan2(dz, dx) });
        }
      }
    }
  }
  return segments;
}

function Curbs({ features, boundary }: { features: AreaFeature[]; boundary: MultiPolygon }) {
  const segments = useMemo(() => curbSegments(features, boundary), [boundary, features]);
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      position.set(segment.x, MAPPED_SURFACE_Y + PAVEMENT_HEIGHT + CURB_HEIGHT / 2, segment.z);
      rotation.setFromEuler(new THREE.Euler(0, -segment.angle, 0));
      scale.set(segment.length, CURB_HEIGHT, CURB_WIDTH);
      matrix.compose(position, rotation, scale);
      mesh.current.setMatrixAt(index, matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [segments]);
  if (!segments.length) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, segments.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#b8b8b2" roughness={0.82} />
    </instancedMesh>
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
      <Footprint polygons={feature.polygons} height={displayHeight} color={"#c5c9cf"} roughness={0.78} onClick={click} />
      {roofs.filter((r) => r.polygons.length).map(({ cell, polygons }) => (
        <Footprint key={cell.id} polygons={polygons} y={displayHeight + 0.035} color={colorFor(cell, mode, rainfallMm)} onClick={click} />
      ))}
    </group>
  );
}

function Tree({ x, z, color, onClick }: { x: number; z: number; color: string; onClick?: (event: ThreeEvent<MouseEvent>) => void }) {
  return (
    <group position={[x, 0, z]} scale={[TREE_WIDTH_SCALE, TREE_HEIGHT_SCALE, TREE_WIDTH_SCALE]} onClick={onClick}>
      <mesh castShadow position={[0, 0.25, 0]}><cylinderGeometry args={[0.045, 0.065, 0.5, 6]} /><meshStandardMaterial color="#79583b" roughness={1} /></mesh>
      <mesh castShadow receiveShadow position={[0, 0.65, 0]}><icosahedronGeometry args={[0.32, 1]} /><meshStandardMaterial color={color} roughness={0.92} /></mesh>
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
      <mesh receiveShadow position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]} onClick={onClick}>
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
      <Canvas shadows frameloop="demand" dpr={[1, 1.5]} camera={{ position: cameraPosition, fov: 48, near: 0.5, far: 300 }}>
        <CaptureBridge captureRef={captureRef} viewMode={viewMode} />
        <color attach="background" args={["#c9d1d7"]} />
        <fog attach="fog" args={["#c9d1d7", gridSize * 1.5, gridSize * 4]} />
        <hemisphereLight args={["#e8f2ff", "#6f746d", 0.8]} />
        <ambientLight intensity={0.45} />
        <directionalLight castShadow position={[-15, 28, 10]} intensity={2.15}
          shadow-mapSize-width={2048} shadow-mapSize-height={2048}
          shadow-camera-left={-halfSize * 1.3} shadow-camera-right={halfSize * 1.3}
          shadow-camera-top={halfSize * 1.3} shadow-camera-bottom={-halfSize * 1.3}
          shadow-camera-near={1} shadow-camera-far={gridSize * 3} shadow-bias={-0.00015} />
        <Footprint polygons={neighborhood.boundary} height={0.25} y={-0.25} color="#aeb4bc" />
        {viewMode === "surface" && neighborhood.features.filter((f) => f.surface !== "building").map((feature, index) => (
          <Footprint key={feature.id} polygons={feature.polygons}
            height={feature.surface === "asphalt" ? PAVEMENT_HEIGHT : LANDSCAPE_HEIGHT}
            y={MAPPED_SURFACE_Y + index * 0.00003} color={SURFACE_COLORS[feature.surface]}
            roughness={feature.surface === "asphalt" ? 0.72 : 0.96}
            onClick={(e) => clickCell(e, cellAt(e.point.x, e.point.z, gridSize))} />
        ))}
        {viewMode === "surface" && <Curbs features={neighborhood.features} boundary={neighborhood.boundary} />}
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
                y={showSurface ? EDITED_SURFACE_Y : CELL_SURFACE_Y}
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
