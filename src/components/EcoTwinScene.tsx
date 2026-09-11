import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import polygonClipping, { type MultiPolygon, type Pair } from "polygon-clipping";
import { SURFACE_COLORS, SURFACE_LABELS } from "../lib/ecotwin/cellProperties";
import { cellAt, cellPolygon, contains, type Neighborhood, type AreaFeature } from "../lib/ecotwin/geography";
import type { EcoCell, InterventionTool, TwinLocation, ViewMode } from "../lib/ecotwin/types";

const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
// Keep the flat render layers physically separate. The neighborhood slab ends at
// y=0; drawing the cell grid there too makes the GPU alternate between their
// triangulations as the camera moves (z-fighting).
const CELL_SURFACE_Y = 0.006;
const MAPPED_SURFACE_Y = 0.014;
const EDITED_SURFACE_Y = 0.025;
// One scene unit represents ten metres. Raised details use physical dimensions.
const PAVEMENT_HEIGHT = 0.004;
const LANDSCAPE_HEIGHT = 0.006;
const CURB_HEIGHT = 0.015; // 15 cm
const CURB_WIDTH = 0.015; // 15 cm
const TREE_CANOPY_DIAMETER = 0.8; // 8 m, matching the physics assumption
const TREE_HEIGHT = 1; // 10 m mature-tree display assumption

const THERMAL_COLORS = ["#3642b9", "#168fd1", "#35c7b2", "#f3d65b", "#f58a36", "#d53645", "#811b55"];
function thermalColor(temperature: number) {
  const position = THREE.MathUtils.clamp((temperature - 10) / 50, 0, 1) * (THERMAL_COLORS.length - 1);
  const index = Math.min(Math.floor(position), THERMAL_COLORS.length - 2);
  return new THREE.Color(THERMAL_COLORS[index]).lerp(new THREE.Color(THERMAL_COLORS[index + 1]), position - index);
}

// Linear texture filtering interpolates between 10 m samples for display only.
// The boundary geometry clips the field; metrics still use the original samples.
function ThermalField({ cells, boundary, gridSize, onClick }: {
  cells: EcoCell[]; boundary: MultiPolygon; gridSize: number; onClick: (event: ThreeEvent<MouseEvent>) => void;
}) {
  const geometry = useMemo(() => {
    const result = new THREE.ShapeGeometry(shapesFrom(boundary));
    const positions = result.getAttribute("position");
    const uv = result.getAttribute("uv");
    for (let i = 0; i < positions.count; i++) {
      uv.setXY(i, positions.getX(i) / gridSize + 0.5, -positions.getY(i) / gridSize + 0.5);
    }
    return result;
  }, [boundary, gridSize]);
  const texture = useMemo(() => {
    const data = new Uint8Array(gridSize * gridSize * 4);
    const fallback = cells.length ? cells.reduce((sum, cell) => sum + cell.temperature, 0) / cells.length : 30;
    const samples = new Map(cells.map((cell) => [cell.row * gridSize + cell.col, cell.temperature]));
    for (let i = 0; i < gridSize * gridSize; i++) {
      const color = thermalColor(samples.get(i) ?? fallback).convertLinearToSRGB();
      data.set([Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255), 255], i * 4);
    }
    const result = new THREE.DataTexture(data, gridSize, gridSize);
    result.colorSpace = THREE.SRGBColorSpace;
    result.magFilter = THREE.LinearFilter;
    result.minFilter = THREE.LinearFilter;
    result.needsUpdate = true;
    return result;
  }, [cells, gridSize]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.032, 0]} onClick={onClick}>
    <meshBasicMaterial map={texture} toneMapped={false} side={THREE.DoubleSide} />
  </mesh>;
}

function colorFor(cell: EcoCell, baseline: EcoCell | undefined, mode: ViewMode, rainfallMm: number) {
  if (mode === "temperature") {
    return thermalColor(cell.temperature).getStyle();
  }
  if (mode === "solar") {
    const baselineSolar = baseline?.absorbedSolar ?? cell.absorbedSolar;
    const solarReduction = Math.max(0, baselineSolar - cell.absorbedSolar);
    const effect = Math.max(cell.shade, solarReduction / Math.max(1, baselineSolar));
    return new THREE.Color().lerpColors(new THREE.Color("#f1d36b"), new THREE.Color("#173f55"), THREE.MathUtils.clamp(effect, 0, 1)).getStyle();
  }
  if (mode === "stormwater") {
    const avoided = Math.max(0, (baseline?.water ?? cell.water) - cell.water);
    return new THREE.Color().lerpColors(new THREE.Color("#d9dde0"), new THREE.Color("#1466a0"), THREE.MathUtils.clamp(avoided / Math.max(1, rainfallMm), 0, 1)).getStyle();
  }
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

function Footprint({ polygons, height = 0, y = 0.03, color, roughness = 0.9, unlit = false, onClick }: {
  polygons: MultiPolygon; height?: number; y?: number; color: string; roughness?: number;
  unlit?: boolean; onClick?: (event: ThreeEvent<MouseEvent>) => void;
}) {
  const shapes = useMemo(() => shapesFrom(polygons), [polygons]);
  return (
    <mesh castShadow={height > 0} receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} onClick={onClick}>
      {height > 0
        ? <extrudeGeometry args={[shapes, { depth: height, bevelEnabled: false }]} />
        : <shapeGeometry args={[shapes]} />}
      {unlit ? <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} /> : <meshStandardMaterial color={color} roughness={roughness} side={THREE.DoubleSide} />}
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

type Stall = { id: string; points: [number, number, number][]; inferred: boolean };

function ringCenter(ring: Pair[]): Pair {
  const usable = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  return usable.reduce<Pair>((sum, point) => [sum[0] + point[0] / usable.length, sum[1] + point[1] / usable.length], [0, 0]);
}

function inferredStalls(lot: AreaFeature): Stall[] {
  const stalls: Stall[] = [];
  for (let polygonIndex = 0; polygonIndex < lot.polygons.length; polygonIndex++) {
    const polygon = lot.polygons[polygonIndex], ring = polygon[0];
    if (!ring || ring.length < 4) continue;
    const center = ringCenter(ring);
    let longest: [Pair, Pair] = [ring[0], ring[1]], longestLength = 0;
    for (let index = 0; index < ring.length - 1; index++) {
      const length = Math.hypot(ring[index + 1][0] - ring[index][0], ring[index + 1][1] - ring[index][1]);
      if (length > longestLength) { longestLength = length; longest = [ring[index], ring[index + 1]]; }
    }
    const angle = Math.atan2(longest[1][1] - longest[0][1], longest[1][0] - longest[0][0]);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const local = (point: Pair): Pair => { const x = point[0] - center[0], z = point[1] - center[1]; return [x * cos + z * sin, -x * sin + z * cos]; };
    const world = ([u, v]: Pair): Pair => [center[0] + u * cos - v * sin, center[1] + u * sin + v * cos];
    const localRing = ring.map(local);
    const minU = Math.min(...localRing.map(([u]) => u)), maxU = Math.max(...localRing.map(([u]) => u));
    const minV = Math.min(...localRing.map(([, v]) => v)), maxV = Math.max(...localRing.map(([, v]) => v));
    const stallWidth = 0.27, stallDepth = 0.54, aisle = 0.62, module = stallDepth * 2 + aisle;
    for (let moduleV = minV + 0.08; moduleV + module <= maxV - 0.08; moduleV += module) {
      for (const v0 of [moduleV, moduleV + stallDepth + aisle]) {
        for (let u0 = minU + 0.08; u0 + stallWidth <= maxU - 0.08; u0 += stallWidth) {
          const corners = [[u0, v0], [u0 + stallWidth, v0], [u0 + stallWidth, v0 + stallDepth], [u0, v0 + stallDepth]] as Pair[];
          const worldCorners = corners.map(world);
          if (!worldCorners.every((point) => contains(point, [polygon]))) continue;
          const points = [...worldCorners, worldCorners[0]].map(([x, z]) => [x, MAPPED_SURFACE_Y + 0.012, z] as [number, number, number]);
          stalls.push({ id: `${lot.id}-${polygonIndex}-${stalls.length}`, points, inferred: true });
          if (stalls.length >= 400) return stalls;
        }
      }
    }
  }
  return stalls;
}

function ParkingModels({ features }: { features: AreaFeature[] }) {
  const stalls = useMemo(() => {
    const mapped = features.filter((feature) => feature.kind === "parking_space");
    const result: Stall[] = mapped.flatMap((feature) => feature.polygons.map((polygon, index) => ({
      id: `${feature.id}-${index}`, inferred: false,
      points: polygon[0].map(([x, z]) => [x, MAPPED_SURFACE_Y + 0.012, z] as [number, number, number]),
    })));
    for (const lot of features.filter((feature) => feature.kind === "parking_lot")) {
      const hasMappedStalls = mapped.some((space) => space.polygons.some((polygon) => contains(ringCenter(polygon[0]), lot.polygons)));
      if (!hasMappedStalls) result.push(...inferredStalls(lot));
    }
    return result;
  }, [features]);
  return <>
    {features.filter((feature) => feature.kind === "parking_lot").flatMap((feature) => feature.polygons.map((polygon, index) =>
      <Line key={`${feature.id}-edge-${index}`} points={polygon[0].map(([x, z]) => [x, MAPPED_SURFACE_Y + 0.01, z] as [number, number, number])}
        color="#aab2b2" lineWidth={0.8} transparent opacity={0.8} />,
    ))}
    {stalls.map((stall) => <Line key={stall.id} points={stall.points} color={stall.inferred ? "#d8dedb" : "#f0f3f0"}
      lineWidth={stall.inferred ? 0.85 : 1.35} transparent opacity={stall.inferred ? 0.72 : 0.95} />)}
  </>;
}

function Building({ feature, cells, baselineById, gridSize, mode, tool, onSelect, rainfallMm }: {
  rainfallMm: number; feature: AreaFeature; cells: EcoCell[]; baselineById: Map<string, EcoCell>; gridSize: number; mode: ViewMode; tool: InterventionTool; onSelect: (id: string) => void;
}) {
  const displayHeight = feature.height;
  const roofs = useMemo(() => cells.filter((cell) => cell.buildingId === feature.id && (mode !== "surface" || cell.surfaceType === "green_roof"))
    .map((cell) => ({ cell, polygons: polygonClipping.intersection(feature.polygons, cellPolygon(cell.row, cell.col, gridSize)) })), [cells, feature, gridSize, mode]);
  function click(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    if (event.delta > 4) return;
    if (mode === "surface" && tool !== "green_roof" && tool !== "erase") {
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
        <Footprint key={cell.id} polygons={polygons} y={displayHeight + 0.035} unlit={mode !== "surface"} color={colorFor(cell, baselineById.get(cell.id), mode, rainfallMm)} onClick={click} />
      ))}
    </group>
  );
}

function Tree({ x, z, color, onClick }: { x: number; z: number; color: string; onClick?: (event: ThreeEvent<MouseEvent>) => void }) {
  return (
    <group position={[x, 0, z]} onClick={onClick}>
      <mesh castShadow position={[0, TREE_HEIGHT * 0.28, 0]}><cylinderGeometry args={[0.045, 0.065, TREE_HEIGHT * 0.56, 8]} /><meshStandardMaterial color="#79583b" roughness={1} /></mesh>
      <mesh castShadow receiveShadow position={[0, TREE_HEIGHT * 0.7, 0]} scale={[1, 0.75, 1]}><icosahedronGeometry args={[TREE_CANOPY_DIAMETER / 2, 2]} /><meshStandardMaterial color={color} roughness={0.92} /></mesh>
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

export function EcoTwinScene({ cells, baselineCells, viewMode, selectedTool, onCellClick, neighborhood, location, rainfallMm, captureRef }: {
  captureRef?: Ref<SceneCapture>; rainfallMm: number; cells: EcoCell[]; baselineCells: EcoCell[]; viewMode: ViewMode; selectedTool: InterventionTool; onCellClick: (id: string) => void; neighborhood: Neighborhood; location: TwinLocation;
}) {
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const gridSize = neighborhood.gridSize;
  const baselineById = useMemo(() => new Map(baselineCells.map((cell) => [cell.id, cell])), [baselineCells]);
  const selectedResult = selectedCell ? cells.find((cell) => cell.id === selectedCell) : undefined;
  const selectedBaseline = selectedCell ? baselineById.get(selectedCell) : undefined;
  const halfSize = gridSize / 2;
  const heading = location.heading * Math.PI / 180;
  const cameraPosition: [number, number, number] = [-Math.sin(heading) * gridSize, gridSize + 1, Math.cos(heading) * gridSize];
  function select(id: string) { setSelectedCell(id); if (viewMode === "surface") onCellClick(id); }
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
            y={MAPPED_SURFACE_Y + index * 0.00003} color={feature.kind === "parking_space" ? "#747d7c" : SURFACE_COLORS[feature.surface]}
            roughness={feature.surface === "asphalt" ? 0.72 : 0.96}
            onClick={(e) => clickCell(e, cellAt(e.point.x, e.point.z, gridSize))} />
        ))}
        {viewMode === "surface" && <Curbs features={neighborhood.features} boundary={neighborhood.boundary} />}
        {viewMode === "surface" && <ParkingModels features={neighborhood.features} />}
        {viewMode === "temperature" && <ThermalField cells={cells} boundary={neighborhood.boundary} gridSize={gridSize}
          onClick={(event) => clickCell(event, cellAt(event.point.x, event.point.z, gridSize))} />}
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
                color={showSurface ? colorFor(cell, baselineById.get(cell.id), viewMode, rainfallMm) : SURFACE_COLORS.unknown}
                y={showSurface ? EDITED_SURFACE_Y : CELL_SURFACE_Y}
                inset={viewMode !== "surface"}
                onClick={(e) => clickCell(e, cell.id)}
              />
              {selectedCell === cell.id && <mesh userData={{ captureHidden: true }} position={[x, 0.04, z]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.37, 0.42, 4]} /><meshBasicMaterial color="#2f6fed" /></mesh>}
              {cell.surfaceType === "tree" && changed && <Tree x={x} z={z} color={colorFor(cell, baselineById.get(cell.id), viewMode, rainfallMm)} onClick={(e) => clickCell(e, cell.id)} />}
            </group>
          );
        })}
        {neighborhood.features.filter((f) => f.surface === "building").map((feature) => (
          <Building key={feature.id} feature={feature} cells={cells} baselineById={baselineById} gridSize={gridSize} mode={viewMode} tool={selectedTool} onSelect={select} rainfallMm={rainfallMm} />
        ))}
        {neighborhood.trees.filter((t) => cells.find((c) => c.id === cellAt(...t.point, gridSize))?.surfaceType === "tree").map((tree) => (
          <Tree key={tree.id} x={tree.point[0]} z={tree.point[1]} color={colorFor(cells.find((c) => c.id === cellAt(...tree.point, gridSize))!, baselineById.get(cellAt(...tree.point, gridSize)), viewMode, rainfallMm)} onClick={(e) => clickCell(e, cellAt(...tree.point, gridSize))} />
        ))}
        <mesh userData={{ captureHidden: true }} position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.19, 0.27, 32]} /><meshBasicMaterial color="#2f6fed" /></mesh>
        <Html position={[0, 0.4, -halfSize - 0.8]} center><span className="north-label">↑ N</span></Html>
        <OrbitControls makeDefault enableDamping minDistance={Math.max(3, gridSize / 6)} maxDistance={gridSize * 2.5} maxPolarAngle={Math.PI / 2.1} />
      </Canvas>
      <div className={viewMode === "surface" ? "scene-key" : "layer-legend"}>
        {viewMode === "surface" ? <><span className="unknown-swatch" />Unmapped ground · <span className="origin-swatch" />Selected location</>
          : <>
            <div className="layer-legend-heading"><strong>{viewMode === "temperature" ? "Surface temperature" : viewMode === "solar" ? "Sunlight & canopy" : "Runoff reduction"}</strong><span>MODELED</span></div>
            <p>{viewMode === "temperature" ? "Explore warmer surfaces and cooler planting areas." : viewMode === "solar" ? "Darker areas indicate shade or less absorbed sunlight." : "Deeper blue shows more rain kept out of runoff."}</p>
            <div className={`layer-gradient scale-${viewMode}`} />
            <div className="layer-ticks">{(viewMode === "temperature" ? ["10°", "20°", "30°", "40°", "50°", "60°C"] : viewMode === "solar" ? ["Exposed", "Reduced", "Sheltered"] : ["0", `${(Math.max(1, rainfallMm) / 2).toFixed(1)}`, `${Math.max(1, rainfallMm).toFixed(1)} mm`]).map((label) => <span key={label}>{label}</span>)}</div>
            <small>{viewMode === "temperature" ? "Smooth display · 10 m samples · scale clipped at ends" : viewMode === "solar" ? "Cell-average effect · sunlight, not UV" : rainfallMm === 0 ? "No rain in this scenario. Adjust Rain & soil to test a storm." : "Compared with baseline · event totals"}</small>
          </>}
      </div>
      {viewMode !== "surface" && selectedResult && selectedBaseline && (
        <div className="cell-impact-card" aria-live="polite">
          <span>{SURFACE_LABELS[selectedResult.surfaceType]}</span>
          <strong className="cell-primary-value">{viewMode === "temperature" ? `${selectedResult.temperature.toFixed(1)}°C` : viewMode === "solar" ? `${Math.round(selectedResult.absorbedSolar)} W/m²` : `${selectedResult.water.toFixed(1)} mm`}</strong>
          <p className="cell-primary-label">{viewMode === "temperature" ? "Surface temperature" : viewMode === "solar" ? "Absorbed sunlight" : "Event runoff"}</p>
          <dl>
            <div><dt>Temperature change</dt><dd>{(selectedResult.temperature - selectedBaseline.temperature).toFixed(1)}°C</dd></div>
            <div><dt>Solar absorbed</dt><dd>{Math.round(selectedResult.absorbedSolar - selectedBaseline.absorbedSolar)} W/m²</dd></div>
            <div><dt>Canopy shade</dt><dd>{Math.round(selectedResult.shade * 100)}%</dd></div>
            <div><dt>Runoff change</dt><dd>{(selectedResult.water - selectedBaseline.water).toFixed(1)} mm</dd></div>
          </dl>
        </div>
      )}
      <div className="scene-help">{viewMode === "surface" ? "Click to place" : "Click to inspect"} · Drag to orbit · Scroll to zoom</div>
      <div className="osm-attribution"><a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></div>
    </div>
  );
}
