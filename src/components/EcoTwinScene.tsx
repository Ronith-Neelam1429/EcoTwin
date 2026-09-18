import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Pause, Play } from "lucide-react";
import polygonClipping, { type MultiPolygon, type Pair } from "polygon-clipping";
import { SURFACE_COLORS, SURFACE_LABELS } from "../lib/ecotwin/cellProperties";
import { CELL_METERS, cellAt, cellPolygon, contains, type Neighborhood, type AreaFeature } from "../lib/ecotwin/geography";
import type { VegetationNeighborhood } from "../lib/ecotwin/googleVegetation";
import type { EcoCell, InterventionTool, TwinLocation, ViewMode } from "../lib/ecotwin/types";

import { BUILDING_CATEGORIES, BUILDING_STYLES } from "../lib/ecotwin/buildingModels";
import { captureScene, type CapturedScene } from "../lib/ecotwin/sceneCapture";

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

function SatelliteCaptureGround({ reference }: { reference: NonNullable<VegetationNeighborhood["satelliteReference"]> }) {
  const texture = useMemo(() => {
    const result = new THREE.TextureLoader().load(reference.image);
    result.colorSpace = THREE.SRGBColorSpace;
    result.minFilter = THREE.LinearFilter;
    result.magFilter = THREE.LinearFilter;
    return result;
  }, [reference.image]);
  useEffect(() => () => texture.dispose(), [texture]);
  const width = reference.width * reference.metersPerPixel / CELL_METERS;
  const height = reference.height * reference.metersPerPixel / CELL_METERS;
  return <mesh visible={false} userData={{ captureOnly: true }} position={[0, 0.021, 0]} rotation={[-Math.PI / 2, 0, 0]}>
    <planeGeometry args={[width, height]} />
    <meshBasicMaterial map={texture} toneMapped={false} />
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
    if (rainfallMm === 0) {
      const absorbs = ["grass", "tree", "rain_garden", "green_roof", "permeable_pavement"].includes(cell.surfaceType);
      return new THREE.Color("#d7dde1").lerp(new THREE.Color(absorbs ? "#2d9b72" : "#1676b7"), absorbs ? 0.55 : 0.38).getStyle();
    }
    const runoff = THREE.MathUtils.clamp(cell.water / Math.max(1, rainfallMm), 0, 1);
    const absorbed = THREE.MathUtils.clamp(cell.infiltration, 0, 1);
    const base = new THREE.Color("#d7dde1");
    return base.lerp(new THREE.Color(absorbed > runoff ? "#2d9b72" : "#1676b7"), Math.max(absorbed, runoff) * 0.9).getStyle();
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

function Footprint({ polygons, height = 0, y = 0.03, color, roughness = 0.9, unlit = false, texture, onClick }: {
  polygons: MultiPolygon; height?: number; y?: number; color: string; roughness?: number;
  texture?: THREE.Texture; unlit?: boolean; onClick?: (event: ThreeEvent<MouseEvent>) => void;
}) {
  const shapes = useMemo(() => shapesFrom(polygons), [polygons]);
  return (
    <mesh castShadow={height > 0} receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} onClick={onClick}>
      {height > 0
        ? <extrudeGeometry args={[shapes, { depth: height, bevelEnabled: false }]} />
        : <shapeGeometry args={[shapes]} />}
      {unlit ? <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} /> : <meshStandardMaterial map={texture} color={color} roughness={roughness} side={THREE.DoubleSide} />}
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

// Repeatable model modules follow actual footprint edges, including irregular malls.
function Storefronts({ feature, onClick }: { feature: AreaFeature; onClick: (event: ThreeEvent<MouseEvent>) => void }) {
  const panels = useMemo(() => feature.polygons.flatMap(([ring]) => ring.slice(0, -1).flatMap(([x, z], i) => {
    const [nx, nz] = ring[i + 1];
    const length = Math.hypot(nx - x, nz - z);
    if (length < 0.5) return [];
    const count = Math.min(60, Math.floor(length / 0.45));
    return Array.from({ length: count }, (_, j) => ({
      x: x + (nx - x) * (j + 0.5) / count, z: z + (nz - z) * (j + 0.5) / count,
      width: length / count * 0.78, angle: -Math.atan2(nz - z, nx - x),
    }));
  })), [feature]);
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const transform = new THREE.Object3D();
    panels.forEach((panel, index) => {
      transform.position.set(panel.x, Math.min(0.19, feature.height / 2), panel.z);
      transform.rotation.set(0, panel.angle, 0);
      transform.scale.set(panel.width, Math.min(0.24, feature.height * 0.65), 0.012);
      transform.updateMatrix();
      mesh.current!.setMatrixAt(index, transform.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [panels, feature.height]);
  return <instancedMesh ref={mesh} args={[undefined, undefined, panels.length]} onClick={onClick}>
    <boxGeometry args={[1, 1, 1]} />
    <meshStandardMaterial color="#52747b" roughness={0.3} metalness={0.25} />
  </instancedMesh>;
}

function PlantedPatch({ polygons, y, onClick }: { polygons: MultiPolygon; y: number; onClick: (event: ThreeEvent<MouseEvent>) => void }) {
  const texture = useMemo(() => {
    const data = new Uint8Array(64 * 64 * 4);
    for (let i = 0; i < 64 * 64; i++) {
      const shade = 0.65 + seeded(i, 42) * 0.65;
      data.set([Math.min(255, 105 * shade), Math.min(255, 153 * shade), 48 * shade, 255], i * 4);
    }
    const result = new THREE.DataTexture(data, 64, 64);
    result.colorSpace = THREE.SRGBColorSpace;
    result.wrapS = result.wrapT = THREE.RepeatWrapping;
    result.repeat.set(3, 3);
    result.needsUpdate = true;
    return result;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return <Footprint polygons={polygons} height={0.018} y={y} color="#ffffff" texture={texture} onClick={onClick} />;
}

function Building({ feature, showLabel, labelIndex, cells, baselineById, gridSize, mode, tool, onSelect, rainfallMm }: {
  showLabel: boolean; labelIndex: number; rainfallMm: number; feature: AreaFeature; cells: EcoCell[]; baselineById: Map<string, EcoCell>; gridSize: number; mode: ViewMode; tool: InterventionTool; onSelect: (id: string) => void;
}) {
  const displayHeight = feature.height;
  const category = feature.identity?.category ?? 'unknown';
  const style = BUILDING_STYLES[category];
  const label = feature.name || BUILDING_CATEGORIES[category];
  const labelPoint = feature.polygons[0]?.[0]?.[0] ?? [0, 0];
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
    <group userData={{ buildingLabel: label, buildingCategory: BUILDING_CATEGORIES[category] }}>
      {showLabel && <Html position={[labelPoint[0], displayHeight + 0.3, labelPoint[1]]} center style={{ pointerEvents: 'none' }}>
        <span className="building-scene-label">{labelIndex}. {label}<small>{feature.name ? BUILDING_CATEGORIES[category] : ''}</small></span>
      </Html>}
      <Footprint polygons={feature.polygons} height={displayHeight} color={style.wall} roughness={0.82} onClick={click} />
      {mode === "surface" && <>
        <Footprint polygons={feature.polygons} y={displayHeight + 0.034} color={style.roof} roughness={0.9} onClick={click} />
        {style.storefront && <Storefronts feature={feature} onClick={click} />}
      </>}
      {roofs.filter((r) => r.polygons.length).map(({ cell, polygons }) => (
        <group key={cell.id} userData={cell.surfaceType !== cell.baselineSurfaceType ? { intervention: cell.surfaceType } : {}}>
          {mode === "surface" ? <PlantedPatch polygons={polygons} y={displayHeight + 0.042} onClick={click} />
            : <Footprint polygons={polygons} y={displayHeight + 0.04} unlit color={colorFor(cell, baselineById.get(cell.id), mode, rainfallMm)} onClick={click} />}
        </group>
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

function ExistingTrees({ trees, cells, baselineById, gridSize, mode, rainfallMm, onSelect }: {
  trees: Neighborhood["trees"];
  cells: EcoCell[];
  baselineById: Map<string, EcoCell>;
  gridSize: number;
  mode: ViewMode;
  rainfallMm: number;
  onSelect: (event: ThreeEvent<MouseEvent>, id: string) => void;
}) {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const canopies = useRef<THREE.InstancedMesh>(null);
  const visible = useMemo(() => {
    const cellById = new Map(cells.map((cell) => [cell.id, cell]));
    return trees.flatMap((tree) => {
      const id = cellAt(...tree.point, gridSize);
      const cell = cellById.get(id);
      return cell?.surfaceType === "tree"
        ? [{ ...tree, cellId: id, color: colorFor(cell, baselineById.get(id), mode, rainfallMm) }]
        : [];
    });
  }, [baselineById, cells, gridSize, mode, rainfallMm, trees]);
  useLayoutEffect(() => {
    if (!trunks.current || !canopies.current) return;
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    for (let index = 0; index < visible.length; index++) {
      const tree = visible[index];
      matrix.compose(
        new THREE.Vector3(tree.point[0], TREE_HEIGHT * 0.28, tree.point[1]),
        rotation,
        new THREE.Vector3(0.055, TREE_HEIGHT * 0.56, 0.055),
      );
      trunks.current.setMatrixAt(index, matrix);
      matrix.compose(
        new THREE.Vector3(tree.point[0], TREE_HEIGHT * 0.7, tree.point[1]),
        rotation,
        new THREE.Vector3(TREE_CANOPY_DIAMETER / 2, TREE_CANOPY_DIAMETER * 0.375, TREE_CANOPY_DIAMETER / 2),
      );
      canopies.current.setMatrixAt(index, matrix);
      canopies.current.setColorAt(index, new THREE.Color(tree.color));
    }
    trunks.current.instanceMatrix.needsUpdate = true;
    canopies.current.instanceMatrix.needsUpdate = true;
    if (canopies.current.instanceColor) canopies.current.instanceColor.needsUpdate = true;
  }, [visible]);
  const selectInstance = (event: ThreeEvent<MouseEvent>) => {
    if (event.instanceId === undefined) return;
    const tree = visible[event.instanceId];
    if (tree) onSelect(event, tree.cellId);
  };
  if (!visible.length) return null;
  return <>
    <instancedMesh ref={trunks} args={[undefined, undefined, visible.length]} castShadow onClick={selectInstance}>
      <cylinderGeometry args={[1, 1, 1, 8]} />
      <meshStandardMaterial color="#79583b" roughness={1} />
    </instancedMesh>
    <instancedMesh ref={canopies} args={[undefined, undefined, visible.length]} castShadow receiveShadow onClick={selectInstance}>
      <icosahedronGeometry args={[1, 2]} />
      <meshStandardMaterial vertexColors roughness={0.92} />
    </instancedMesh>
  </>;
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

function seeded(index: number, salt: number) {
  const value = Math.sin(index * 91.731 + salt * 47.219) * 43758.5453;
  return value - Math.floor(value);
}

function RainSimulation({ gridSize, rainfallMm, active }: { gridSize: number; rainfallMm: number; active: boolean }) {
  const points = useRef<THREE.Points>(null);
  const count = Math.min(650, Math.max(180, Math.round(Math.max(rainfallMm, 10) * 9)));
  const positions = useMemo(() => {
    const result = new Float32Array(count * 3);
    for (let index = 0; index < count; index++) {
      result[index * 3] = (seeded(index, 1) - 0.5) * gridSize * 1.08;
      result[index * 3 + 1] = 0.15 + seeded(index, 2) * gridSize * 0.9;
      result[index * 3 + 2] = (seeded(index, 3) - 0.5) * gridSize * 1.08;
    }
    return result;
  }, [count, gridSize]);
  useFrame((_, delta) => {
    if (!active || !points.current) return;
    const attribute = points.current.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let index = 0; index < count; index++) {
      const y = attribute.getY(index) - delta * (8 + seeded(index, 4) * 5);
      attribute.setY(index, y < 0.04 ? gridSize * (0.65 + seeded(index, 5) * 0.3) : y);
    }
    attribute.needsUpdate = true;
  });
  return <points ref={points} userData={{ captureHidden: true }} frustumCulled={false}>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
    <pointsMaterial color="#258dcc" size={0.16} transparent opacity={0.82} sizeAttenuation depthWrite={false} />
  </points>;
}

const ABSORBING_SURFACES = new Set(["grass", "tree", "rain_garden", "permeable_pavement"]);

function CellMotion({ cells, gridSize, mode, active, rainfallMm }: {
  cells: EcoCell[]; gridSize: number; mode: Exclude<ViewMode, "surface">; active: boolean; rainfallMm: number;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const candidates = useMemo(() => {
    if (mode === "stormwater") {
      const wet = cells.filter((cell) => cell.infiltration > 0.01 || ABSORBING_SURFACES.has(cell.surfaceType));
      return wet.sort((a, b) => b.infiltration - a.infiltration).slice(0, 180);
    }
    if (mode === "temperature") return [...cells].sort((a, b) => b.temperature - a.temperature).slice(0, 140);
    return [...cells].sort((a, b) => b.absorbedSolar - a.absorbedSolar).slice(0, 140);
  }, [cells, mode]);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const position = useMemo(() => new THREE.Vector3(), []);
  const rotation = useMemo(() => new THREE.Quaternion(), []);
  const scale = useMemo(() => new THREE.Vector3(), []);
  const simulationTime = useRef(0);
  useFrame((_, delta) => {
    if (!mesh.current) return;
    if (active) simulationTime.current += delta;
    const elapsed = simulationTime.current;
    for (let index = 0; index < candidates.length; index++) {
      const cell = candidates[index];
      const phase = (elapsed * (0.45 + seeded(index, 7) * 0.45) + seeded(index, 8)) % 1;
      const x = cell.col - gridSize / 2 + 0.5 + (seeded(index, 9) - 0.5) * 0.42;
      const z = cell.row - gridSize / 2 + 0.5 + (seeded(index, 10) - 0.5) * 0.42;
      const strength = mode === "stormwater" ? Math.max(cell.infiltration, rainfallMm === 0 ? 0.35 : 0.1)
        : mode === "temperature" ? THREE.MathUtils.clamp((cell.temperature - 20) / 40, 0.15, 1)
          : THREE.MathUtils.clamp(cell.absorbedSolar / 900, 0.15, 1);
      const y = mode === "stormwater" ? 0.62 - phase * 0.58 : mode === "temperature" ? 0.08 + phase * 1.5 : 1.7 - phase * 1.6;
      position.set(x, y, z);
      rotation.identity();
      const size = (mode === "stormwater" ? 0.13 + strength * 0.17 : 0.08 + strength * 0.12)
        * (0.65 + Math.sin(phase * Math.PI) * 0.35);
      scale.set(size, mode === "temperature" ? size * 1.8 : size, size);
      matrix.compose(position, rotation, scale);
      mesh.current.setMatrixAt(index, matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  const color = mode === "stormwater" ? "#20f3a0" : mode === "temperature" ? "#ff8a45" : "#ff9d2e";
  return <instancedMesh ref={mesh} args={[undefined, undefined, candidates.length]} userData={{ captureHidden: true }} frustumCulled={false}>
    <sphereGeometry args={[1, 8, 6]} />
    <meshBasicMaterial color={color} transparent opacity={0.78} depthWrite={false} />
  </instancedMesh>;
}

function RunoffRipples({ cells, gridSize, active, rainfallMm }: { cells: EcoCell[]; gridSize: number; active: boolean; rainfallMm: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const runoffCells = useMemo(() => (rainfallMm > 0
    ? cells.filter((cell) => cell.water > 0.01).sort((a, b) => b.water - a.water)
    : cells.filter((cell) => cell.surfaceType === "asphalt" || cell.surfaceType === "building" || cell.surfaceType === "unknown"))
    .slice(0, 140), [cells, rainfallMm]);
  const simulationTime = useRef(0);
  useFrame((_, delta) => {
    if (!mesh.current) return;
    if (active) simulationTime.current += delta;
    const elapsed = simulationTime.current;
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    for (let index = 0; index < runoffCells.length; index++) {
      const cell = runoffCells[index];
      const phase = (elapsed * 0.55 + seeded(index, 12)) % 1;
      const strength = rainfallMm === 0 ? 0.55 : THREE.MathUtils.clamp(cell.water / Math.max(1, rainfallMm), 0.1, 1);
      matrix.compose(
        new THREE.Vector3(cell.col - gridSize / 2 + 0.5, 0.065, cell.row - gridSize / 2 + 0.5),
        rotation,
        new THREE.Vector3(0.12 + phase * 0.28 * strength, 0.12 + phase * 0.28 * strength, 1),
      );
      mesh.current.setMatrixAt(index, matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
    if (material.current) material.current.opacity = active ? 0.18 + (1 - (elapsed * 0.55) % 1) * 0.32 : 0.28;
  });
  if (!runoffCells.length) return null;
  return <instancedMesh ref={mesh} args={[undefined, undefined, runoffCells.length]} userData={{ captureHidden: true }}>
    <ringGeometry args={[0.62, 1, 24]} />
    <meshBasicMaterial ref={material} color="#36a8ec" transparent opacity={0.35} depthWrite={false} side={THREE.DoubleSide} />
  </instancedMesh>;
}

export type SceneCapture = { capture: () => CapturedScene };
function CaptureBridge({ captureRef, viewMode }: { captureRef?: Ref<SceneCapture>; viewMode: ViewMode }) {
  const { gl, scene, camera } = useThree();
  useImperativeHandle(captureRef, () => ({ capture() {
    if (viewMode !== "surface") throw new Error("The surface view is still updating. Please try again.");
    return captureScene(gl, scene, camera);
  } }), [gl, scene, camera, viewMode]);
  return null;
}

export function EcoTwinScene({ cells, baselineCells, viewMode, selectedTool, onCellClick, neighborhood, location, rainfallMm, captureRef, showBuildingLabels = false }: {
  showBuildingLabels?: boolean; captureRef?: Ref<SceneCapture>; rainfallMm: number; cells: EcoCell[]; baselineCells: EcoCell[]; viewMode: ViewMode; selectedTool: InterventionTool; onCellClick: (id: string) => void; neighborhood: VegetationNeighborhood; location: TwinLocation;
}) {
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [pausedMode, setPausedMode] = useState<ViewMode | null>(null);
  const simulationActive = pausedMode !== viewMode;
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
      <Canvas shadows frameloop={viewMode === "surface" || !simulationActive ? "demand" : "always"} dpr={[1, 1.5]} camera={{ position: cameraPosition, fov: 48, near: 0.5, far: 300 }}>
        <CaptureBridge captureRef={captureRef} viewMode={viewMode} />
        {neighborhood.satelliteReference && <SatelliteCaptureGround reference={neighborhood.satelliteReference} />}
        <color attach="background" args={["#b9d4e7"]} />
        <fog attach="fog" args={["#b9d4e7", gridSize * 1.5, gridSize * 4]} />
        <hemisphereLight args={["#e8f2ff", "#6f746d", 0.8]} />
        <ambientLight intensity={0.45} />
        <directionalLight castShadow position={[-15, 28, 10]} intensity={2.15}
          shadow-mapSize-width={2048} shadow-mapSize-height={2048}
          shadow-camera-left={-halfSize * 1.3} shadow-camera-right={halfSize * 1.3}
          shadow-camera-top={halfSize * 1.3} shadow-camera-bottom={-halfSize * 1.3}
          shadow-camera-near={1} shadow-camera-far={gridSize * 3} shadow-bias={-0.00015} />
        {viewMode === "stormwater" && <>
          <RainSimulation gridSize={gridSize} rainfallMm={rainfallMm} active={simulationActive} />
          <CellMotion cells={cells} gridSize={gridSize} mode="stormwater" active={simulationActive} rainfallMm={rainfallMm} />
          <RunoffRipples cells={cells} gridSize={gridSize} active={simulationActive} rainfallMm={rainfallMm} />
        </>}
        {viewMode === "temperature" && <CellMotion cells={cells} gridSize={gridSize} mode="temperature" active={simulationActive} rainfallMm={rainfallMm} />}
        {viewMode === "solar" && <CellMotion cells={cells} gridSize={gridSize} mode="solar" active={simulationActive} rainfallMm={rainfallMm} />}
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
            <group key={cell.id} userData={changed && !cell.buildingId ? { intervention: cell.surfaceType } : {}}>
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
        {neighborhood.features.filter((f) => f.surface === "building").map((feature, index) => (
          <Building key={feature.id} showLabel={showBuildingLabels} labelIndex={index + 1} feature={feature} cells={cells} baselineById={baselineById} gridSize={gridSize} mode={viewMode} tool={selectedTool} onSelect={select} rainfallMm={rainfallMm} />
        ))}
        <ExistingTrees trees={neighborhood.trees} cells={cells} baselineById={baselineById} gridSize={gridSize}
          mode={viewMode} rainfallMm={rainfallMm} onSelect={clickCell} />
        <mesh userData={{ captureHidden: true }} position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.19, 0.27, 32]} /><meshBasicMaterial color="#2f6fed" /></mesh>
        <Html position={[0, 0.4, -halfSize - 0.8]} center><span className="north-label">↑ N</span></Html>
        <OrbitControls makeDefault enableDamping minDistance={Math.max(3, gridSize / 6)} maxDistance={gridSize * 2.5} maxPolarAngle={Math.PI / 2.1} />
      </Canvas>
      {viewMode !== "surface" && <button type="button" className="simulation-toggle" aria-pressed={simulationActive}
        onClick={() => setPausedMode(simulationActive ? viewMode : null)}>
        {simulationActive ? <Pause size={14} /> : <Play size={14} />}
        {simulationActive ? "Pause" : "Play"} {viewMode === "stormwater" ? "storm" : viewMode === "temperature" ? "heat" : "sunlight"}
      </button>}
      <div className={viewMode === "surface" ? "scene-key" : "layer-legend"}>
        {viewMode === "surface" ? <>
          <strong className="scene-key-title">Existing</strong>
          {[
            ["Road / asphalt", SURFACE_COLORS.asphalt],
            ["Building", SURFACE_COLORS.building],
            ["Grass", SURFACE_COLORS.grass],
            ["Trees", SURFACE_COLORS.tree],
            ["Unmapped", SURFACE_COLORS.unknown],
          ].map(([label, color]) => <span className="scene-key-item" key={label}><i style={{ backgroundColor: color }} />{label}</span>)}
          <span className="scene-key-item"><i className="origin-swatch" />Selected location</span>
        </>
          : <>
            <div className="layer-legend-heading"><strong>{viewMode === "temperature" ? "Surface heat" : viewMode === "solar" ? "Sunlight & shade" : "Rain & stormwater"}</strong><span>SIMULATION</span></div>
            <p>{viewMode === "temperature" ? "Orange particles rise from the hottest surfaces." : viewMode === "solar" ? "Gold particles show incoming energy; darker ground absorbs less." : "Rain falls, blue rings mark runoff, and green drops show water soaking in."}</p>
            {viewMode === "stormwater" ? <div className="stormwater-legend">
              <span><i className="runoff" />Runs off</span><span><i className="absorbed" />Soaks in</span>
            </div> : <>
              <div className={`layer-gradient scale-${viewMode}`} />
              <div className="layer-ticks">{(viewMode === "temperature" ? ["10°", "20°", "30°", "40°", "50°", "60°C"] : ["Exposed", "Reduced", "Sheltered"]).map((label) => <span key={label}>{label}</span>)}</div>
            </>}
            <small>{viewMode === "temperature" ? "Modeled surface temperature, not air temperature" : viewMode === "solar" ? "Cell-average sunlight effect, not UV" : rainfallMm === 0 ? "Rain animation is a preview; set rainfall under Storm for calculated water results." : `${rainfallMm.toFixed(1)} mm modeled storm`}</small>
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
